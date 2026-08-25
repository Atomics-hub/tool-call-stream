import { describe, expect, it } from "vitest";
import { createToolCallStream, inspectJson } from "../src/index.js";

describe("createToolCallStream", () => {
  it("assembles interleaved parallel calls", () => {
    const stream = createToolCallStream();
    stream.push({
      index: 7,
      id: "a",
      name: "weather",
      argumentsDelta: '{"city"',
    });
    stream.push({ index: 9, id: "b", name: "search", argumentsDelta: '{"q"' });
    stream.push({ index: 7, argumentsDelta: ':"Paris"}' });
    stream.push({ index: 9, argumentsDelta: ':"AI"}' });
    const result = stream.finish();
    expect(result.calls).toHaveLength(2);
    expect(result.calls.map((call) => call.status)).toEqual([
      "complete",
      "complete",
    ]);
    expect(result.calls[0]?.json).toEqual({
      status: "valid",
      value: { city: "Paris" },
    });
  });

  it("supports non-zero starting indexes and late IDs", () => {
    const stream = createToolCallStream();
    stream.push({ index: 42, name: "answer", argumentsDelta: "{" });
    stream.push({ index: 42, id: "late", argumentsDelta: '"ok":true}' });
    const call = stream.finish().calls[0];
    expect(call?.ids).toEqual(["late"]);
    expect(call?.status).toBe("complete");
  });

  it("isolates identity-free deltas instead of guessing", () => {
    const stream = createToolCallStream();
    stream.push({ name: "a", argumentsDelta: "{}" });
    stream.push({ name: "b", argumentsDelta: "{}" });
    const result = stream.finish();
    expect(result.calls).toHaveLength(2);
    expect(result.calls.every((call) => call.status === "ambiguous")).toBe(
      true,
    );
    expect(
      result.diagnostics.filter((item) => item.code === "missing-identity"),
    ).toHaveLength(2);
  });

  it("does not merge conflicting ID and index mappings", () => {
    const stream = createToolCallStream();
    stream.push({ index: 0, id: "one", argumentsDelta: "{}" });
    stream.push({ index: 1, id: "two", argumentsDelta: "{}" });
    stream.push({ index: 1, id: "one" });
    const result = stream.finish();
    expect(result.calls).toHaveLength(3);
    expect(result.calls[2]?.status).toBe("ambiguous");
    expect(
      result.diagnostics.some((item) => item.code === "ambiguous-identity"),
    ).toBe(true);
  });

  it("retains source metadata and diagnoses name conflicts", () => {
    const stream = createToolCallStream();
    stream.push({
      index: 2,
      id: "named",
      name: "first",
      source: "test",
      metadata: { event: 1 },
      argumentsDelta: "{}",
    });
    stream.push({ index: 2, name: "second" });
    const call = stream.finish().calls[0];
    expect(call?.status).toBe("ambiguous");
    expect(call?.sources).toEqual(["test"]);
    expect(call?.metadata).toEqual([{ event: 1 }]);
    expect(call?.diagnostics[0]?.code).toBe("conflicting-name");
  });

  it("preserves interrupted and malformed calls", () => {
    const interrupted = createToolCallStream();
    interrupted.push({ index: 0, argumentsDelta: '{"query":"hel' });
    expect(interrupted.finish({ reason: "error" }).calls[0]?.status).toBe(
      "incomplete",
    );

    const malformed = createToolCallStream();
    malformed.push({ index: 0, argumentsDelta: '{"x":]}' });
    expect(malformed.finish().calls[0]?.status).toBe("invalid");
  });

  it("normalizes empty arguments for parameterless tools", () => {
    const stream = createToolCallStream();
    stream.push({ index: 0, id: "empty", name: "ping", argumentsDelta: "" });
    const call = stream.finish().calls[0];
    expect(call?.arguments).toBe("{}");
    expect(call?.status).toBe("complete");
  });

  it("enforces call, argument, and diagnostic limits", () => {
    const stream = createToolCallStream({
      maxCalls: 1,
      maxArgumentBytes: 3,
      maxDiagnostics: 1,
    });
    stream.push({ index: 0, argumentsDelta: "four" });
    stream.push({ index: 1, argumentsDelta: "{}" });
    stream.push({ index: -1 });
    const result = stream.finish();
    expect(result.calls[0]?.status).toBe("truncated");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("validates completed arguments", () => {
    const stream = createToolCallStream({
      validate: (value) =>
        typeof value === "object" && value !== null && "required" in value
          ? { valid: true }
          : { valid: false, message: "required is missing" },
    });
    stream.push({ index: 0, argumentsDelta: "{}" });
    const result = stream.finish();
    expect(result.calls[0]?.status).toBe("invalid");
    expect(result.diagnostics[0]?.code).toBe("schema-invalid");
  });

  it("rejects pushes after finish and can reset", () => {
    const stream = createToolCallStream();
    stream.finish();
    expect(
      stream.push({ index: 0 }).some((event) => event.type === "diagnostic"),
    ).toBe(true);
    stream.reset();
    stream.push({ index: 0, argumentsDelta: "{}" });
    expect(stream.finish().calls).toHaveLength(1);
  });
});

describe("inspectJson", () => {
  it.each([
    ["", "empty"],
    ["{}", "valid"],
    ['{"x":"unterminated', "incomplete"],
    ['{"x":]', "invalid"],
  ])("classifies %j as %s", (input, status) => {
    expect(inspectJson(input).status).toBe(status);
  });
});
