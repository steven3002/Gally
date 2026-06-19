import { describe, it, expect } from "vitest";
import { tokenTypeFromAccumulatorType } from "./resolve";

describe("tokenTypeFromAccumulatorType — extracts <T> from the accumulator Move type", () => {
  it("pulls the entity coin type out of YieldAccumulator<T>", () => {
    expect(tokenTypeFromAccumulatorType("0xPKG::accumulator::YieldAccumulator<0xPKG::gally_entity_1::GALLY_ENTITY_1>")).toBe(
      "0xPKG::gally_entity_1::GALLY_ENTITY_1",
    );
  });
  it("returns undefined when there is no type argument", () => {
    expect(tokenTypeFromAccumulatorType("0xPKG::accumulator::YieldAccumulator")).toBeUndefined();
    expect(tokenTypeFromAccumulatorType(null)).toBeUndefined();
    expect(tokenTypeFromAccumulatorType(undefined)).toBeUndefined();
  });
});
