#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { createToolCallStream } from "./tracker.js";
import type { ToolCallDelta } from "./types.js";

const HELP = `tool-call-stream replay <file|-> [--json] [--reason end|cancelled|error]

Replay normalized tool-call deltas from a JSON array or NDJSON file.

Options:
  --json       Print the complete machine-readable result
  --reason     Select how the stream ended (default: end)
  --help       Show this help
  --version    Show the installed version
`;

async function input(path: string): Promise<string> {
  if (path === "-") {
    process.stdin.setEncoding("utf8");
    let result = "";
    for await (const chunk of process.stdin) result += String(chunk);
    return result;
  }
  return readFile(path, "utf8");
}

function parseDeltas(raw: string): ToolCallDelta[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[")) {
    const value = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(value)) throw new Error("Expected a JSON array");
    return value as ToolCallDelta[];
  }
  return trimmed
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line) as ToolCallDelta);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    process.stdout.write(HELP);
    return;
  }
  if (args.includes("--version")) {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }
  if (args[0] !== "replay" || args[1] === undefined) {
    throw new Error("Expected: tool-call-stream replay <file|->");
  }
  const reasonIndex = args.indexOf("--reason");
  const reason = reasonIndex === -1 ? "end" : args[reasonIndex + 1];
  if (reason !== "end" && reason !== "cancelled" && reason !== "error") {
    throw new Error("--reason must be end, cancelled, or error");
  }

  const tracker = createToolCallStream();
  const deltas = parseDeltas(await input(args[1]));
  for (const delta of deltas) tracker.push(delta);
  const result = tracker.finish({ reason });
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `Replayed ${String(result.deltaCount)} deltas into ${String(result.calls.length)} calls.\n`,
  );
  for (const call of result.calls) {
    const identity = call.ids[0] ?? call.indexes[0] ?? call.key;
    process.stdout.write(
      `${String(identity)}  ${call.name ?? "<unnamed>"}  ${call.status}  ${String(call.arguments.length)} chars\n`,
    );
  }
  for (const diagnostic of result.diagnostics) {
    process.stdout.write(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}\n`,
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
