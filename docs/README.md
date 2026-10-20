# Documentation

Start with the guide for your tool; the rest explains how the pieces fit and why.

**Per tool**: [Claude Code](claude-code.md) · [Cursor](cursor.md) · [GitHub Copilot](copilot.md) · [Antigravity CLI](antigravity.md)

**How it works**

- [architecture.md](architecture.md): the layout, what each tool reads, the agent frontmatter mapping, the hook adapters, the installer, the vocabulary.
- [compatibility.md](compatibility.md): the matrix of what each tool reads, with the documentation each row was verified against and the date.
- [git-guard.md](git-guard.md): what the hook refuses, how it is wired into each tool, how to try it by hand.
- [skill-evals.md](skill-evals.md): running each skill's evals.
- [agent-evals.md](agent-evals.md): running each agent's evals and grading its description's routing.

**Changing it**

- [customizing.md](customizing.md): forking, changing the stack, adding an agent, a skill, a hook or a tool.
- [migrating-from-claude-code-config.md](migrating-from-claude-code-config.md): for people coming from the Claude Code-only ancestor.
- [../CONTRIBUTING.md](../CONTRIBUTING.md): what contributions help most and how to send them.

**Decisions**: [adr/](adr/README.md)
