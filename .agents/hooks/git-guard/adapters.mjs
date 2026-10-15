// The only place a tool's hook payload appears: how each tool names the shell call and its command, and
// how it is told no (docs/architecture.md, "The git guard"). `read` returns { command, cwd } or null when
// the call is not a shell command; `deny` writes the answer and returns the exit code.
const CLAUDE_SHELLS = new Set(["Bash", "PowerShell"]);
const COPILOT_SHELLS = new Set(["bash", "powershell", "Bash"]);
const ANTIGRAVITY_SHELL = "run_command";

// Copilot may hand the tool arguments over as a JSON string rather than an object.
function asObject(value) {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function denyJson(payload) {
  process.stdout.write(JSON.stringify(payload));
  return 0;
}

export const ADAPTERS = {
  // PreToolUse on Bash|PowerShell. Exit 2 blocks and the stderr text is shown to the model.
  claude: {
    read: (input) => (CLAUDE_SHELLS.has(input.tool_name) ? { command: input.tool_input?.command ?? "", cwd: input.cwd } : null),
    deny: (reason) => {
      process.stderr.write(`${reason}\n`);
      return 2;
    },
  },
  // beforeShellExecution: the event itself is shell-only. `continue` stays true: deny this command, not the agent.
  cursor: {
    read: (input) => ({ command: input.command ?? "", cwd: input.cwd }),
    deny: (reason) => denyJson({ continue: true, permission: "deny", user_message: reason, agent_message: reason }),
  },
  // preToolUse (camelCase: toolName bash|powershell, toolArgs) or the PascalCase PreToolUse form, which
  // carries the Claude-shaped payload (tool_name Bash, tool_input).
  copilot: {
    read: (input) => {
      const name = input.toolName ?? input.tool_name;
      if (!COPILOT_SHELLS.has(name)) return null;
      const args = asObject(input.toolArgs ?? input.tool_input);
      return { command: args.command ?? "", cwd: input.cwd };
    },
    deny: (reason) => denyJson({ permissionDecision: "deny", permissionDecisionReason: reason }),
  },
  // PreToolUse on run_command: the command is toolCall.args.CommandLine, the directory its Cwd.
  antigravity: {
    read: (input) => {
      const call = input.toolCall;
      if (call?.name !== ANTIGRAVITY_SHELL) return null;
      const args = asObject(call.args);
      return { command: args.CommandLine ?? "", cwd: args.Cwd ?? input.workspacePaths?.[0] };
    },
    deny: (reason) => denyJson({ decision: "deny", reason }),
  },
};
