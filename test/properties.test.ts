import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createToolCallStream } from "../src/index.js";

describe("state-machine properties", () => {
  it("reassembles arbitrary JSON across arbitrary chunk boundaries", () => {
    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.array(fc.nat(), { maxLength: 30 }),
        (value, cuts) => {
          const json = JSON.stringify(value);
          const wireValue = JSON.parse(json) as unknown;
          const points = [
            ...new Set(cuts.map((cut) => cut % (json.length + 1))),
          ].sort((a, b) => a - b);
          const chunks: string[] = [];
          let cursor = 0;
          for (const point of points) {
            chunks.push(json.slice(cursor, point));
            cursor = point;
          }
          chunks.push(json.slice(cursor));
          const stream = createToolCallStream();
          for (const chunk of chunks)
            stream.push({ index: 5, id: "stable", argumentsDelta: chunk });
          const call = stream.finish().calls[0];
          expect(call?.status).toBe("complete");
          expect(call?.json).toEqual({ status: "valid", value: wireValue });
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("never merges calls with distinct indexes", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.nat(1000), { minLength: 1, maxLength: 50 }),
        (indexes) => {
          const stream = createToolCallStream();
          for (const index of indexes)
            stream.push({ index, argumentsDelta: "{}" });
          expect(stream.finish().calls).toHaveLength(indexes.length);
        },
      ),
      { numRuns: 500 },
    );
  });
});
