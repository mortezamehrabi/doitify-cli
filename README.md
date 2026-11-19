# Doitify CLI

**Bring your AI agent into your Doitify workflow—in any project.**

Set up the instructions, skills and guardrails your agent needs to work with
Doitify through MCP. Use it in an existing codebase or an empty folder for
content, research, planning or other work.

**No runtime dependencies. No changes to your app's dependencies. No separate
task database or agent runtime.**

## Quick start

Requires **Node.js 22+**, an MCP-capable agent client and access to Doitify.

Inside your working folder:

```bash
# Preview the changes without writing files
npx @doitify/cli@latest init --dry-run

# Add the workspace
npx @doitify/cli@latest init
```

Then open your preferred agent, such as Codex or Claude Code, and say:

> Start / شروع کن

The agent connects first: server `doitify`, URL `https://ai-api.doitify.com/mcp`,
HTTP (streamable), OAuth 2.1. You sign in and authorize in the browser, then
choose the Doitify Board for this folder. The agent saves the binding in
`.doitify/project.md`, reads the charter, and clarifies your desired work and
its role—even if the charter is already complete. It independently records
important confirmed facts in shared charter/documents and verifies the result,
without separate approval for routine non-destructive knowledge updates.
Explicit restrictions and server permissions still apply.

Local understanding, preferences, decisions and lessons grow in
`.doitify/project-knowledge/`. Later sessions reuse the selected Board, verify
access and refresh relevant live context rather than asking you to select again.
The npm package includes only the public knowledge starter, not learned notes.

Once authorized, the agent can use existing MCP tools to find assigned tasks,
perform work, update progress, ask questions, document results and hand off for
review. Available actions depend on your deployment, client and account permissions.

## What gets added?

```text
your-project/
├── DOITIFY.md        # Shared Doitify instructions
├── .doitify/         # Settings, project-knowledge/, policies, skills and templates
├── AGENTS.md         # Reference added; existing content preserved
├── CLAUDE.md         # Reference added; existing content preserved
└── README.md         # Reference added; existing content preserved
```

`DOITIFY.md` is the shared entry point. The other Markdown files reference it
with `@DOITIFY.md`; clients without import support can read it explicitly.
Only the skill needed for the current task is loaded.

### Safe for existing projects

- Existing `AGENTS.md`, `CLAUDE.md` and `README.md` content is preserved.
- Customized `.doitify/project.md` settings are preserved.
- Running `init` again does not duplicate references.
- Conflicting workspace files stop installation before writes; no `--force`.
- The installer does not read credentials, configure MCP, make network requests
  or change data in Doitify. npm itself downloads the package as usual.

Commit or back up your project before setup and review the dry-run.
Do not edit files concurrently with installation. Writes are per-file, not a
transaction: an I/O failure can leave a partial install that needs inspection.

## Commands

| Command | Purpose |
|---|---|
| `doitify init` | Initialize the current folder |
| `doitify init --dry-run` | Preview without writing |
| `doitify init --target "/path/to/project"` | Initialize a different folder |
| `doitify --version` | Show the installed CLI version |
| `doitify --help` | Show usage |

To use the `doitify` command directly:

```bash
npm install -g @doitify/cli
doitify init
```

## Updating

### Get the latest CLI

For one-off use, request the latest published version explicitly:

```bash
npx @doitify/cli@latest --version
```

For a global installation:

```bash
npm install -g @doitify/cli@latest
doitify --version
```

### What about an existing workspace?

**Updating the CLI does not upgrade the workspace files already in your project.**
Currently, the CLI provides `init`, not an `update` or `upgrade` command.
If a new bundled file differs from an existing one, `init` stops rather than
overwriting your changes.

For now, back up or commit your project, initialize the latest version in a
separate temporary folder, and review/merge the instruction changes manually.
Keep your own `.doitify/project.md`, `.doitify/project-knowledge/` and host rules.
Merge new knowledge guidance without replacing your notes. Do not delete your existing
workspace just to bypass a conflict.

## Scope and compatibility

The [npm package](https://www.npmjs.com/package/@doitify/cli) contains the
Doitify Agent Workspace instructions; users do not need the development workspace repository.
It does not start an agent, grant permissions or wake a stopped client.
Your host and Doitify remain responsible for enforcing access.

The installer has been tested locally on Linux. Verify your native client,
operating system and MCP deployment before relying on a live workflow.
The raw workspace can also be copied manually without Node.js.

## Maintainer releases

Use the source project, not the globally installed package. Keep the canonical
`doitify-agent-workspace` checkout beside `doitify-cli`; packaging reads a fresh
instruction snapshot from it. Published users do not need that checkout.
The development workspace can remain private; installing from npm never
requires access to it. Building/testing this source checkout requires that
workspace source, so external contributors without it should not expect a build.

```bash
npm version patch --no-git-tag-version
npm test
npm run check
npm pack --dry-run
npm publish --access public
```

Use `minor` for backward-compatible features and `major` for breaking changes.
Every release, including README-only changes, needs a new version.
Publication requires npm authentication with permission for the `doitify` scope.
Never commit a token or private project settings.
