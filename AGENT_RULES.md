# Doitify CLI development

- Read feature.meta.json first. This package is a file installer, not an agent runner.
- Keep the raw workspace independent of Node and npm.
- The sibling doitify-agent-workspace is the canonical instruction source.
- Bundle only explicit operational paths; no downloaded code, credentials or development history.
- No runtime dependencies, postinstall hooks, telemetry, network requests or account management.
- Preserve host files and project settings. Preflight all conflicts before writing.
- Never add --force or silent replacement. Dry-run must not write anything.
- Do not publish to npm without the user's explicit request.
- Run npm test, npm run check and inspect npm pack before releasing.
