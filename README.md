# Doitify CLI

**Bring your AI agent into your team's project workflow.**

[Doitify](https://doitify.com) brings project work, tasks and team collaboration
together. **Doitify CLI** adds the instructions your AI agent needs to work in
that context through MCP: understand the project, carry out its mission, share
progress and keep useful knowledge between sessions.

Use it in an existing codebase or an empty folder—for development, content,
research, design or planning. It works alongside your preferred MCP-capable
agent; it does not replace your tools or run a separate agent service.

[Visit Doitify](https://doitify.com) ·
[npm package](https://www.npmjs.com/package/@doitify/cli) ·
[GitHub](https://github.com/mortezamehrabi/doitify-cli) ·
[Report an issue](https://github.com/mortezamehrabi/doitify-cli/issues)

## Get started

You need **Node.js 22+**, a [Doitify account](https://doitify.com) with access to
your Board, and an agent client that supports **streamable HTTP MCP and OAuth
2.1**. Codex and Claude Code are examples; available setup controls depend on
your client.

### 1. Add the workspace

Run these commands in the folder where your agent will work:

```bash
# Preview first — no files are written
npx @doitify/cli@latest init --dry-run

# Install the workspace instructions
npx @doitify/cli@latest init
```

No changes to your application's dependencies. No runtime dependencies,
background service or additional task database.

### 2. Ask your agent to start

Open your agent in the same folder and say:

> Read DOITIFY.md and start.

Once your client has loaded the instructions, “Start” or “شروع کن” works too.
The agent guides you through:

1. **Connect:** configure the Doitify MCP and complete browser sign-in.
2. **Choose your project:** select the Doitify Board for this local folder.
3. **Set the mission:** read the project charter and clarify what you want the
   agent to do—not every project or role is software development.
4. **Get to work:** save the Board binding and project context for future sessions.

You complete sign-in and authorization yourself. If your client cannot configure
MCP automatically, the agent provides the settings for you to add manually:

| Setting | Value |
|---|---|
| Server name | `doitify` |
| URL | `https://ai-api.doitify.com/mcp` |
| Transport | HTTP (streamable) |
| Authentication | OAuth 2.1 |

**The installer itself does not configure MCP, log in or contact Doitify.**
Never put passwords or access tokens in the workspace.

## What the workspace teaches your agent

| Capability | How it helps |
|---|---|
| Project understanding | Read the charter, fill gaps and keep important confirmed facts in shared documentation. |
| Task work | Find relevant assigned work, plan, execute, verify and hand off with evidence. |
| Team collaboration | Use supported Task, subtask, Board or direct chats; record where to return for replies. |
| Work reporting | Submit factual individual reports after meaningful progress and before session end, once or many times per day without double-counting. |
| Persistent knowledge | Retain project context, decisions, preferences and lessons locally between sessions. |
| Follow-through | Revisit unanswered questions and capture genuinely deferred work as linked Doitify tasks. |

Routine in-scope documentation, reporting and collaboration do not need a new
approval question for every update. Explicit user restrictions, host rules,
server permissions and the tools actually available remain authoritative.
The instructions do not grant access or guarantee that every client supports
every action.

### Optional automatic checks

On setup and after workspace updates, the agent reviews automatic monitoring:
reuse a verified existing job, respect a saved decline, or offer low-cost checks
normally every 10 minutes. With one-time authorization, it can use a supported
native scheduler or OS timer/cron to invoke the actual agent client.

Checks cover new tasks, relevant messages, waiting answers, task changes and QC
feedback—even after a review handoff leaves the assigned-task list. Clear,
authorized rework can continue through a verified work-client/model path; otherwise
the agent saves the next action and explains the execution blocker.

Scheduling needs real noninteractive MCP/model support, spending/run limits and
single-flight protection. The installer does not schedule anything or start an
agent. Detailed behavior lives in the updatable `automatic-monitoring` skill and
`monitoring-prompt.md`, not in a hard-coded cron prompt.
After a restart, start/continue checks live MCP and job health first, reuses
working setup and resumes unfinished work. Missing-job recovery stays within
saved authorization; it does not recreate healthy jobs or reset project data.

## Your files stay yours

```text
your-project/
├── DOITIFY.md                 # Shared agent instructions
├── .doitify/
│   ├── project.md             # Your Board binding, role and mission
│   ├── project-knowledge/     # Context, decisions and lessons
│   ├── follow-ups/            # Questions, reply locations and next checks
│   ├── plans/                 # Immediate and deferred work plans
│   ├── reports/               # Pending evidence and sent-report references
│   ├── agent-scripts/         # Optional local workflow helpers
│   ├── policies/              # Shared safety and lifecycle guidance
│   ├── skills/                # Instructions loaded as needed
│   ├── workflows/             # Shared work patterns
│   ├── templates/             # Reusable examples
│   └── install-state.json     # Installer-owned instruction hashes
├── AGENTS.md                  # Existing content kept; reference added
├── CLAUDE.md                  # Existing content kept; reference added
└── README.md                  # Existing content kept; reference added
```

`DOITIFY.md` is the shared entry point. Clients that do not expand `@DOITIFY.md`
references should read the file explicitly.

- Existing host instructions are preserved; missing discovery references are appended.
- Re-running `init` does not reset your project settings or replace existing
  knowledge, follow-ups, plans, reports or agent scripts.
- Only public starter indexes ship in the package—not your notes, records or
  generated scripts. These files may contain private project information;
  review your own Git sharing policy before committing them.
- Conflicts stop the plan before writes. There is no `--force` overwrite.

## Update without losing project knowledge

Updating the CLI does not upgrade the workspace files already in your project.
Use the explicit workspace update command:

```bash
npx @doitify/cli@latest update --dry-run
npx @doitify/cli@latest update
```

`update` refreshes bundled instruction files when their current content matches
the installed hash in `.doitify/install-state.json`. For older installations
without a recorded hash, it can also recognize exact copies from supported
official releases. Locally edited or unverified files cause a conflict instead
of being overwritten.

**Your local project data and host instructions are protected:** `update` never
changes `.doitify/project.md`, existing content in the five user-owned folders
shown above, or host `AGENTS.md`, `CLAUDE.md` and `README.md`. If an entire user-owned
folder is missing, it creates that folder with its public starter README.
Existing folders are left alone, even if their README was removed. Other local
files are left alone and retired instructions are never deleted.

Older or manually copied workspaces may not have an installation baseline.
Exact official instruction hashes from `0.1.0` and `0.1.2` are recognized offline
and migrated automatically; matching current files can also establish a baseline.
A recorded hash always takes precedence over release history. Unknown or modified
files require review: back up your workspace, initialize a fresh copy in a
separate temporary folder, and manually merge the instruction changes—never
delete your knowledge to resolve a conflict.

Back up or commit before installation/update and do not edit files concurrently.
Writes are atomic per file, not across the entire workspace; an I/O failure may
leave a partial installation that needs inspection.

## Commands

| Command | Purpose |
|---|---|
| `doitify init` | Add the workspace to the current folder |
| `doitify update` | Safely update installed instructions |
| `doitify init --dry-run` | Preview installation without writing |
| `doitify update --dry-run` | Preview an update without writing |
| `doitify init --target "/path/to/project"` | Install into another folder |
| `doitify update --target "/path/to/project"` | Update another workspace |
| `doitify --version` | Show the CLI version |
| `doitify --help` | Show usage |

Prefer a global installation?

```bash
npm install -g @doitify/cli@latest
doitify init

# Later, update the CLI and then your workspace
npm install -g @doitify/cli@latest
doitify update --dry-run
doitify update
```

The npm package name is **`@doitify/cli`**; the installed command is **`doitify`**.

## What this is—and isn't

This is a file installer and instruction workspace, **not an autonomous agent
runner**. Your client performs the work using its tools and Doitify access.
Copying files does not authenticate an account, start work or wake a stopped
client. Scheduled checks need a real supported scheduler/runner; OS cron changes
and persistent processes require explicit authorization.

The installer is tested locally on Linux. Verify your operating system, native
client and MCP deployment before relying on unattended behavior.
For manual setup without Node.js, use the
[Doitify Agent Workspace](https://github.com/mortezamehrabi/doitify-agent-workspace)
if you have repository access.

Want to contribute? See the
[contribution guide](https://github.com/mortezamehrabi/doitify-cli/blob/main/CONTRIBUTING.md).

---

**Keep your team and your agent working in the same project context.**
[Explore Doitify →](https://doitify.com)
