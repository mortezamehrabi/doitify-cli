import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleWorkspace, canonicalWorkspace, collectWorkspace } from "../scripts/bundle-workspace.mjs";
import { initWorkspace, planInit, updateWorkspace } from "../src/init.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "bin/doitify.mjs");
const bundle = path.join(root, "dist/workspace");
const packageInfo = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const protectedDirectories = ["project-knowledge", "follow-ups", "plans", "reports", "agent-scripts"];
let manifest;
before(async () => { manifest = await bundleWorkspace(); });

async function sandbox(t) {
  const base = await mkdtemp(path.join(tmpdir(), "doitify-cli-test-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

test("bundled files match the canonical source and exclude development files", async () => {
  assert.ok(manifest.files.length > 20);
  for (const file of manifest.files) {
    const source = await readFile(path.join(canonicalWorkspace, file.path));
    const packed = await readFile(path.join(bundle, file.path));
    assert.deepEqual(packed, source);
    assert.equal(createHash("sha256").update(packed).digest("hex"), file.sha256);
    assert.doesNotMatch(file.path, /\.etc|AGENT_RULES|feature\.meta|\.git|\.py$/);
  }
});

test("new folder gets the workspace and all three discovery references", async (t) => {
  const base = await sandbox(t);
  const target = path.join(base, "new", "project with spaces");
  const result = await initWorkspace({ target });
  assert.equal(result.dryRun, false);
  assert.equal(result.actions.filter((item) => item.action === "create").length, manifest.files.length + 4);
  assert.deepEqual(await readFile(path.join(target, "DOITIFY.md")), await readFile(path.join(bundle, "DOITIFY.md")));
  for (const name of ["AGENTS.md", "CLAUDE.md", "README.md"]) {
    assert.match(await readFile(path.join(target, name), "utf8"), /^@DOITIFY\.md$/m);
  }
  assert.equal(await lstat(path.join(target, "package.json")).catch(() => null), null);
  assert.equal(await lstat(path.join(target, ".doitify/.etc")).catch(() => null), null);
  assert.match(
    await readFile(path.join(target, ".doitify/project-knowledge/README.md"), "utf8"),
    /# Project knowledge/,
  );
});

test("knowledge starter is bundled but learned notes are not collected", async (t) => {
  const source = await sandbox(t);
  for (const file of manifest.files) {
    const full = path.join(source, file.path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, await readFile(path.join(bundle, file.path)));
  }
  const privateNotes = path.join(source, ".doitify/project-knowledge/private");
  await mkdir(privateNotes);
  await writeFile(path.join(privateNotes, "decisions.md"), "PRIVATE_PROJECT_FACT\n");
  const files = await collectWorkspace(source);
  assert.deepEqual(
    files.filter((file) => file.path.startsWith(".doitify/project-knowledge/")).map((file) => file.path),
    [".doitify/project-knowledge/README.md"],
  );
  assert.ok(files.every((file) => !file.content.includes("PRIVATE_PROJECT_FACT")));
});

test("reinitialization preserves project-specific knowledge", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const note = path.join(target, ".doitify/project-knowledge/decisions.md");
  await writeFile(note, "Confirmed user decisions\n");
  await initWorkspace({ target });
  assert.equal(await readFile(note, "utf8"), "Confirmed user decisions\n");
});

test("customized knowledge index is preserved on init", async (t) => {
  const target = await sandbox(t);
  const knowledge = path.join(target, ".doitify/project-knowledge");
  await mkdir(knowledge, { recursive: true });
  await writeFile(path.join(knowledge, "README.md"), "# My knowledge index\n");
  const result = await initWorkspace({ target });
  assert.equal(result.actions.find((item) => item.path === ".doitify/project-knowledge/README.md").action, "preserve");
  assert.equal(await readFile(path.join(knowledge, "README.md"), "utf8"), "# My knowledge index\n");
  assert.ok((await lstat(path.join(target, "DOITIFY.md"))).isFile());
});

test("dry-run of a new folder creates no folder or parent", async (t) => {
  const base = await sandbox(t);
  const target = path.join(base, "missing", "project");
  const result = await initWorkspace({ target, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.ok(result.actions.some((item) => item.action === "create"));
  assert.deepEqual(await readdir(base), []);
});

test("existing project files are preserved and only discovery blocks are appended", async (t) => {
  const target = await sandbox(t);
  const old = "# Existing instructions\nDo not deploy.\n";
  for (const name of ["AGENTS.md", "CLAUDE.md", "README.md"]) {
    await writeFile(path.join(target, name), old);
  }
  const pkg = '{"name":"existing-python-or-js-project","private":true}\n';
  await writeFile(path.join(target, "package.json"), pkg);
  await writeFile(path.join(target, ".env"), "PRIVATE_DATA=not-for-the-installer\n");
  const result = await initWorkspace({ target });
  assert.equal(result.actions.filter((item) => item.action === "append").length, 3);
  for (const name of ["AGENTS.md", "CLAUDE.md", "README.md"]) {
    assert.ok((await readFile(path.join(target, name), "utf8")).startsWith(old));
  }
  assert.equal(await readFile(path.join(target, "package.json"), "utf8"), pkg);
  assert.equal(await readFile(path.join(target, ".env"), "utf8"), "PRIVATE_DATA=not-for-the-installer\n");
});

test("second init is a no-op, including files' modification times", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const beforeStat = await lstat(path.join(target, "README.md"));
  const result = await initWorkspace({ target });
  assert.ok(result.actions.every((item) => item.action === "unchanged"));
  assert.equal((await lstat(path.join(target, "README.md"))).mtimeMs, beforeStat.mtimeMs);
  const readme = await readFile(path.join(target, "README.md"), "utf8");
  assert.equal(readme.split("@DOITIFY.md").length - 1, 1);
});

test("customized project settings are preserved on init", async (t) => {
  const target = await sandbox(t);
  await mkdir(path.join(target, ".doitify"));
  const settings = "# User mission\nUse only the approved Board; custom timezone.\n";
  await writeFile(path.join(target, ".doitify/project.md"), settings);
  const result = await initWorkspace({ target });
  assert.equal(result.actions.find((item) => item.path === ".doitify/project.md").action, "preserve");
  assert.equal(await readFile(path.join(target, ".doitify/project.md"), "utf8"), settings);
});

test("different DOITIFY.md aborts before any new file or discovery block", async (t) => {
  const target = await sandbox(t);
  await writeFile(path.join(target, "DOITIFY.md"), "My customized rules\n");
  await writeFile(path.join(target, "AGENTS.md"), "Host rules\n");
  await assert.rejects(initWorkspace({ target }), /nothing was written/);
  assert.equal(await readFile(path.join(target, "AGENTS.md"), "utf8"), "Host rules\n");
  assert.deepEqual((await readdir(target)).sort(), ["AGENTS.md", "DOITIFY.md"]);
});

test("a conflict deep in the skill library aborts the complete plan", async (t) => {
  const target = await sandbox(t);
  await mkdir(path.join(target, ".doitify/skills/task-management"), { recursive: true });
  await writeFile(path.join(target, ".doitify/skills/task-management/SKILL.md"), "Customized skill\n");
  await assert.rejects(initWorkspace({ target }), /task-management/);
  assert.deepEqual(await readdir(target), [".doitify"]);
  assert.equal(await lstat(path.join(target, ".doitify/project.md")).catch(() => null), null);
});

test("an existing standalone import is not duplicated", async (t) => {
  const target = await sandbox(t);
  const content = "# Host\n\n@DOITIFY.md\n";
  await writeFile(path.join(target, "CLAUDE.md"), content);
  await initWorkspace({ target });
  assert.equal(await readFile(path.join(target, "CLAUDE.md"), "utf8"), content);
});

test("a mere mention in text is not mistaken for a standalone import", async (t) => {
  const target = await sandbox(t);
  await writeFile(path.join(target, "README.md"), "Example: use @DOITIFY.md later.\n");
  await initWorkspace({ target });
  assert.match(await readFile(path.join(target, "README.md"), "utf8"), /^@DOITIFY\.md$/m);
});

test("CRLF host content is preserved and CRLF is used for appended text", async (t) => {
  const target = await sandbox(t);
  const old = "# Host\r\nDo not deploy.\r\n";
  await writeFile(path.join(target, "AGENTS.md"), old);
  await initWorkspace({ target });
  const content = await readFile(path.join(target, "AGENTS.md"), "utf8");
  assert.ok(content.startsWith(old));
  assert.doesNotMatch(content, /(?<!\r)\n/);
});

test("host files without a final newline are preserved exactly as a prefix", async (t) => {
  const target = await sandbox(t);
  const old = "# Host instructions";
  await writeFile(path.join(target, "AGENTS.md"), old);
  await initWorkspace({ target });
  assert.ok((await readFile(path.join(target, "AGENTS.md"), "utf8")).startsWith(`${old}\n\n`));
});

test("existing host permissions survive replacement", { skip: process.platform === "win32" }, async (t) => {
  const target = await sandbox(t);
  const host = path.join(target, "AGENTS.md");
  await writeFile(host, "Host rules\n");
  await chmod(host, 0o664);
  await initWorkspace({ target });
  assert.equal((await lstat(host)).mode & 0o777, 0o664);
});

test("an unmatched or duplicate discovery marker aborts before writing", async (t) => {
  for (const content of [
    "<!-- doitify:start -->\n",
    "<!-- doitify:end -->\n<!-- doitify:start -->\n",
    "<!-- doitify:start -->\nNo import\n<!-- doitify:end -->\n",
    "<!-- doitify:start -->\n@DOITIFY.md\n<!-- doitify:end -->\n<!-- doitify:end -->",
  ]) {
    const target = await sandbox(t);
    await writeFile(path.join(target, "AGENTS.md"), content);
    await assert.rejects(initWorkspace({ target }), /Malformed Doitify block/);
    assert.deepEqual(await readdir(target), ["AGENTS.md"]);
  }
});

test("non-UTF-8 host files are not rewritten", async (t) => {
  const target = await sandbox(t);
  await writeFile(path.join(target, "README.md"), Buffer.from([0xff, 0xfe, 0x61]));
  await assert.rejects(initWorkspace({ target }), /UTF-8/);
  assert.deepEqual(await readdir(target), ["README.md"]);
});

test("symlink workspace destinations do not write outside the project", { skip: process.platform === "win32" }, async (t) => {
  const base = await sandbox(t);
  const target = path.join(base, "project");
  const outside = path.join(base, "outside");
  await mkdir(target);
  await mkdir(outside);
  await symlink(outside, path.join(target, ".doitify"));
  await assert.rejects(initWorkspace({ target }), /symbolic link/);
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(target), [".doitify"]);
});

test("symlink host files and target ancestors are rejected", { skip: process.platform === "win32" }, async (t) => {
  const base = await sandbox(t);
  const target = path.join(base, "project");
  await mkdir(target);
  await writeFile(path.join(base, "outside.md"), "Untouched\n");
  await symlink(path.join(base, "outside.md"), path.join(target, "AGENTS.md"));
  await assert.rejects(initWorkspace({ target }), /symbolic link/);
  assert.equal(await readFile(path.join(base, "outside.md"), "utf8"), "Untouched\n");
  await symlink(target, path.join(base, "alias"));
  await assert.rejects(initWorkspace({ target: path.join(base, "alias/child") }), /symbolic link/);
});

test("hard-linked host files are rejected without modifying their other link", async (t) => {
  const base = await sandbox(t);
  const target = path.join(base, "project");
  await mkdir(target);
  await writeFile(path.join(base, "outside.md"), "Untouched\n");
  await link(path.join(base, "outside.md"), path.join(target, "AGENTS.md"));
  await assert.rejects(initWorkspace({ target }), /non-hard-linked/);
  assert.equal(await readFile(path.join(base, "outside.md"), "utf8"), "Untouched\n");
});

test("directories or ancestor files cannot masquerade as destination files", async (t) => {
  const target = await sandbox(t);
  await mkdir(path.join(target, "README.md"));
  await assert.rejects(initWorkspace({ target }), /regular/);
  assert.deepEqual(await readdir(target), ["README.md"]);
  const other = await sandbox(t);
  await writeFile(path.join(other, ".doitify"), "Not a folder\n");
  await assert.rejects(initWorkspace({ target: other }), /directory/);
  assert.deepEqual(await readdir(other), [".doitify"]);
});

test("a corrupted bundle fails integrity checks before creating a target", async (t) => {
  const base = await sandbox(t);
  const fake = path.join(base, "bundle");
  await mkdir(fake);
  await writeFile(path.join(fake, "bundle.json"), JSON.stringify({
    schemaVersion: 1, files: [
      { path: "../outside.md", sha256: "a".repeat(64) },
      { path: "DOITIFY.md", sha256: "a".repeat(64) },
      { path: ".doitify/project.md", sha256: "a".repeat(64) },
    ],
  }));
  const target = path.join(base, "target");
  await assert.rejects(planInit({ target, bundleDirectory: fake }), /Invalid bundled/);
  assert.equal(await lstat(target).catch(() => null), null);
});

test("configured source templates cannot be bundled for publication", async (t) => {
  const source = await sandbox(t);
  for (const file of manifest.files) {
    const full = path.join(source, file.path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, await readFile(path.join(bundle, file.path)));
  }
  await writeFile(path.join(source, ".doitify/project.md"), "Status: configured\nPrivate settings\n");
  await assert.rejects(collectWorkspace(source), /configured project settings/);
});

test("CLI supports help, version and a real no-write preview", async (t) => {
  const base = await sandbox(t);
  assert.match(execFileSync(process.execPath, [binary, "--help"], { encoding: "utf8" }), /Usage:/);
  assert.match(execFileSync(process.execPath, [binary, "init", "--help"], { encoding: "utf8" }), /Usage:/);
  assert.equal(execFileSync(process.execPath, [binary, "--version"], { encoding: "utf8" }).trim(), packageInfo.version);
  const target = path.join(base, "new project");
  const output = execFileSync(process.execPath, [binary, "init", "--target", target, "--dry-run"], { encoding: "utf8" });
  assert.match(output, /no files were written/);
  assert.equal(await lstat(target).catch(() => null), null);
});

test("CLI rejects unknown and missing options without touching the target", async (t) => {
  const target = await sandbox(t);
  for (const args of [
    ["init", "--force"], ["init", "--target"], ["init", "--target", "--dry-run"],
    ["init", "--dry-run", "--dry-run"], ["delete"],
  ]) {
    const result = spawnSync(process.execPath, [binary, ...args], { cwd: target, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /doitify:/);
    assert.deepEqual(await readdir(target), []);
  }
});

test("CLI defaults to current working directory and supports repeat invocation", async (t) => {
  const target = await sandbox(t);
  execFileSync(process.execPath, [binary, "init"], { cwd: target, encoding: "utf8" });
  const result = execFileSync(process.execPath, [binary, "init"], { cwd: target, encoding: "utf8" });
  assert.match(result, /unchanged/);
  assert.doesNotMatch(result, / {2}create /);
});

test("public README uses the scoped package and explains CLI versus workspace updates", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.equal(packageInfo.name, "@doitify/cli");
  assert.match(readme, /\[Visit Doitify\]\(https:\/\/doitify\.com\)/);
  assert.match(readme, /\[npm package\]\(https:\/\/www\.npmjs\.com\/package\/@doitify\/cli\)/);
  assert.match(readme, /npx @doitify\/cli@latest init/);
  assert.match(readme, /npm install -g @doitify\/cli@latest/);
  assert.doesNotMatch(readme, /npx doitify|npm install -g doitify/);
  assert.match(readme, /does not upgrade the workspace files/);
  assert.match(readme, /npx @doitify\/cli@latest update --dry-run/);
  assert.match(readme, /install-state\.json/);
  assert.doesNotMatch(readme, /npm (?:version|publish|test|run check|pack)\b/);
  assert.match(readme, /https:\/\/github\.com\/mortezamehrabi\/doitify-cli\/blob\/main\/CONTRIBUTING\.md/);
  const contributing = await readFile(path.join(root, "CONTRIBUTING.md"), "utf8");
  for (const command of [
    "npm version patch --no-git-tag-version", "npm test", "npm run check",
    "npm pack --dry-run", "npm publish --access public",
  ]) assert.ok(contributing.includes(command));
  assert.match(readme, /separate temporary folder/);
});

// Produce a different verified bundle without touching canonical sources.
async function nextBundle(t, changes) {
  const directory = await sandbox(t);
  const entries = new Map();
  for (const file of manifest.files) entries.set(file.path, await readFile(path.join(bundle, file.path)));
  for (const [relative, content] of Object.entries(changes)) {
    if (content === null) entries.delete(relative);
    else entries.set(relative, Buffer.from(content));
  }
  const files = [];
  for (const [relative, content] of entries) {
    const full = path.join(directory, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
    files.push({ path: relative, sha256: createHash("sha256").update(content).digest("hex") });
  }
  await writeFile(path.join(directory, "bundle.json"), JSON.stringify({ schemaVersion: 1, files }));
  return directory;
}

test("update upgrades verified instructions but preserves all project data and host files", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const personal = {
    ".doitify/project.md": "Confirmed mission and Board ID\n",
    ".doitify/project-knowledge/README.md": "# Personal index\n",
    ".doitify/project-knowledge/preferences.md": "User preferences\n",
    ".doitify/future-data.md": "Future agent-owned data\n",
    "AGENTS.md": "Custom instructions without import\n",
    "CLAUDE.md": "Custom Claude instructions\n",
    "README.md": "Custom project README\n",
  };
  const stats = {};
  for (const [relative, content] of Object.entries(personal)) {
    await writeFile(path.join(target, relative), content);
    stats[relative] = await lstat(path.join(target, relative));
  }
  const bundleDirectory = await nextBundle(t, {
    "DOITIFY.md": "# New official instructions\n",
    ".doitify/project.md": "A changed public project starter\n",
    ".doitify/project-knowledge/README.md": "A changed public index\n",
    ".doitify/policies/new-policy.md": "# New policy\n",
  });
  const result = await updateWorkspace({ target, bundleDirectory });
  assert.equal(result.actions.find((item) => item.path === "DOITIFY.md").action, "update");
  assert.equal(await readFile(path.join(target, "DOITIFY.md"), "utf8"), "# New official instructions\n");
  assert.equal(await readFile(path.join(target, ".doitify/policies/new-policy.md"), "utf8"), "# New policy\n");
  for (const [relative, content] of Object.entries(personal)) {
    assert.equal(await readFile(path.join(target, relative), "utf8"), content);
    assert.equal((await lstat(path.join(target, relative))).mtimeMs, stats[relative].mtimeMs);
  }
  const state = JSON.parse(await readFile(path.join(target, ".doitify/install-state.json"), "utf8"));
  assert.equal(state.managedFiles[".doitify/project.md"], undefined);
  assert.equal(state.managedFiles[".doitify/project-knowledge/README.md"], undefined);
  assert.equal(state.managedFiles["AGENTS.md"], undefined);
  const repeated = await updateWorkspace({ target, bundleDirectory });
  assert.ok(repeated.actions.every((item) => ["unchanged", "preserve"].includes(item.action)));
});

test("update conflicts abort all writes, including baseline and new files", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const baseline = await readFile(path.join(target, ".doitify/install-state.json"));
  const original = await readFile(path.join(target, "DOITIFY.md"));
  const skill = ".doitify/skills/task-management/SKILL.md";
  await writeFile(path.join(target, skill), "Personal modifications\n");
  const bundleDirectory = await nextBundle(t, {
    "DOITIFY.md": "New instructions\n",
    [skill]: "New official skill\n",
    ".doitify/policies/added.md": "New policy\n",
  });
  for (const dryRun of [true, false]) {
    await assert.rejects(updateWorkspace({ target, bundleDirectory, dryRun }), /locally modified/);
  }
  assert.deepEqual(await readFile(path.join(target, "DOITIFY.md")), original);
  assert.deepEqual(await readFile(path.join(target, ".doitify/install-state.json")), baseline);
  assert.equal(await readFile(path.join(target, skill), "utf8"), "Personal modifications\n");
  assert.equal(await lstat(path.join(target, ".doitify/policies/added.md")).catch(() => null), null);
});

test("update preserves local managed edits even when upstream has not changed", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  await writeFile(path.join(target, "DOITIFY.md"), "Personal edits\n");
  await assert.rejects(updateWorkspace({ target }), /nothing was written/);
  assert.equal(await readFile(path.join(target, "DOITIFY.md"), "utf8"), "Personal edits\n");
});

test("update dry-run changes neither content nor modification times", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const original = await readFile(path.join(target, "DOITIFY.md"));
  const beforeStat = await lstat(path.join(target, "DOITIFY.md"));
  const baseline = await readFile(path.join(target, ".doitify/install-state.json"));
  const bundleDirectory = await nextBundle(t, { "DOITIFY.md": "Updated instructions\n" });
  const result = await updateWorkspace({ target, bundleDirectory, dryRun: true });
  assert.ok(result.actions.some((item) => item.action === "update"));
  assert.deepEqual(await readFile(path.join(target, "DOITIFY.md")), original);
  assert.equal((await lstat(path.join(target, "DOITIFY.md"))).mtimeMs, beforeStat.mtimeMs);
  assert.deepEqual(await readFile(path.join(target, ".doitify/install-state.json")), baseline);
});

test("update requires an existing workspace and creates no missing target", async (t) => {
  const base = await sandbox(t);
  const target = path.join(base, "missing");
  await assert.rejects(updateWorkspace({ target }), /Run doitify init first/);
  assert.deepEqual(await readdir(base), []);
});

test("update adopts matching legacy files but never guesses a differing legacy baseline", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  await rm(path.join(target, ".doitify/install-state.json"));
  const bundleDirectory = await nextBundle(t, { "DOITIFY.md": "Updated instructions\n" });
  await assert.rejects(updateWorkspace({ target, bundleDirectory }), /no verified installation baseline/);
  assert.equal(await lstat(path.join(target, ".doitify/install-state.json")).catch(() => null), null);
  await updateWorkspace({ target }); // Matching files can safely establish a baseline.
  await updateWorkspace({ target, bundleDirectory });
  assert.equal(await readFile(path.join(target, "DOITIFY.md"), "utf8"), "Updated instructions\n");
});

test("update never deletes retired files or recreates missing user data", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const retired = ".doitify/templates/activity.md";
  const original = await readFile(path.join(target, retired));
  await rm(path.join(target, ".doitify/project.md"));
  await rm(path.join(target, ".doitify/project-knowledge/README.md"));
  const bundleDirectory = await nextBundle(t, { [retired]: null });
  await updateWorkspace({ target, bundleDirectory });
  assert.deepEqual(await readFile(path.join(target, retired)), original);
  assert.equal(await lstat(path.join(target, ".doitify/project.md")).catch(() => null), null);
  assert.equal(await lstat(path.join(target, ".doitify/project-knowledge/README.md")).catch(() => null), null);
});

test("a newly managed path cannot overwrite a preexisting custom file", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const relative = ".doitify/policies/future.md";
  await writeFile(path.join(target, relative), "Custom local policy\n");
  const bundleDirectory = await nextBundle(t, { [relative]: "New official policy\n" });
  await assert.rejects(updateWorkspace({ target, bundleDirectory }), /nothing was written/);
  assert.equal(await readFile(path.join(target, relative), "utf8"), "Custom local policy\n");
});

test("corrupt, unsupported or unsafe install state aborts without writes", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const original = await readFile(path.join(target, "DOITIFY.md"));
  const bundleDirectory = await nextBundle(t, { "DOITIFY.md": "Updated\n" });
  for (const state of [
    "{",
    JSON.stringify({ schemaVersion: 2, packageVersion: "1", managedFiles: {} }),
    JSON.stringify({ schemaVersion: 1, packageVersion: "1", managedFiles: { "../escape": "a".repeat(64) } }),
  ]) {
    await writeFile(path.join(target, ".doitify/install-state.json"), state);
    await assert.rejects(updateWorkspace({ target, bundleDirectory }), /Invalid .doitify\/install-state.json/);
    assert.deepEqual(await readFile(path.join(target, "DOITIFY.md")), original);
  }
});

test("update rejects symlink and hard-linked managed files and install state", { skip: process.platform === "win32" }, async (t) => {
  for (const relative of ["DOITIFY.md", ".doitify/install-state.json"]) {
    for (const makeLink of [symlink, link]) {
      const base = await sandbox(t);
      const target = path.join(base, "project");
      await initWorkspace({ target });
      const destination = path.join(target, relative);
      const outside = path.join(base, "outside");
      const original = await readFile(destination);
      await writeFile(outside, original);
      await rm(destination);
      await makeLink(outside, destination);
      await assert.rejects(updateWorkspace({ target }), /symbolic link|non-hard-linked/);
      assert.deepEqual(await readFile(outside), original);
    }
  }
});

test("CLI update accepts help/target/dry-run and rejects force", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  assert.match(execFileSync(process.execPath, [binary, "update", "--help"], { encoding: "utf8" }), /doitify update/);
  const result = execFileSync(process.execPath, [binary, "update", "--target", target, "--dry-run"], { encoding: "utf8" });
  assert.match(result, /no files were written/);
  assert.match(result, /preserve.*project-knowledge\/README.md/);
  assert.equal(spawnSync(process.execPath, [binary, "update", "--force"], { cwd: target }).status, 1);
});

test("real CLI updates an older verified installation and leaves user knowledge intact", async (t) => {
  const target = await sandbox(t);
  const oldBundle = await nextBundle(t, { "DOITIFY.md": "Older official instructions\n" });
  await initWorkspace({ target, bundleDirectory: oldBundle });
  const note = path.join(target, ".doitify/project-knowledge/README.md");
  await writeFile(note, "# My learned context\n");
  const baseline = await readFile(path.join(target, ".doitify/install-state.json"));
  await assert.rejects(initWorkspace({ target }), /Use doitify update/);
  assert.deepEqual(await readFile(path.join(target, ".doitify/install-state.json")), baseline);
  const output = execFileSync(process.execPath, [binary, "update"], { cwd: target, encoding: "utf8" });
  assert.match(output, /update\s+DOITIFY.md/);
  assert.deepEqual(await readFile(path.join(target, "DOITIFY.md")), await readFile(path.join(bundle, "DOITIFY.md")));
  assert.equal(await readFile(note, "utf8"), "# My learned context\n");
});

test("user-data protection overrides a previously recorded managed hash", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const stateFile = path.join(target, ".doitify/install-state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  for (const relative of [".doitify/project.md", ".doitify/project-knowledge/README.md"]) {
    const original = await readFile(path.join(target, relative));
    state.managedFiles[relative] = createHash("sha256").update(original).digest("hex");
  }
  await writeFile(stateFile, JSON.stringify(state));
  const bundleDirectory = await nextBundle(t, {
    ".doitify/project.md": "New starter\n",
    ".doitify/project-knowledge/README.md": "New index\n",
  });
  await updateWorkspace({ target, bundleDirectory });
  assert.deepEqual(await readFile(path.join(target, ".doitify/project.md")), await readFile(path.join(bundle, ".doitify/project.md")));
  const updatedState = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(updatedState.managedFiles[".doitify/project.md"], undefined);
  assert.equal(updatedState.managedFiles[".doitify/project-knowledge/README.md"], undefined);
});

test("all local workflow directories preserve customized indexes and generated contents on init and update", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const personal = new Map();
  for (const directory of protectedDirectories) {
    const relative = `.doitify/${directory}`;
    await mkdir(path.join(target, relative, "nested"));
    personal.set(`${relative}/README.md`, `# Personal ${directory} index\n`);
    personal.set(`${relative}/nested/item.md`, `Private ${directory} record\n`);
  }
  personal.set(".doitify/agent-scripts/check-replies.sh", "#!/bin/sh\n# Local helper; never run by installer\n");
  const before = new Map();
  for (const [relative, content] of personal) {
    await writeFile(path.join(target, relative), content);
    before.set(relative, await lstat(path.join(target, relative)));
  }
  await initWorkspace({ target });
  const changes = Object.fromEntries(protectedDirectories.map((directory) => [
    `.doitify/${directory}/README.md`, `# New vendor ${directory} starter\n`,
  ]));
  changes["DOITIFY.md"] = "New official instructions\n";
  const bundleDirectory = await nextBundle(t, changes);
  await updateWorkspace({ target, bundleDirectory });
  for (const [relative, content] of personal) {
    assert.equal(await readFile(path.join(target, relative), "utf8"), content);
    assert.equal((await lstat(path.join(target, relative))).mtimeMs, before.get(relative).mtimeMs);
  }
  const state = JSON.parse(await readFile(path.join(target, ".doitify/install-state.json"), "utf8"));
  assert.ok(Object.keys(state.managedFiles).every((relative) =>
    !protectedDirectories.some((directory) => relative.startsWith(`.doitify/${directory}/`))));
});

test("distribution includes only public workflow starters, never local records or executable helpers", async (t) => {
  const source = await sandbox(t);
  for (const file of manifest.files) {
    const destination = path.join(source, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(path.join(bundle, file.path)));
  }
  for (const directory of protectedDirectories) {
    await mkdir(path.join(source, ".doitify", directory, "private"));
    await writeFile(path.join(source, ".doitify", directory, "private", "record.md"), "PRIVATE_LOCAL_DATA\n");
  }
  await writeFile(path.join(source, ".doitify/agent-scripts/check.sh"), "#!/bin/sh\nPRIVATE_LOCAL_DATA\n");
  const collected = await collectWorkspace(source);
  for (const directory of protectedDirectories) {
    assert.deepEqual(
      collected.filter((file) => file.path.startsWith(`.doitify/${directory}/`)).map((file) => file.path),
      [`.doitify/${directory}/README.md`],
    );
  }
  assert.ok(collected.every((file) => !file.content.includes("PRIVATE_LOCAL_DATA")));
});

test("update leaves deliberately absent protected workflow indexes absent", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  for (const directory of protectedDirectories) await rm(path.join(target, ".doitify", directory, "README.md"));
  await updateWorkspace({ target });
  for (const directory of protectedDirectories) {
    assert.equal(await lstat(path.join(target, ".doitify", directory, "README.md")).catch(() => null), null);
  }
});

test("an older tracked hash cannot override new workflow-directory protection", async (t) => {
  const target = await sandbox(t);
  await initWorkspace({ target });
  const stateFile = path.join(target, ".doitify/install-state.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const changes = {};
  for (const directory of protectedDirectories) {
    const relative = `.doitify/${directory}/README.md`;
    state.managedFiles[relative] = createHash("sha256").update(await readFile(path.join(target, relative))).digest("hex");
    changes[relative] = "Changed official starter\n";
  }
  await writeFile(stateFile, JSON.stringify(state));
  await updateWorkspace({ target, bundleDirectory: await nextBundle(t, changes) });
  for (const directory of protectedDirectories) {
    const relative = `.doitify/${directory}/README.md`;
    assert.deepEqual(await readFile(path.join(target, relative)), await readFile(path.join(bundle, relative)));
  }
});
