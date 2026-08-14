import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const files = {
  package: new URL("../package.json", import.meta.url),
  tauri: new URL("../src-tauri/tauri.conf.json", import.meta.url),
  cargo: new URL("../src-tauri/Cargo.toml", import.meta.url),
  lock: new URL("../src-tauri/Cargo.lock", import.meta.url),
};

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function cargoVersion(contents, header, name) {
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^${escapedHeader}\\nname = "${escapedName}"\\nversion = ")([^"]+)(")`,
    "m",
  );
  const match = contents.match(pattern);
  if (!match) throw new Error(`Could not find the ${name} version in ${header}.`);
  return { pattern, version: match[2] };
}

const [packageText, tauriText, cargoText, lockText] = await Promise.all([
  readFile(files.package, "utf8"),
  readFile(files.tauri, "utf8"),
  readFile(files.cargo, "utf8"),
  readFile(files.lock, "utf8"),
]);

const packageJson = JSON.parse(packageText);
const tauriJson = JSON.parse(tauriText);
const cargo = cargoVersion(cargoText, "[package]", "platypus");
const lock = cargoVersion(lockText, "[[package]]", "platypus");
const versions = new Map([
  ["package.json", packageJson.version],
  ["src-tauri/tauri.conf.json", tauriJson.version],
  ["src-tauri/Cargo.toml", cargo.version],
  ["src-tauri/Cargo.lock", lock.version],
]);
const uniqueVersions = new Set(versions.values());
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

if (uniqueVersions.size !== 1) {
  const details = [...versions].map(([file, version]) => `  ${file}: ${version}`).join("\n");
  throw new Error(`PLATYPUS versions are inconsistent:\n${details}`);
}

const currentVersion = packageJson.version;
if (args.length === 1 && args[0] === "--check") {
  console.log(`PLATYPUS versions are consistent at ${currentVersion}.`);
  process.exit(0);
}

const requestedVersion = args[0]?.replace(/^v/, "");
if (!requestedVersion || !semverPattern.test(requestedVersion) || args.length !== 1) {
  console.error("Usage: vp run version:set -- <semantic-version>");
  process.exit(1);
}

packageJson.version = requestedVersion;
tauriJson.version = requestedVersion;

await Promise.all([
  writeFile(files.package, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(files.tauri, `${JSON.stringify(tauriJson, null, 2)}\n`),
  writeFile(files.cargo, cargoText.replace(cargo.pattern, `$1${requestedVersion}$3`)),
  writeFile(files.lock, lockText.replace(lock.pattern, `$1${requestedVersion}$3`)),
]);

console.log(`Updated PLATYPUS from ${currentVersion} to ${requestedVersion}.`);
