#!/usr/bin/env node
// Convert a gethomepage.dev config folder into Page's YAML.
//
//   npm run import:homepage -- /path/to/homepage/config            # preview + warnings
//   npm run import:homepage -- /path/to/homepage/config --write    # write into ./config (backs up first)
//
// Needs Node 22.18+ / 24 (runs the TypeScript converter directly).
import fs from "node:fs";
import path from "node:path";
import { convertHomepage, toYaml } from "../src/lib/import/homepage.ts";

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith("--"));
const write = args.includes("--write");
const target = process.env.HOMEPAGE_CONFIG_DIR ?? path.join(process.cwd(), "config");

if (!source) {
  console.error("Usage: npm run import:homepage -- <homepage config folder> [--write]");
  process.exit(1);
}

const read = (name) => {
  for (const ext of ["yaml", "yml"]) {
    const p = path.join(source, `${name}.${ext}`);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return undefined;
};

const result = convertHomepage({
  services: read("services"),
  bookmarks: read("bookmarks"),
  settings: read("settings"),
  widgets: read("widgets"),
  docker: read("docker"),
});
const yaml = toYaml(result);

const groups = result.services.length;
const services = result.services.reduce((a, g) => a + g.services.length, 0);
console.log(`Converted ${services} services in ${groups} groups, ${result.bookmarks.length} bookmark groups, ${result.widgets.length} info widgets.`);
if (result.warnings.length) {
  console.log(`\n${result.warnings.length} note(s):`);
  for (const w of result.warnings) console.log(`  - ${w}`);
}

if (!write) {
  console.log("\n--- services.yaml ---\n" + yaml.services);
  console.log("Nothing was written. Re-run with --write to save into " + target);
  process.exit(0);
}

fs.mkdirSync(target, { recursive: true });
const backup = path.join(target, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
for (const [name, content] of Object.entries(yaml)) {
  const file = path.join(target, `${name}.yaml`);
  if (fs.existsSync(file)) {
    fs.mkdirSync(backup, { recursive: true });
    fs.copyFileSync(file, path.join(backup, `${name}.yaml`));
  }
  fs.writeFileSync(file, content);
}
console.log(`\nWrote ${Object.keys(yaml).join(", ")}.yaml to ${target}${fs.existsSync(backup) ? ` (previous files in ${backup})` : ""}.`);
