import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { gzipSync } from "node:zlib";

const core = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
const adapters = readFileSync(
  new URL("../dist/adapters.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(core, /(?:node:|process\.|Buffer\b)/u);
assert.doesNotMatch(adapters, /(?:node:|process\.|Buffer\b)/u);
assert.ok(gzipSync(core).byteLength < 5_000, "core ESM gzip budget exceeded");
assert.ok(
  gzipSync(adapters).byteLength < 2_000,
  "adapter ESM gzip budget exceeded",
);

const api = await import(new URL("../dist/index.js", import.meta.url));
const stream = api.createToolCallStream();
for (let index = 0; index < 128; index += 1) {
  stream.push({ index, id: `stress-${String(index)}`, argumentsDelta: "{" });
}
for (let index = 127; index >= 0; index -= 1) {
  stream.push({ index, argumentsDelta: `"index":${String(index)}}` });
}
const result = stream.finish();
assert.equal(result.calls.length, 128);
assert.ok(result.calls.every((call) => call.status === "complete"));

process.stdout.write(
  `Browser boundary, bundle budgets, and ${String(result.deltaCount)}-delta interleaving smoke test passed.\n`,
);
