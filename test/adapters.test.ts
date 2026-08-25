import { describe, expect, it } from "vitest";
import {
  fromAISDKPart,
  fromAnthropicEvent,
  fromGeminiChunk,
  fromOpenAIChatChunk,
} from "../src/adapters.js";

describe("provider adapters", () => {
  it("normalizes OpenAI chat chunks", () => {
    expect(
      fromOpenAIChatChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 2,
                  id: "x",
                  function: { name: "go", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      {
        index: 2,
        id: "x",
        name: "go",
        argumentsDelta: "{}",
        source: "openai-chat",
      },
    ]);
  });

  it("normalizes Anthropic starts and deltas", () => {
    expect(
      fromAnthropicEvent({
        type: "content_block_start",
        index: 3,
        content_block: { type: "tool_use", id: "x", name: "go", input: {} },
      }),
    ).toEqual([
      { index: 3, id: "x", name: "go", source: "anthropic-messages" },
    ]);
    expect(
      fromAnthropicEvent({
        type: "content_block_delta",
        index: 3,
        delta: { type: "input_json_delta", partial_json: "{}" },
      })[0]?.argumentsDelta,
    ).toBe("{}");
    expect(fromAnthropicEvent({ type: "ping" })).toEqual([]);
  });

  it("normalizes AI SDK parts", () => {
    expect(
      fromAISDKPart({
        type: "tool-call-delta",
        toolCallId: "x",
        toolName: "go",
        argsTextDelta: "{",
      })[0],
    ).toMatchObject({ id: "x", name: "go", argumentsDelta: "{" });
    expect(fromAISDKPart({ type: "text-delta" })).toEqual([]);
  });

  it("normalizes Gemini function calls", () => {
    expect(
      fromGeminiChunk({
        candidates: [
          {
            content: {
              parts: [
                { text: "x" },
                { functionCall: { id: "g", name: "go", args: { x: 1 } } },
              ],
            },
          },
        ],
      }),
    ).toEqual([
      {
        index: 1,
        id: "g",
        name: "go",
        argumentsDelta: '{"x":1}',
        source: "gemini",
      },
    ]);
  });

  it("tolerates sparse and malformed provider values", () => {
    expect(fromOpenAIChatChunk(null)).toEqual([]);
    expect(fromOpenAIChatChunk({ choices: [null, { delta: null }] })).toEqual(
      [],
    );
    expect(
      fromOpenAIChatChunk({
        choices: [{ delta: { tool_calls: [null, { index: "bad" }] } }],
      }),
    ).toEqual([{ source: "openai-chat" }, { source: "openai-chat" }]);

    expect(
      fromAnthropicEvent({
        type: "content_block_start",
        content_block: { type: "text" },
      }),
    ).toEqual([]);
    expect(
      fromAnthropicEvent({
        type: "content_block_start",
        content_block: { type: "tool_use", input: { x: 1 } },
      }),
    ).toEqual([{ argumentsDelta: '{"x":1}', source: "anthropic-messages" }]);
    expect(
      fromAnthropicEvent({
        type: "content_block_delta",
        delta: { type: "text_delta" },
      }),
    ).toEqual([]);
    expect(
      fromAnthropicEvent({
        type: "content_block_delta",
        delta: { type: "input_json_delta" },
      }),
    ).toEqual([{ source: "anthropic-messages" }]);

    expect(
      fromAISDKPart({
        type: "tool-input-delta",
        index: 4,
        inputTextDelta: "{}",
      }),
    ).toEqual([{ index: 4, argumentsDelta: "{}", source: "ai-sdk" }]);
    expect(fromGeminiChunk(undefined)).toEqual([]);
    expect(
      fromGeminiChunk({ candidates: [null, { content: { parts: [null] } }] }),
    ).toEqual([]);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(
      fromGeminiChunk({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "safe", args: circular } }],
            },
          },
        ],
      }),
    ).toEqual([{ index: 0, name: "safe", source: "gemini" }]);
  });
});
