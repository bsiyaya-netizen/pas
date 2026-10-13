import { describe, expect, it } from "vitest";
import { monthLabel, niceTicks } from "../src/components/MonthlyBars";

describe("niceTicks", () => {
  it("steps from zero past the maximum in round numbers", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(93_450)).toEqual([0, 25_000, 50_000, 75_000, 100_000]);
    expect(niceTicks(300)).toEqual([0, 100, 200, 300]);
  });
});

describe("monthLabel", () => {
  it("names the month, with the year when asked", () => {
    expect(monthLabel("2026-11")).toBe("Nov");
    expect(monthLabel("2027-01", true)).toBe("Jan 2027");
  });
});
