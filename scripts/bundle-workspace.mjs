import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const canonicalWorkspace = path.resolve(root, "../doitify-agent-workspace");
const output = path.join(root, "dist/workspace");
const sourcePaths = [
  "DOITIFY.md",
  ".doitify/project.md",
  ".doitify/connection.md",
  ".doitify/policies",
  ".doitify/skills",
  ".doitify/workflows",
  ".doitify/templates",
];
const digest = (data) => createHash("sha256").update(data).digest("hex");

export async function collectWorkspace(source) {
  const files = [];
  async function collect(relative) {
    const full = path.join(source, relative);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new Error(`Workspace symlink is not allowed: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(full)).sort()) {
        await collect(`${relative}/${name}`);
      }
      return;
    }
    if (!stat.isFile() || !relative.endsWith(".md") || stat.size > 1024 * 1024) {
      throw new Error(`Unexpected workspace content: ${relative}`);
    }
    files.push({ path: relative, content: await readFile(full) });
  }
  for (const relative of sourcePaths) await collect(relative);
  const settings = files.find((file) => file.path === ".doitify/project.md").content.toString("utf8");
  if (!settings.includes("Status: not configured") ||
      !settings.includes("Approved Board IDs: none selected")) {
    throw new Error("Refusing to bundle configured project settings. Restore the public template first.");
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

export async function bundleWorkspace(source = canonicalWorkspace) {
  // Read/validate the full explicit allowlist before changing generated output.
  const files = await collectWorkspace(path.resolve(source));
  // Only this package's generated, gitignored snapshot is replaced.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const file of files) {
    const destination = path.join(output, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }
  const manifest = {
    schemaVersion: 1,
    files: files.map((file) => ({ path: file.path, sha256: digest(file.content) })),
  };
  await writeFile(path.join(output, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--workspace")) {
      throw new Error("Usage: node scripts/bundle-workspace.mjs [--workspace PATH]");
    }
    const manifest = await bundleWorkspace(args[1] || canonicalWorkspace);
    console.log(`Bundled ${manifest.files.length} instruction files from the canonical workspace.`);
  } catch (error) {
    console.error(`Cannot build workspace snapshot: ${error.message}`);
    process.exitCode = 1;
  }
}
