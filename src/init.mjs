import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultBundle = fileURLToPath(new URL("../dist/workspace/", import.meta.url));
const hostFiles = ["AGENTS.md", "CLAUDE.md", "README.md"];
const begin = "<!-- doitify:start -->";
const end = "<!-- doitify:end -->";
const block = `${begin}\n## Doitify\n\n@DOITIFY.md\n\nFor Doitify work, read DOITIFY.md alongside existing project rules.\n${end}\n`;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const maxFileBytes = 1024 * 1024;
const statePath = ".doitify/install-state.json";
const packageVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
// Add future agent/user-owned paths here. A trailing slash protects the whole tree.
const userDataDirectories = [
  ".doitify/project-knowledge/",
  ".doitify/follow-ups/",
  ".doitify/plans/",
  ".doitify/reports/",
  ".doitify/agent-scripts/",
];
const userDataPaths = [".doitify/project.md", ...userDataDirectories];
const isUserData = (relative) => userDataPaths.some((entry) =>
  entry.endsWith("/") ? relative.startsWith(entry) : relative === entry);
const writableActions = new Set(["create", "append", "update"]);

async function statOrNull(file) {
  try {
    return await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function safePath(file) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await statOrNull(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${current}`);
    if (current !== absolute && !stat.isDirectory()) {
      throw new Error(`Expected a directory: ${current}`);
    }
  }
  return absolute;
}

async function existingFile(file) {
  await safePath(file);
  const stat = await statOrNull(file);
  if (!stat) return null;
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxFileBytes) {
    throw new Error(`Expected a regular, bounded, non-hard-linked file: ${file}`);
  }
  return { content: await readFile(file), mode: stat.mode & 0o777 };
}

function validBundlePath(relative) {
  if (typeof relative !== "string" || relative.includes("\\") ||
      relative.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return relative === "DOITIFY.md" ||
    relative === ".doitify/project.md" || relative === ".doitify/connection.md" ||
    userDataDirectories.some((directory) => relative === `${directory}README.md`) ||
    /^\.doitify\/(policies|skills|templates|workflows)\/[\w./-]+\.md$/.test(relative);
}

async function loadBundle(bundleDirectory) {
  const manifest = JSON.parse(await readFile(path.join(bundleDirectory, "bundle.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) ||
      manifest.files.length < 3 || manifest.files.length > 200) {
    throw new Error("Invalid bundled workspace manifest.");
  }
  const seen = new Set();
  const files = [];
  for (const entry of manifest.files) {
    if (!validBundlePath(entry.path) || seen.has(entry.path) ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid bundled workspace file.");
    seen.add(entry.path);
    const file = await existingFile(path.join(bundleDirectory, entry.path));
    if (!file || hash(file.content) !== entry.sha256) {
      throw new Error(`Bundled workspace integrity check failed: ${entry.path}`);
    }
    files.push({ path: entry.path, content: file.content });
  }
  for (const required of ["DOITIFY.md", ".doitify/project.md", ".doitify/skills/index.md"]) {
    if (!seen.has(required)) throw new Error(`Incomplete bundled workspace: ${required}`);
  }
  return files;
}

function hostContent(name, previous) {
  if (!previous) return Buffer.from(`# ${name === "README.md" ? "Project" : "Project instructions"}\n\n${block}`);
  const text = previous.content.toString("utf8");
  // Do not damage binary/non-UTF-8 content or create duplicate/malformed blocks.
  if (!Buffer.from(text).equals(previous.content)) throw new Error(`Expected UTF-8 Markdown: ${name}`);
  const starts = text.split(begin).length - 1;
  const ends = text.split(end).length - 1;
  if (starts || ends) {
    if (starts !== 1 || ends !== 1 || text.indexOf(end) < text.indexOf(begin) ||
        !text.slice(text.indexOf(begin), text.indexOf(end)).includes("@DOITIFY.md")) {
      throw new Error(`Malformed Doitify block in ${name}; resolve it manually.`);
    }
    return previous.content;
  }
  if (/^\s*@DOITIFY\.md\s*$/m.test(text)) return previous.content;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const separator = text.endsWith(newline + newline) ? "" : text.endsWith(newline) ? newline : newline + newline;
  return Buffer.concat([previous.content, Buffer.from(separator + block.replaceAll("\n", newline))]);
}

async function loadState(target) {
  const previous = await existingFile(path.join(target, statePath));
  if (!previous) return { previous, hashes: {} };
  let state;
  try {
    state = JSON.parse(previous.content.toString("utf8"));
  } catch {
    throw new Error(`Invalid ${statePath}; restore it from backup before updating.`);
  }
  if (state?.schemaVersion !== 1 || typeof state.packageVersion !== "string" ||
      !state.managedFiles || typeof state.managedFiles !== "object" ||
      Array.isArray(state.managedFiles) ||
      Object.keys(state.managedFiles).length > 200 ||
      Object.entries(state.managedFiles).some(([relative, digest]) =>
        !validBundlePath(relative) || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))) {
    throw new Error(`Invalid ${statePath}; restore it from backup before updating.`);
  }
  // Protection wins even if an older installer used to manage this path.
  const hashes = Object.fromEntries(Object.entries(state.managedFiles).filter(([relative]) => !isUserData(relative)));
  return { previous, hashes };
}

async function planWorkspace({ target = process.cwd(), bundleDirectory = defaultBundle } = {}, update = false) {
  target = await safePath(target);
  const targetStat = await statOrNull(target);
  if (targetStat && !targetStat.isDirectory()) throw new Error(`Target is not a directory: ${target}`);
  const files = await loadBundle(bundleDirectory);
  const state = await loadState(target);
  if (update && !state.previous && !await existingFile(path.join(target, "DOITIFY.md"))) {
    throw new Error("No installed workspace found. Run doitify init first.");
  }
  const actions = [];
  const conflicts = [];
  // Track only this release's managed files; retired files remain untouched.
  const hashes = {};
  for (const file of files) {
    // Update never reads or recreates user data, even if a starter is missing.
    if (update && isUserData(file.path)) {
      actions.push({ action: "preserve", path: file.path });
      continue;
    }
    const destination = path.join(target, file.path);
    const previous = await existingFile(destination);
    let action = "create";
    if (previous) {
      if (previous.content.equals(file.content)) action = "unchanged";
      else if (isUserData(file.path)) action = "preserve";
      else if (update && Object.hasOwn(state.hashes, file.path) &&
          hash(previous.content) === state.hashes[file.path]) action = "update";
      else {
        action = "conflict";
        conflicts.push(file.path);
      }
    }
    if (!isUserData(file.path) && action !== "conflict") hashes[file.path] = hash(file.content);
    actions.push({ action, path: file.path, destination, content: file.content, previous });
  }
  for (const name of update ? [] : hostFiles) {
    const destination = path.join(target, name);
    const previous = await existingFile(destination);
    const content = hostContent(name, previous);
    actions.push({
      action: !previous ? "create" : content.equals(previous.content) ? "unchanged" : "append",
      path: name, destination, previous, content,
    });
  }
  if (conflicts.length) {
    throw new Error(`Existing files differ from this workspace; nothing was written:\n${conflicts.join("\n")}\n${
      update
        ? "These files are locally modified or have no verified installation baseline. Back up and merge manually using a fresh init in a separate temporary folder."
        : "Use doitify update for an installed workspace, or resolve manually."
    }\nNo --force overwrite is available.`);
  }
  const content = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    packageVersion,
    managedFiles: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b, "en"))),
  }, null, 2)}\n`);
  actions.push({
    action: !state.previous ? "create" : state.previous.content.equals(content) ? "unchanged" : "update",
    path: statePath, destination: path.join(target, statePath), content, previous: state.previous,
  });
  return { target, actions };
}

export const planInit = (options = {}) => planWorkspace(options);
export const planUpdate = (options = {}) => planWorkspace(options, true);

async function writeAction(action) {
  const { destination, content, previous } = action;
  await safePath(destination);
  await mkdir(path.dirname(destination), { recursive: true });
  if (!previous) {
    const handle = await open(destination, "wx", 0o600);
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return;
  }
  const current = await existingFile(destination);
  if (!current || !current.content.equals(previous.content)) {
    throw new Error(`File changed during installation: ${destination}; rerun after reviewing.`);
  }
  const temporary = `${destination}.doitify-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", previous.mode);
    await handle.writeFile(content);
    await handle.chmod(previous.mode);
    await handle.close();
    handle = null;
    const latest = await existingFile(destination);
    if (!latest || !latest.content.equals(previous.content)) {
      throw new Error(`File changed during installation: ${destination}; review before retrying.`);
    }
    // Atomic replacement per host file, not a transaction across the installation.
    await rename(temporary, destination);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function applyPlan(plan, options) {
  if (!options.dryRun) {
    // Recheck planned effects before the first write.
    for (const action of plan.actions) {
      if (!writableActions.has(action.action)) continue;
      const current = await existingFile(action.destination);
      if ((action.previous === null) !== (current === null) ||
          (current && !current.content.equals(action.previous.content))) {
        throw new Error(`File changed during preflight: ${action.path}; nothing was written.`);
      }
    }
    for (const action of plan.actions) {
      if (writableActions.has(action.action)) await writeAction(action);
    }
  }
  return {
    target: plan.target,
    dryRun: Boolean(options.dryRun),
    actions: plan.actions.map(({ action, path: relative }) => ({ action, path: relative })),
  };
}

export const initWorkspace = async (options = {}) => applyPlan(await planInit(options), options);
export const updateWorkspace = async (options = {}) => applyPlan(await planUpdate(options), options);
