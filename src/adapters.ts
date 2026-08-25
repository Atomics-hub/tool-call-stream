import type { ToolCallDelta } from "./types.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function json(value: unknown): string | undefined {
  try {
    const result = JSON.stringify(value);
    return typeof result === "string" ? result : undefined;
  } catch {
    return undefined;
  }
}

/** Normalize an OpenAI Chat Completions streaming chunk. */
export function fromOpenAIChatChunk(chunk: unknown): readonly ToolCallDelta[] {
  const root = record(chunk);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const output: ToolCallDelta[] = [];
  for (const choiceValue of choices) {
    const choice = record(choiceValue);
    const delta = record(choice?.delta);
    const toolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : [];
    for (const toolCallValue of toolCalls) {
      const toolCall = record(toolCallValue);
      const fn = record(toolCall?.function);
      const index = integer(toolCall?.index);
      const id = text(toolCall?.id);
      const name = text(fn?.name);
      const argumentsDelta = text(fn?.arguments);
      output.push({
        ...(index === undefined ? {} : { index }),
        ...(id === undefined ? {} : { id }),
        ...(name === undefined ? {} : { name }),
        ...(argumentsDelta === undefined ? {} : { argumentsDelta }),
        source: "openai-chat",
      });
    }
  }
  return output;
}

/** Normalize Anthropic Messages content block start/delta events. */
export function fromAnthropicEvent(event: unknown): readonly ToolCallDelta[] {
  const root = record(event);
  const type = text(root?.type);
  const index = integer(root?.index);
  if (type === "content_block_start") {
    const block = record(root?.content_block);
    if (text(block?.type) !== "tool_use") return [];
    const input = block?.input;
    const inputRecord = record(input);
    const id = text(block?.id);
    const name = text(block?.name);
    const argumentsDelta =
      input === undefined ||
      (inputRecord !== undefined && Object.keys(inputRecord).length === 0)
        ? undefined
        : json(input);
    return [
      {
        ...(index === undefined ? {} : { index }),
        ...(id === undefined ? {} : { id }),
        ...(name === undefined ? {} : { name }),
        ...(argumentsDelta === undefined ? {} : { argumentsDelta }),
        source: "anthropic-messages",
      },
    ];
  }
  if (type === "content_block_delta") {
    const delta = record(root?.delta);
    if (text(delta?.type) !== "input_json_delta") return [];
    const argumentsDelta = text(delta?.partial_json);
    return [
      {
        ...(index === undefined ? {} : { index }),
        ...(argumentsDelta === undefined ? {} : { argumentsDelta }),
        source: "anthropic-messages",
      },
    ];
  }
  return [];
}

/** Normalize an AI SDK tool-call streaming part without importing AI SDK types. */
export function fromAISDKPart(part: unknown): readonly ToolCallDelta[] {
  const root = record(part);
  const type = text(root?.type);
  if (type !== "tool-call-delta" && type !== "tool-input-delta") return [];
  const delta = text(root?.argsTextDelta) ?? text(root?.inputTextDelta);
  const index = integer(root?.index);
  const id = text(root?.toolCallId);
  const name = text(root?.toolName);
  return [
    {
      ...(index === undefined ? {} : { index }),
      ...(id === undefined ? {} : { id }),
      ...(name === undefined ? {} : { name }),
      ...(delta === undefined ? {} : { argumentsDelta: delta }),
      source: "ai-sdk",
    },
  ];
}

/** Normalize Gemini candidate parts that contain functionCall objects. */
export function fromGeminiChunk(chunk: unknown): readonly ToolCallDelta[] {
  const root = record(chunk);
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  const output: ToolCallDelta[] = [];
  for (const candidateValue of candidates) {
    const candidate = record(candidateValue);
    const content = record(candidate?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (let index = 0; index < parts.length; index += 1) {
      const fn = record(record(parts[index])?.functionCall);
      if (fn === undefined) continue;
      const id = text(fn.id);
      const name = text(fn.name);
      const argumentsDelta = fn.args === undefined ? undefined : json(fn.args);
      output.push({
        index,
        ...(id === undefined ? {} : { id }),
        ...(name === undefined ? {} : { name }),
        ...(argumentsDelta === undefined ? {} : { argumentsDelta }),
        source: "gemini",
      });
    }
  }
  return output;
}
