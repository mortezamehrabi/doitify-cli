# Local verification

The public registry confirms `@doitify/cli@0.1.0` is published (28 files).
Local README/description improvements still require a new npm version to appear
on the package page; no subsequent version has been published by this agent.

## Automated tests

```text
npm test
25 passed; 0 failed; 0 skipped

npm run check
All four JavaScript modules passed Node syntax checks.
```

Targeted ESLint checks for unused variables, unreachable code and typeof usage
also passed using the existing monorepo lint tool; no CLI dependency was added.

Tests cover canonical-source snapshot integrity, new/existing projects, dry-run,
repeat initialization, customized settings, full conflict preflight, existing
imports, CRLF, permissions, malformed markers, non-UTF-8 files, symlinks, hard
links, invalid bundle paths, configured source rejection and the real CLI.

## Package acceptance

Before the package was scoped, `npm pack` generated `doitify-0.1.0.tgz` containing 28 allowlisted files,
including 23 operational instruction files from the canonical workspace.
The package has no runtime dependencies or installation lifecycle hooks.
Developer files, metadata, source repository history and credentials are excluded.

The actual tarball was installed globally into an isolated temporary npm prefix
using `--offline --ignore-scripts`. Its installed `doitify` executable passed:

- Dry-run without changing an existing project.
- Init while preserving existing AGENTS.md content.
- Repeat init without duplicate references.
- Preserving a customized .doitify/project.md.
- No package.json or node_modules created in the user's project.

This was a Linux/local package test, not native Windows/macOS or live MCP/agent
acceptance. The installer makes no MCP calls. Per-file writes are not a whole
installation transaction; concurrent hostile filesystem modification is not
within its security boundary.
