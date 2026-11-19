# Connect the existing MCP

1. Use your agent client's native MCP settings. Add the Doitify server using
   the exact URL supplied by your Doitify deployment; do not guess a domain.
2. Complete the client's normal browser-based OAuth login with the agent's own
   existing Doitify account. Never put passwords or access tokens in this folder.
3. Let the agent discover the live tools and call `whoami`. Confirm the intended
   account and selected Board membership before reading tasks.

Codex, Claude Code and other clients have different setup commands. Use the
installed client's own MCP help; this folder does not require a particular CLI,
write global configuration or replace other MCP servers.

If the client does not automatically read `AGENTS.md` / `CLAUDE.md`, explicitly
ask it to read `DOITIFY.md`. A client without MCP support cannot connect
just by reading instructions.

On login, 2FA or missing access, ask the user to complete the step. Do not switch
accounts to bypass permissions. After reconnecting, verify account and Board
access again. These files do not grant permissions or prove a live connection.
