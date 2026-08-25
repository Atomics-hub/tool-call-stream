import type { JsonState } from "./types.js";

function looksIncomplete(input: string): boolean {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const character of input) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return false;
    }
  }

  if (inString || escaped || stack.length > 0) return true;
  return /(?:[:,]|\b(?:tru|fals|nul)|[-+eE.]|\d)$/.test(input.trim());
}

export function inspectJson(input: string): JsonState {
  if (input.trim() === "") return { status: "empty" };
  try {
    return { status: "valid", value: JSON.parse(input) as unknown };
  } catch (error) {
    if (looksIncomplete(input)) return { status: "incomplete" };
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}
