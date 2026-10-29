#!/usr/bin/env node
/**
 * Apply a semver string to package.json, src-tauri/tauri.conf.json, and Cargo.toml.
 * Usage: node scripts/apply-version.mjs <semver>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2]?.trim();

if (!version || !/^\d+\.\d+\.\d+([.-].+)?$/.test(version)) {
  console.error("Usage: node scripts/apply-version.mjs <semver>");
  process.exit(1);
}

function writeJson(rel, mutate) {
  const file = path.join(root, rel);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(data);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`updated ${rel} -> ${version}`);
}

writeJson("package.json", (pkg) => {
  pkg.version = version;
});

writeJson("src-tauri/tauri.conf.json", (cfg) => {
  cfg.version = version;
});

const cargoPath = path.join(root, "src-tauri/Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf8");
if (!/^version\s*=\s*"[^"]+"/m.test(cargo)) {
  console.error("No package version field found in src-tauri/Cargo.toml");
  process.exit(1);
}
const next = cargo.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${version}"`,
);
fs.writeFileSync(cargoPath, next);
console.log(`updated src-tauri/Cargo.toml -> ${version}`);
