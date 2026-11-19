import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleWorkspace, canonicalWorkspace, collectWorkspace } from "../scripts/bundle-workspace.mjs";
import { initWorkspace, planInit } from "../src/init.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "bin/doitify.mjs");
const bundle = path.join(root, "dist/workspace");
const packageInfo = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
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
  assert.equal(result.actions.filter((item) => item.action === "create").length, manifest.files.length + 3);
  assert.deepEqual(await readFile(path.join(target, "DOITIFY.md")), await readFile(path.join(bundle, "DOITIFY.md")));
  for (const name of ["AGENTS.md", "CLAUDE.md", "README.md"]) {
    assert.match(await readFile(path.join(target, name), "utf8"), /^@DOITIFY\.md$/m);
  }
  assert.equal(await lstat(path.join(target, "package.json")).catch(() => null), null);
  assert.equal(await lstat(path.join(target, ".doitify/.etc")).catch(() => null), null);
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
  assert.match(readme, /npx @doitify\/cli@latest init/);
  assert.match(readme, /npm install -g @doitify\/cli@latest/);
  assert.doesNotMatch(readme, /npx doitify|npm install -g doitify/);
  assert.match(readme, /does not upgrade the workspace files/);
  assert.match(readme, /npm version patch --no-git-tag-version/);
  assert.match(readme, /separate temporary folder/);
});
