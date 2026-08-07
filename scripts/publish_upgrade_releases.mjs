#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const source = path.resolve(process.argv[2] ?? "");
const publish = process.argv.includes("--publish");
const onlyArg = process.argv.find((arg) => arg.startsWith("--hero="));
const onlyHero = onlyArg?.slice("--hero=".length);
const shardArg = process.argv.find((arg) => arg.startsWith("--shard="));
const shardMatch = shardArg?.slice("--shard=".length).match(/^(\d+)\/(\d+)$/);
const shardIndex = shardMatch ? Number(shardMatch[1]) : null;
const shardCount = shardMatch ? Number(shardMatch[2]) : null;
if (shardMatch && (shardIndex < 0 || shardIndex >= shardCount || shardCount < 1)) {
  throw new Error("Shard must use zero-based I/N notation, for example --shard=0/4");
}
const repository = "Sparkies01/DownloadScript";

if (!source) throw new Error("Usage: node scripts/publish_upgrade_releases.mjs <source> [--publish] [--hero=Name]");

const aliases = new Map(Object.entries({
  "Chang-e": "Chang'e",
  "Lou-Yi": "Luo Yi",
  "Luo-Yi": "Luo Yi",
  "Popol-Kupa": "Popol and Kupa",
  "Popol-and-Kupa": "Popol and Kupa",
  Silvana: "Silvanna",
  "X-Borg": "X.Borg",
  "Yi-Sun-shin": "Yi Sun-shin",
  "Yu-Zhong": "Yu Zhong",
}));

const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const assetHeroNames = new Map(Object.entries({
  "Chang'e": "Chang-e",
  "Luo Yi": "Luo-Yi",
  "Popol and Kupa": "Popol-and-Kupa",
  "X.Borg": "X-Borg",
  "Yi Sun-shin": "Yi-Sun-shin",
  "Yu Zhong": "Yu-Zhong",
}));
const displayName = (filename, hero) => filename
  .slice(`${hero}-`.length, -4)
  .replaceAll("-", " ");

const canonicalHeroes = new Set((await readdir(path.join(repoRoot, "Skins", "Visual"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name));
const files = (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"));
const groups = new Map();
const unknown = [];
const collisions = [];
const assetKeys = new Map();

for (const entry of files) {
  const separator = entry.name.indexOf("_");
  if (separator < 1) {
    unknown.push(entry.name);
    continue;
  }
  const prefix = entry.name.slice(0, separator);
  const hero = aliases.get(prefix) ?? prefix;
  if (!canonicalHeroes.has(hero)) {
    unknown.push(entry.name);
    continue;
  }
  const assetHero = assetHeroNames.get(hero) ?? hero;
  const assetName = `${assetHero}-${entry.name.slice(separator + 1)}`;
  const key = `${hero}\0${assetName.toLowerCase()}`;
  if (assetKeys.has(key)) {
    collisions.push([assetKeys.get(key), entry.name]);
    continue;
  }
  assetKeys.set(key, entry.name);
  const items = groups.get(hero) ?? [];
  items.push({ source: path.join(source, entry.name), assetName });
  groups.set(hero, items);
}

const allGroups = [...groups.entries()]
  .sort(([a], [b]) => a.localeCompare(b));
const selected = allGroups
  .filter(([hero]) => !onlyHero || hero === onlyHero)
  .filter((_, index) => shardIndex == null || index % shardCount === shardIndex);
console.log(JSON.stringify({ zipFiles: files.length, heroes: groups.size, unknown: unknown.length, collisions: collisions.length, selectedHeroes: selected.length }));
if (unknown.length || collisions.length) {
  console.error(JSON.stringify({ unknown: unknown.slice(0, 50), collisions: collisions.slice(0, 50) }, null, 2));
  process.exit(2);
}
if (!publish) process.exit(0);

const runGh = (args, options = {}) => execFileSync("gh", args, { encoding: "utf8", stdio: options.capture ? "pipe" : "inherit" });

for (const [hero, items] of selected) {
  items.sort((a, b) => a.assetName.localeCompare(b.assetName));
  const tag = `upgrade-${slugify(hero)}`;
  const view = spawnSync("gh", ["release", "view", tag, "-R", repository], { stdio: "ignore" });
  if (view.status !== 0) {
    runGh(["release", "create", tag, "-R", repository, "--title", `${hero} Upgrade Skins`, "--notes", `Upgrade-skin packages for ${hero}.`]);
  }
  const existingJson = runGh(["release", "view", tag, "-R", repository, "--json", "assets"], { capture: true });
  const existing = new Set(JSON.parse(existingJson).assets.map((asset) => asset.name));
  const pending = items.filter((item) => !existing.has(item.assetName));
  console.log(`[${hero}] total=${items.length} existing=${existing.size} pending=${pending.length}`);

  const staging = path.join(tmpdir(), `upgrade-${slugify(hero)}-${Date.now()}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const item of pending) await symlink(item.source, path.join(staging, item.assetName));
    for (let offset = 0; offset < pending.length; offset += 10) {
      const batch = pending.slice(offset, offset + 10).map((item) => path.join(staging, item.assetName));
      runGh(["release", "upload", tag, "-R", repository, ...batch]);
      console.log(`[${hero}] uploaded=${Math.min(offset + batch.length, pending.length)}/${pending.length}`);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  const lines = [
    `# ${hero} Upgrade Skins`,
    "",
    "Validated upgrade-skin packages. All downloads are published in the",
    `[\`${tag}\`](https://github.com/${repository}/releases/tag/${tag}) release.`,
    "",
    "| Package | Download |",
    "| --- | --- |",
    ...items.map(({ assetName }) => `| ${displayName(assetName, hero)} | [${assetName}](https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(assetName)}) |`),
    "",
  ];
  const readmeDir = path.join(repoRoot, "Skins", "Upgrade", hero);
  await mkdir(readmeDir, { recursive: true });
  await writeFile(path.join(readmeDir, "README.md"), lines.join("\n"));
}
