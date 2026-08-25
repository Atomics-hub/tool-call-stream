import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);
assert.equal(
  packageJson.dependencies,
  undefined,
  "published package must have zero runtime dependencies",
);

const esm = await import(new URL("dist/index.js", root));
const adapters = await import(new URL("dist/adapters.js", root));
const require = createRequire(import.meta.url);
const cjs = require(fileURLToPath(new URL("dist/index.cjs", root)));
for (const api of [esm, cjs]) {
  const stream = api.createToolCallStream();
  stream.push({ index: 2, id: "package", name: "verify", argumentsDelta: "{" });
  stream.push({ index: 2, argumentsDelta: '"ok":true}' });
  const call = stream.finish().calls[0];
  assert.equal(call.status, "complete");
  assert.deepEqual(call.json.value, { ok: true });
}
assert.equal(adapters.fromOpenAIChatChunk({ choices: [] }).length, 0);

const directory = mkdtempSync(join(tmpdir(), "tool-call-stream-"));
const fixture = join(directory, "stream.ndjson");
writeFileSync(
  fixture,
  [
    '{"index":4,"id":"cli","name":"go","argumentsDelta":"{"}',
    '{"index":4,"argumentsDelta":"\\"x\\":1}"}',
  ].join("\n"),
);
const cli = fileURLToPath(new URL("dist/cli.js", root));
assert.match(
  execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
  /^tool-call-stream replay/u,
);
assert.equal(
  execFileSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  }).trim(),
  packageJson.version,
);
assert.match(
  execFileSync(process.execPath, [cli, "replay", fixture], {
    encoding: "utf8",
  }),
  /1 calls/u,
);
const json = JSON.parse(
  execFileSync(process.execPath, [cli, "replay", fixture, "--json"], {
    encoding: "utf8",
  }),
);
assert.equal(json.calls[0].status, "complete");

process.stdout.write(
  "ESM, CommonJS, adapters, CLI, NDJSON replay, and package metadata verification passed.\n",
);
