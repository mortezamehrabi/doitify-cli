#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { initWorkspace, updateWorkspace } from "../src/init.mjs";

const help = `Doitify — add MCP instructions to any project

Usage:
  doitify init [--target PATH] [--dry-run]
  doitify update [--target PATH] [--dry-run]
  doitify --help
  doitify --version

Adds .doitify/ and DOITIFY.md, then references DOITIFY.md from
AGENTS.md, CLAUDE.md and README.md without replacing existing content.
Update replaces only verified, unmodified managed files. Project settings,
knowledge, follow-ups, plans, reports and agent-scripts are protected.
Host instructions are untouched by update.
Missing user-owned folders receive starter indexes; existing contents are kept.
Does not log in or change MCP configuration. No files are deleted.
Init/update print agent guidance for optional automatic monitoring; they do not schedule jobs.
`;

try {
  const args = process.argv.slice(2);
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0])) ||
      (args.length === 2 && ["init", "update"].includes(args[0]) && ["--help", "-h"].includes(args[1]))) {
    console.log(help);
  } else if (args.length === 1 && ["--version", "-v"].includes(args[0])) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
  } else {
    if (!["init", "update"].includes(args[0])) throw new Error("Unknown command. Use doitify --help.");
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
    const updating = args[0] === "update";
    const result = await (updating ? updateWorkspace : initWorkspace)(options);
    console.log(`${result.dryRun ? "Preview" : updating ? "Updated" : "Initialized"}: ${result.target}`);
    for (const item of result.actions) console.log(`  ${item.action.padEnd(9)} ${item.path}`);
    if (result.dryRun) console.log("Dry run: no files were written.");
    else {
      if (updating) console.log("\nInstructions updated. Your settings, knowledge, follow-ups, plans, reports and agent scripts were preserved.");
      console.log(`\nNext: ask your agent to "Read DOITIFY.md, ${updating ? "review the updated workspace" : "initialize this project"}, and follow .doitify/skills/automatic-monitoring/SKILL.md to review an existing schedule or offer periodic checks."`);
      console.log("Scheduling is optional: your agent verifies client/model support and asks for one-time authorization. This command did not create or change scheduled jobs.");
    }
  }
} catch (error) {
  console.error(`doitify: ${error.message}`);
  process.exitCode = 1;
}
