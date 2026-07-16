import { describe, it, expect } from "vitest";

// Ratio calculation matching frontend
function ratio(collection: number, expense: number) {
  return (collection / expense) * 100;
}
function anomalyRatio(cur: number, prevMonths: number[]) {
  const nonZero = prevMonths.filter((n) => n > 0);
  const avg = nonZero.length ? nonZero.reduce((s, n) => s + n, 0) / nonZero.length : 0;
  return avg > 0 ? cur / avg : 0;
}

describe("rollup math", () => {
  it("computes ratio", () => {
    expect(ratio(120, 100)).toBe(120);
  });
  it("ignores sparse months in anomaly average", () => {
    expect(anomalyRatio(100, [0, 0, 50, 0])).toBe(2);
  });
  it("returns 0 ratio when no prior data", () => {
    expect(anomalyRatio(100, [0, 0, 0])).toBe(0);
  });
});
