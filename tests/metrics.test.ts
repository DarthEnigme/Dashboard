import { describe, expect, it } from "vitest";
import { applyThresholds, evaluateThreshold, numericValue, widgetExtras } from "@/lib/thresholds";
import { bucketMetric, thin } from "@/lib/metrics";

describe("numeric values of widget fields", () => {
  it("prefers raw, then reads formatted text", () => {
    expect(numericValue({ label: "x", value: "1.2 GB", raw: 1_234_567_890 })).toBe(1_234_567_890);
    expect(numericValue({ label: "x", value: 42 })).toBe(42);
    expect(numericValue({ label: "x", value: "49%" })).toBe(49);
    expect(numericValue({ label: "x", value: "1,234" })).toBe(1234);
    expect(numericValue({ label: "x", value: "5.0 GB" })).toBe(5e9);
    expect(numericValue({ label: "x", value: "2 MiB/s" })).toBe(2 * 1024 ** 2);
    expect(numericValue({ label: "x", value: "21.5 °C" })).toBe(21.5);
    expect(numericValue({ label: "x", value: "2 / 3" })).toBeUndefined();
    expect(numericValue({ label: "x", value: "running" })).toBeUndefined();
  });
});

describe("thresholds", () => {
  const rule = { above: 90, for: 5 };

  it("fires only after the value stays past the limit for `for` minutes, then clears once", () => {
    let s = { firing: false } as Parameters<typeof evaluateThreshold>[0];
    let r = evaluateThreshold(s, 95, rule, 0);
    expect(r.event).toBeUndefined();
    s = r.state;
    r = evaluateThreshold(s, 97, rule, 4 * 60_000);
    expect(r.event).toBeUndefined();
    s = r.state;
    r = evaluateThreshold(s, 96, rule, 5 * 60_000);
    expect(r.event).toBe("breach");
    s = r.state;
    expect(evaluateThreshold(s, 99, rule, 6 * 60_000).event).toBeUndefined(); // no repeat
    r = evaluateThreshold(s, 50, rule, 7 * 60_000);
    expect(r.event).toBe("clear");
    expect(evaluateThreshold(r.state, 50, rule, 8 * 60_000).event).toBeUndefined();
  });

  it("a dip resets the hold time", () => {
    let r = evaluateThreshold({ firing: false }, 95, rule, 0);
    r = evaluateThreshold(r.state, 10, rule, 3 * 60_000);
    r = evaluateThreshold(r.state, 95, rule, 4 * 60_000);
    expect(evaluateThreshold(r.state, 95, rule, 8 * 60_000).event).toBeUndefined();
    expect(evaluateThreshold(r.state, 95, rule, 9 * 60_000).event).toBe("breach");
  });

  it("colours matching fields and list rows (labels case-insensitive)", () => {
    const out = applyThresholds(
      { fields: [{ label: "CPU", value: "95%" }, { label: "RAM", value: "40%" }], list: [{ label: "Battery", value: "15%" }] },
      { cpu: { above: 90, for: 0 }, battery: { below: 20, for: 0 } },
    );
    expect(out.fields.map((f) => f.status)).toEqual(["error", undefined]);
    expect(out.list![0].status).toBe("error");
  });

  it("reads the extra widget keys and ignores bad rules", () => {
    expect(widgetExtras({ type: "glances", record: true, thresholds: { CPU: { above: 90 } } })).toEqual({ record: true, thresholds: { CPU: { above: 90, for: 0 } } });
    expect(widgetExtras({ type: "x", thresholds: { CPU: {} } })).toEqual({});
  });
});

describe("metric buckets", () => {
  it("averages per slot with gaps as null", () => {
    expect(bucketMetric([{ t: 0, v: 1 }, { t: 5, v: 3 }, { t: 25, v: 10 }], 0, 30, 3)).toEqual([2, null, 10]);
  });

  it("thins long series evenly, keeping the last point", () => {
    const pts = Array.from({ length: 100 }, (_, i) => i);
    const t = thin(pts, 10);
    expect(t).toHaveLength(10);
    expect(t.at(-1)).toBe(99);
    expect(thin([1, 2], 10)).toEqual([1, 2]);
  });
});
