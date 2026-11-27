import { describe, expect, it } from "vitest";
import { hasVisibleChartAnnotation, resolveAnnotationPointKey, type ChartAnnotation } from "./chart-annotations";

const item = (pointKey: string): ChartAnnotation => ({
  id: pointKey,
  chart_key: "chart",
  point_key: pointKey,
  title: "Explanation",
  comment: "Reason",
  visibility: "all",
});

describe("annotation point key", () => {
  it("uses the rendered label month when Recharts supplies it", () => {
    expect(resolveAnnotationPointKey({ payload: { month: "Aug '26" }, index: 0 }, ["Jul '26"])).toBe("Aug '26");
  });

  it("falls back to the visible period month when Recharts omits payload", () => {
    expect(resolveAnnotationPointKey({ index: 2 }, ["Jul '26", "Aug '26", "Sep '26"])).toBe("Sep '26");
  });

  it("falls back to the label value and safely handles missing points", () => {
    expect(resolveAnnotationPointKey({ value: "Oct '26" }, [])).toBe("Oct '26");
    expect(resolveAnnotationPointKey({}, [])).toBe("");
  });
});

describe("chart annotation period visibility", () => {
  it("shows guidance when a comment belongs to the selected period", () => {
    expect(hasVisibleChartAnnotation([item("Aug '26")], ["Jul '26", "Aug '26"])).toBe(true);
  });

  it("hides guidance when saved comments are outside the selected period", () => {
    expect(hasVisibleChartAnnotation([item("Sep '26")], ["Apr '26", "May '26"])).toBe(false);
  });

  it("hides guidance when the chart has no comments", () => {
    expect(hasVisibleChartAnnotation([], ["Aug '26"])).toBe(false);
  });

  it("hides comments when the selected period is empty", () => {
    expect(hasVisibleChartAnnotation([item("Aug '26")], [])).toBe(false);
  });
});
