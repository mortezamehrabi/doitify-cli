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

export async function planInit({ target = process.cwd(), bundleDirectory = defaultBundle } = {}) {
  target = await safePath(target);
  const targetStat = await statOrNull(target);
  if (targetStat && !targetStat.isDirectory()) throw new Error(`Target is not a directory: ${target}`);
  const files = await loadBundle(bundleDirectory);
  const actions = [];
  const conflicts = [];
  for (const file of files) {
    const destination = path.join(target, file.path);
    const previous = await existingFile(destination);
    let action = "create";
    if (previous) {
      if (previous.content.equals(file.content)) action = "unchanged";
      else if (file.path === ".doitify/project.md") action = "preserve";
      else {
        action = "conflict";
        conflicts.push(file.path);
      }
    }
    actions.push({ action, path: file.path, destination, content: file.content, previous });
  }
  for (const name of hostFiles) {
    const destination = path.join(target, name);
    const previous = await existingFile(destination);
    const content = hostContent(name, previous);
    actions.push({
      action: !previous ? "create" : content.equals(previous.content) ? "unchanged" : "append",
      path: name, destination, previous, content,
    });
  }
  if (conflicts.length) {
    throw new Error(`Existing files differ from this workspace; nothing was written:\n${conflicts.join("\n")}\nResolve manually. No --force overwrite is available.`);
  }
  return { target, actions };
}

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
    throw new Error(`File changed during initialization: ${destination}; rerun after reviewing.`);
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
      throw new Error(`File changed during initialization: ${destination}; review before retrying.`);
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

export async function initWorkspace(options = {}) {
  const plan = await planInit(options);
  if (!options.dryRun) {
    // Recheck planned effects before the first write.
    for (const action of plan.actions) {
      if (!["create", "append"].includes(action.action)) continue;
      const current = await existingFile(action.destination);
      if ((action.previous === null) !== (current === null) ||
          (current && !current.content.equals(action.previous.content))) {
        throw new Error(`File changed during preflight: ${action.path}; nothing was written.`);
      }
    }
    for (const action of plan.actions) {
      if (["create", "append"].includes(action.action)) await writeAction(action);
    }
  }
  return {
    target: plan.target,
    dryRun: Boolean(options.dryRun),
    actions: plan.actions.map(({ action, path: relative }) => ({ action, path: relative })),
  };
}
