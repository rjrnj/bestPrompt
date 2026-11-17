// Checks that a release tag (v1.2.3) matches the app version in all three
// places it is kept. Usage: node scripts/check-version.mjs <tag>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The version line inside Cargo.toml's [package] section only.
function cargoVersion(cargoToml) {
  const section = /^\[package\]\r?\n((?:(?!\[).*\r?\n?)*)/m.exec(cargoToml);
  const line = section && /^version\s*=\s*"([^"]+)"/m.exec(section[1]);
  return line?.[1];
}

// The "version" field of a JSON file's text, or a thrown Error naming it.
function jsonVersion(file, text) {
  try {
    return JSON.parse(text).version;
  } catch (error) {
    throw new Error(`couldn't read ${file}: ${error.message}`, {
      cause: error,
    });
  }
}

export function checkVersion(tag, { packageJson, tauriConf, cargoToml }) {
  let versions;
  try {
    versions = {
      "package.json": jsonVersion("package.json", packageJson),
      "tauri.conf.json": jsonVersion("tauri.conf.json", tauriConf),
      "Cargo.toml": cargoVersion(cargoToml),
    };
  } catch (error) {
    return error.message;
  }
  const missing = Object.keys(versions).find(
    (file) => typeof versions[file] !== "string",
  );
  if (missing) return `no version found in ${missing}`;
  const unique = new Set(Object.values(versions));
  if (unique.size > 1) {
    const list = Object.entries(versions)
      .map(([file, version]) => `${file} ${version}`)
      .join(", ");
    return `the versions disagree: ${list}`;
  }
  const [version] = unique;
  if (!tag.startsWith("v")) return `tag ${tag} must start with "v"`;
  if (tag !== `v${version}`) {
    return `tag ${tag} doesn't match the app version ${version}`;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  if (!tag) {
    console.error("usage: node scripts/check-version.mjs <tag>");
    process.exit(1);
  }
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const error = checkVersion(tag, {
    packageJson: read("package.json"),
    tauriConf: read("src-tauri/tauri.conf.json"),
    cargoToml: read("src-tauri/Cargo.toml"),
  });
  if (error) {
    console.error(error);
    process.exit(1);
  }
}
