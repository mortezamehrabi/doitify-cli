#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { initWorkspace } from "../src/init.mjs";

const help = `Doitify — add MCP instructions to any project

Usage:
  doitify init [--target PATH] [--dry-run]
  doitify --help
  doitify --version

Adds .doitify/ and DOITIFY.md, then references DOITIFY.md from
AGENTS.md, CLAUDE.md and README.md without replacing existing content.
Preserves project settings. Does not log in or change MCP configuration.
`;

try {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0])) ||
      (args.length === 2 && args[0] === "init" && ["--help", "-h"].includes(args[1]))) {
    console.log(help);
  } else if (args.length === 1 && ["--version", "-v"].includes(args[0])) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
  } else {
    if (args[0] !== "init") throw new Error("Unknown command. Use doitify --help.");
    const options = {};
    const seen = new Set();
    for (let i = 1; i < args.length; i++) {
      const flag = args[i];
      if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
      seen.add(flag);
      if (flag === "--dry-run") options.dryRun = true;
      else if (flag === "--target") {
        const target = args[++i];
        if (!target || target.startsWith("--")) throw new Error("--target requires a path.");
        options.target = target;
      } else throw new Error(`Unknown option: ${flag}. Use doitify --help.`);
    }
    const result = await initWorkspace(options);
    console.log(`${result.dryRun ? "Preview" : "Initialized"}: ${result.target}`);
    for (const item of result.actions) console.log(`  ${item.action.padEnd(9)} ${item.path}`);
    if (result.dryRun) console.log("Dry run: no files were written.");
    else console.log('\nNext: ask your agent to "Read DOITIFY.md and initialize this project for Doitify."');
  }
} catch (error) {
  console.error(`doitify: ${error.message}`);
  process.exitCode = 1;
}
