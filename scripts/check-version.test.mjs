import { describe, expect, it } from "vitest";
import { checkVersion } from "./check-version.mjs";

const cargoToml = (version) =>
  `[package]\nname = "bestprompt"\nversion = "${version}"\n\n[dependencies]\ntauri = { version = "2" }\n`;

const files = (pkg, tauri, cargo) => ({
  packageJson: JSON.stringify({ version: pkg }),
  tauriConf: JSON.stringify({ version: tauri }),
  cargoToml: cargoToml(cargo),
});

describe("the_tag_must_match_the_app_version", () => {
  it("accepts a tag that matches all three versions", () => {
    expect(checkVersion("v0.1.0", files("0.1.0", "0.1.0", "0.1.0"))).toBeNull();
  });

  it("rejects a tag for a different version", () => {
    expect(checkVersion("v0.2.0", files("0.1.0", "0.1.0", "0.1.0"))).toBe(
      "tag v0.2.0 doesn't match the app version 0.1.0",
    );
  });

  it("rejects a tag without the leading v", () => {
    expect(checkVersion("0.1.0", files("0.1.0", "0.1.0", "0.1.0"))).toBe(
      'tag 0.1.0 must start with "v"',
    );
  });

  it("rejects versions that disagree, even when the tag matches one", () => {
    expect(checkVersion("v0.1.0", files("0.1.0", "0.1.1", "0.1.0"))).toBe(
      "the versions disagree: package.json 0.1.0, tauri.conf.json 0.1.1, Cargo.toml 0.1.0",
    );
  });

  it("reads the version from the package section, not a dependency", () => {
    const input = {
      ...files("0.1.0", "0.1.0", "0.1.0"),
      cargoToml: `[dependencies]\nfoo = { version = "9.9.9" }\n\n[package]\nname = "x"\nversion = "0.1.0"\n`,
    };
    expect(checkVersion("v0.1.0", input)).toBeNull();
  });

  it("ignores a dependency's version after the package section", () => {
    const withVersion = {
      ...files("0.1.0", "0.1.0", "0.1.0"),
      cargoToml: `[package]\nname = "x"\nversion = "0.1.0"\n\n[dependencies.foo]\nversion = "9.9.9"\n`,
    };
    expect(checkVersion("v0.1.0", withVersion)).toBeNull();
    const without = {
      ...withVersion,
      cargoToml: `[package]\nname = "x"\n\n[dependencies.foo]\nversion = "0.1.0"\n`,
    };
    expect(checkVersion("v0.1.0", without)).toBe(
      "no version found in Cargo.toml",
    );
  });

  it("rejects a missing version, even when all three are missing", () => {
    const input = {
      packageJson: "{}",
      tauriConf: "{}",
      cargoToml: `[package]\nname = "x"\n`,
    };
    expect(checkVersion("vmissing", input)).toBe(
      "no version found in package.json",
    );
  });

  it("names a file that isn't valid JSON", () => {
    const input = { ...files("0.1.0", "0.1.0", "0.1.0"), tauriConf: "{" };
    expect(checkVersion("v0.1.0", input)).toMatch(
      /^couldn't read tauri\.conf\.json: /,
    );
  });
});
