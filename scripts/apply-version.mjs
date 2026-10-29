#!/usr/bin/env node
/**
 * Stamp GitVersion (or argv) semver into package.json, tauri.conf.json, and Cargo.toml.
 * Usage: node scripts/apply-version.mjs <semver> [majorMinorPatch]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const semVer = process.argv[2] || process.env.GITVERSION_SEMVER;
const majorMinorPatch =
  process.argv[3] ||
  process.env.GITVERSION_MAJORMINORPATCH ||
  (semVer ? semVer.split("-")[0].split("+")[0] : "");

if (!semVer || !majorMinorPatch) {
  console.error(
    "apply-version: need semver (argv or GITVERSION_SEMVER / GITVERSION_MAJORMINORPATCH)",
  );
  process.exit(1);
}

function writeJson(path, mutate) {
  const full = resolve(root, path);
  const data = JSON.parse(readFileSync(full, "utf8"));
  mutate(data);
  writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
}

writeJson("package.json", (pkg) => {
  pkg.version = semVer;
});

writeJson("src-tauri/tauri.conf.json", (conf) => {
  conf.version = majorMinorPatch;
});

const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
const nextCargo = cargo.replace(
  /^(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m,
  `$1"${majorMinorPatch}"`,
);
if (nextCargo === cargo && !cargo.includes(`version = "${majorMinorPatch}"`)) {
  console.error("apply-version: failed to update src-tauri/Cargo.toml version");
  process.exit(1);
}
writeFileSync(cargoPath, nextCargo);

console.log(`apply-version: package=${semVer} tauri/cargo=${majorMinorPatch}`);
