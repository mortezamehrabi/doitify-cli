# Local verification

The current source adds safe `update` support. These changes have not been
published as part of this task; installation from npm requires a separate release.

## Automated tests

```text
npm test
45 passed; 0 failed; 0 skipped

npm run check
All four JavaScript modules passed Node syntax checks.
```

No ESLint executable is available in the current environment. The package's
`check` command uses Node syntax checks; no lint dependency was installed.

Tests cover canonical-source snapshot integrity, new/existing projects, dry-run,
repeat initialization, customized settings, full conflict preflight, existing
imports, CRLF, permissions, malformed markers, non-UTF-8 files, symlinks, hard
links, invalid bundle paths, configured source rejection and the real CLI.
Update checks additionally cover verified instruction replacement, local-edit
conflicts before all writes, protected user data (including the knowledge index),
unchanged host files, dry-run, repeat update, new/retired managed paths, legacy
installs without a baseline, corrupt metadata, symlink/hard-link rejection,
protected paths previously tracked as managed, and actual CLI init/update cycles.
Installation hashes contain only managed instruction paths and content digests.
Protected-directory tests include customized follow-up/plan/report indexes,
nested records and generated `.sh` helpers. They cover repeat init, update,
missing-index preservation, prior managed hashes and exclusion from distribution.

## Package acceptance

The current `npm pack --dry-run` includes 33 allowlisted files, including 28
operational instruction files from the canonical workspace. Project-specific
knowledge and the local-only publishing script are excluded.
The package has no runtime dependencies or installation lifecycle hooks.
Developer files, metadata, source repository history and credentials are excluded.

Historically, the initial tarball was installed globally into an isolated temporary npm prefix
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
