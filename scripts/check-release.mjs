import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const changelog = readFileSync(
  new URL("../CHANGELOG.md", import.meta.url),
  "utf8",
);
assert.match(packageJson.version, /^\d+\.\d+\.\d+$/u);
assert.ok(
  changelog.includes(`## ${packageJson.version}`),
  "CHANGELOG must contain the package version",
);
assert.equal(packageJson.private, undefined);
const releaseTag = process.env.RELEASE_TAG;
if (releaseTag !== undefined) {
  assert.equal(
    releaseTag,
    `v${packageJson.version}`,
    "release tag must exactly match the package version",
  );
}
process.stdout.write(
  `Release metadata for ${packageJson.name}@${packageJson.version} is consistent.\n`,
);
