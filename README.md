# tool-call-stream

The conformance-grade state machine for streamed AI tool calls.

`tool-call-stream` reconstructs parallel function calls without assuming IDs arrive on time, indexes start at zero, JSON completes, or providers end streams cleanly. It preserves broken calls with actionable diagnostics instead of crashing, dropping them, or silently merging unrelated calls.

```bash
npm install tool-call-stream
```

## Why

Tool-call streams are deceptively hostile:

- IDs can be blank, late, duplicated, or absent.
- Providers can start at a non-zero index.
- Several calls can interleave.
- A connection can end halfway through `partial_json`.
- Empty arguments may arrive as an empty string.
- Malformed JSON may appear only after many valid deltas.

This package treats those cases as state-machine inputs, not surprises.

## Usage

```ts
import { createToolCallStream } from "tool-call-stream";

const stream = createToolCallStream();

stream.push({
  index: 7,
  id: "call_weather",
  name: "weather",
  argumentsDelta: '{"city"',
  source: "openai-chat",
});
stream.push({ index: 7, argumentsDelta: ':"Paris"}' });

const result = stream.finish();
const call = result.calls[0];

call.status; // "complete"
call.json; // { status: "valid", value: { city: "Paris" } }
```

The normalized delta type is deliberately tiny. Provider SDKs remain optional and your core stream logic remains portable.

## Provider adapters

```ts
import { createToolCallStream } from "tool-call-stream";
import { fromOpenAIChatChunk } from "tool-call-stream/adapters";

const stream = createToolCallStream();

for await (const chunk of completion) {
  for (const delta of fromOpenAIChatChunk(chunk)) stream.push(delta);
}

const result = stream.finish();
```

Adapters are included for:

- OpenAI Chat Completions
- Anthropic Messages
- Vercel AI SDK stream parts
- Gemini candidate function calls

They accept `unknown`, perform structural checks, and import no provider SDK types.

## Interrupted streams

Always report why a stream ended:

```ts
const result = stream.finish({ reason: "error" });

result.calls[0]?.status; // "incomplete"
result.calls[0]?.arguments; // the exact partial payload is preserved
```

## Conservative identity

An ID and index that resolve to different calls are never guessed into one. An identity-free delta is isolated. Both produce diagnostics. This may create an extra incomplete call, but it cannot corrupt two valid calls by silently combining their arguments.

## Limits and validation

```ts
const stream = createToolCallStream({
  maxCalls: 64,
  maxArgumentBytes: 256_000,
  maxDiagnostics: 100,
  validate(value) {
    return typeof value === "object" && value !== null && "city" in value
      ? { valid: true }
      : { valid: false, message: "city is required" };
  },
});
```

Defaults are 128 calls, 1 MiB of arguments per call, and 256 retained diagnostics. These bounds make hostile or accidental unbounded streams safe to process.

## Replay CLI

Feed the CLI a JSON array or newline-delimited JSON containing normalized deltas:

```bash
npx tool-call-stream replay broken-stream.ndjson
npx tool-call-stream replay broken-stream.ndjson --json
npx tool-call-stream replay broken-stream.ndjson --reason error
```

This makes provider bugs reproducible in tests and issue reports.

## Statuses

- `streaming`: deltas are still being accepted.
- `complete`: arguments contain valid JSON and optional validation passed.
- `incomplete`: the stream ended early or JSON was unfinished.
- `invalid`: JSON or schema validation failed.
- `ambiguous`: identity or name evidence conflicted.
- `truncated`: the configured argument limit was exceeded.

## Runtime support

- Node.js 18+
- Browsers
- Cloudflare Workers
- Bun
- Deno through npm compatibility
- ESM and CommonJS

The runtime library has zero dependencies and no environment-specific imports. The CLI is the only Node-specific entry point.

## Design guarantees

- Never silently merge identity conflicts.
- Never discard partial arguments.
- Never throw for provider-shaped stream defects.
- Bounded call, argument, and diagnostic retention.
- Deterministic results for a given ordered delta journal.
- No provider SDK dependency or global mutable state.

## Development

```bash
npm install
npm run verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for fixture and regression-test requirements.

## License

MIT
