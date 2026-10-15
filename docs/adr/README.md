# Architecture decision records

One file per decision, with the alternatives it rejected. A new decision gets the next number; a reversed one gets a new ADR that supersedes it, never an edit.

| ADR | Decision |
| --- | --- |
| [0001](0001-one-source-four-tools.md) | One source of truth, four tool dialects: neutral standards, agents and skills, with a build that writes each tool's format. |
| [0002](0002-root-is-the-drop-in.md) | The repository root is the drop-in; the installer copies it into a project or links it into a tool's user folders. |
| [0003](0003-antigravity-not-gemini.md) | Antigravity CLI is the Google target, not Gemini CLI. |
| [0004](0004-tiers-not-models.md) | Agents name a tier (judgment, implementation), not a model. |
