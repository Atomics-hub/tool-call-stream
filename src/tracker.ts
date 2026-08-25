import { inspectJson } from "./json.js";
import type {
  FinishOptions,
  StreamSnapshot,
  ToolCallDelta,
  ToolCallDiagnostic,
  ToolCallEvent,
  ToolCallSnapshot,
  ToolCallStatus,
  ToolCallStream,
  ToolCallStreamOptions,
} from "./types.js";

type MutableCall = {
  key: string;
  sequence: number;
  indexes: Set<number>;
  ids: Set<string>;
  name?: string;
  arguments: string;
  argumentBytes: number;
  status: ToolCallStatus;
  sources: Set<string>;
  metadata: Readonly<Record<string, unknown>>[];
  diagnostics: ToolCallDiagnostic[];
};

const DEFAULTS = {
  maxCalls: 128,
  maxArgumentBytes: 1024 * 1024,
  maxDiagnostics: 256,
  emptyArguments: "object" as const,
};

const encoder = new TextEncoder();

export function createToolCallStream(
  options: ToolCallStreamOptions = {},
): ToolCallStream {
  const config = { ...DEFAULTS, ...options };
  let calls: MutableCall[] = [];
  let byId = new Map<string, MutableCall>();
  let byIndex = new Map<number, MutableCall>();
  let diagnostics: ToolCallDiagnostic[] = [];
  let deltaCount = 0;
  let finished = false;
  let diagnosticLimitReported = false;

  function snapshotCall(call: MutableCall): ToolCallSnapshot {
    return {
      key: call.key,
      sequence: call.sequence,
      indexes: [...call.indexes].sort((a, b) => a - b),
      ids: [...call.ids],
      ...(call.name === undefined ? {} : { name: call.name }),
      arguments: call.arguments,
      json: inspectJson(call.arguments),
      status: call.status,
      sources: [...call.sources],
      metadata: [...call.metadata],
      diagnostics: [...call.diagnostics],
    };
  }

  function snapshot(): StreamSnapshot {
    return {
      finished,
      deltaCount,
      calls: calls.map(snapshotCall),
      diagnostics: [...diagnostics],
    };
  }

  function makeDiagnostic(
    code: ToolCallDiagnostic["code"],
    message: string,
    severity: ToolCallDiagnostic["severity"],
    call?: MutableCall,
  ): ToolCallDiagnostic {
    return {
      code,
      message,
      severity,
      ...(call === undefined ? {} : { callKey: call.key }),
      deltaNumber: deltaCount,
    };
  }

  function record(
    diagnostic: ToolCallDiagnostic,
    events: ToolCallEvent[],
    call?: MutableCall,
  ): void {
    if (diagnostics.length < config.maxDiagnostics) {
      diagnostics.push(diagnostic);
      call?.diagnostics.push(diagnostic);
      events.push({ type: "diagnostic", diagnostic });
      return;
    }
    if (!diagnosticLimitReported) {
      diagnosticLimitReported = true;
      const limit = makeDiagnostic(
        "diagnostic-limit",
        `Diagnostic limit of ${String(config.maxDiagnostics)} reached`,
        "warning",
      );
      events.push({ type: "diagnostic", diagnostic: limit });
    }
  }

  function createCall(events: ToolCallEvent[]): MutableCall | undefined {
    if (calls.length >= config.maxCalls) {
      record(
        makeDiagnostic(
          "call-limit",
          `Call limit of ${String(config.maxCalls)} reached; delta was not retained`,
          "error",
        ),
        events,
      );
      return undefined;
    }
    const call: MutableCall = {
      key: `call-${String(calls.length + 1)}`,
      sequence: calls.length,
      indexes: new Set(),
      ids: new Set(),
      arguments: "",
      argumentBytes: 0,
      status: "streaming",
      sources: new Set(),
      metadata: [],
      diagnostics: [],
    };
    calls.push(call);
    events.push({ type: "call-created", call: snapshotCall(call) });
    return call;
  }

  function resolve(
    delta: ToolCallDelta,
    events: ToolCallEvent[],
  ): MutableCall | undefined {
    const normalizedId = delta.id?.trim();
    const idCall = normalizedId ? byId.get(normalizedId) : undefined;
    const indexCall =
      delta.index === undefined ? undefined : byIndex.get(delta.index);

    if (
      idCall !== undefined &&
      indexCall !== undefined &&
      idCall !== indexCall
    ) {
      const call = createCall(events);
      if (call !== undefined) {
        call.status = "ambiguous";
        record(
          makeDiagnostic(
            "ambiguous-identity",
            `ID ${JSON.stringify(normalizedId)} and index ${String(delta.index)} resolve to different calls`,
            "error",
            call,
          ),
          events,
          call,
        );
      }
      return call;
    }

    const resolved = idCall ?? indexCall;
    if (resolved !== undefined) return resolved;

    const call = createCall(events);
    if (
      call !== undefined &&
      normalizedId === undefined &&
      delta.index === undefined
    ) {
      call.status = "ambiguous";
      record(
        makeDiagnostic(
          "missing-identity",
          "Delta had neither a non-blank ID nor an index; it was isolated instead of guessed",
          "warning",
          call,
        ),
        events,
        call,
      );
    }
    return call;
  }

  function bindIdentity(
    call: MutableCall,
    delta: ToolCallDelta,
    events: ToolCallEvent[],
  ): void {
    const id = delta.id?.trim();
    if (id) {
      const existing = byId.get(id);
      if (existing !== undefined && existing !== call) {
        call.status = "ambiguous";
        record(
          makeDiagnostic(
            "conflicting-id",
            `ID ${JSON.stringify(id)} is already bound to ${existing.key}`,
            "error",
            call,
          ),
          events,
          call,
        );
      } else {
        byId.set(id, call);
        call.ids.add(id);
      }
    }
    if (delta.index !== undefined) {
      const existing = byIndex.get(delta.index);
      if (existing !== undefined && existing !== call) {
        call.status = "ambiguous";
        record(
          makeDiagnostic(
            "conflicting-index",
            `Index ${String(delta.index)} is already bound to ${existing.key}`,
            "error",
            call,
          ),
          events,
          call,
        );
      } else {
        byIndex.set(delta.index, call);
        call.indexes.add(delta.index);
      }
    }
  }

  function push(delta: ToolCallDelta): readonly ToolCallEvent[] {
    const events: ToolCallEvent[] = [];
    deltaCount += 1;
    if (finished) {
      record(
        makeDiagnostic(
          "stream-finished",
          "Cannot push a delta after finish(); call reset() before reuse",
          "error",
        ),
        events,
      );
      return events;
    }
    if (
      delta.index !== undefined &&
      (!Number.isSafeInteger(delta.index) || delta.index < 0)
    ) {
      record(
        makeDiagnostic(
          "invalid-delta",
          "Index must be a non-negative safe integer",
          "error",
        ),
        events,
      );
      return events;
    }

    const call = resolve(delta, events);
    if (call === undefined) return events;
    bindIdentity(call, delta, events);

    if (delta.name !== undefined && delta.name !== "") {
      if (call.name !== undefined && call.name !== delta.name) {
        call.status = "ambiguous";
        record(
          makeDiagnostic(
            "conflicting-name",
            `Tool name changed from ${JSON.stringify(call.name)} to ${JSON.stringify(delta.name)}`,
            "error",
            call,
          ),
          events,
          call,
        );
      } else call.name = delta.name;
    }
    if (delta.source !== undefined) call.sources.add(delta.source);
    if (delta.metadata !== undefined) call.metadata.push(delta.metadata);

    if (delta.argumentsDelta !== undefined && call.status !== "truncated") {
      const bytes = encoder.encode(delta.argumentsDelta).byteLength;
      if (call.argumentBytes + bytes > config.maxArgumentBytes) {
        call.status = "truncated";
        record(
          makeDiagnostic(
            "argument-limit",
            `Arguments exceeded the ${String(config.maxArgumentBytes)}-byte limit`,
            "error",
            call,
          ),
          events,
          call,
        );
      } else {
        call.arguments += delta.argumentsDelta;
        call.argumentBytes += bytes;
      }
    }
    events.push({ type: "call-updated", call: snapshotCall(call) });
    return events;
  }

  function finish(finishOptions: FinishOptions = {}): StreamSnapshot {
    if (finished) return snapshot();
    finished = true;
    const interrupted =
      finishOptions.reason === "cancelled" || finishOptions.reason === "error";
    for (const call of calls) {
      if (call.status === "truncated" || call.status === "ambiguous") continue;
      if (call.arguments.trim() === "" && config.emptyArguments === "object") {
        call.arguments = "{}";
        call.argumentBytes = 2;
      }
      const json = inspectJson(call.arguments);
      if (
        interrupted ||
        json.status === "incomplete" ||
        json.status === "empty"
      ) {
        call.status = "incomplete";
        const diagnostic = makeDiagnostic(
          "incomplete-json",
          interrupted
            ? "Stream ended before the call completed"
            : "Tool arguments are incomplete",
          "warning",
          call,
        );
        if (diagnostics.length < config.maxDiagnostics) {
          diagnostics.push(diagnostic);
          call.diagnostics.push(diagnostic);
        }
      } else if (json.status === "invalid") {
        call.status = "invalid";
        const diagnostic = makeDiagnostic(
          "invalid-json",
          json.error,
          "error",
          call,
        );
        if (diagnostics.length < config.maxDiagnostics) {
          diagnostics.push(diagnostic);
          call.diagnostics.push(diagnostic);
        }
      } else if (json.status === "valid") {
        call.status = "complete";
        if (config.validate !== undefined) {
          const base = snapshotCall(call);
          const result = config.validate(json.value, {
            key: base.key,
            sequence: base.sequence,
            indexes: base.indexes,
            ids: base.ids,
            ...(base.name === undefined ? {} : { name: base.name }),
            arguments: base.arguments,
            status: base.status,
            sources: base.sources,
            metadata: base.metadata,
          });
          if (!result.valid) {
            call.status = "invalid";
            const diagnostic = makeDiagnostic(
              "schema-invalid",
              result.message ?? "Tool arguments failed validation",
              "error",
              call,
            );
            if (diagnostics.length < config.maxDiagnostics) {
              diagnostics.push(diagnostic);
              call.diagnostics.push(diagnostic);
            }
          }
        }
      }
    }
    return snapshot();
  }

  function reset(): void {
    calls = [];
    byId = new Map();
    byIndex = new Map();
    diagnostics = [];
    deltaCount = 0;
    finished = false;
    diagnosticLimitReported = false;
  }

  return { push, finish, snapshot, reset };
}
