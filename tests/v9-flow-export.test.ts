import { describe, expect, it } from "vitest";
import { flowCsv, flowRows } from "@/lib/finance/flowCsv";
import type { Flow } from "@/lib/finance/aggregate";

const flow: Flow = {
  sources: [{ name: "Salary", cents: 300000, slot: 1 }],
  sinks: [
    { name: "Rent", cents: 120000, slot: 2 },
    { name: "=HYPERLINK(\"x\")", cents: 30000, slot: 3 },
  ],
  saved: 150000,
  fromSavings: 0,
};

describe("money-flow export", () => {
  it("lists every band source → target with its share of income", () => {
    expect(flowRows(flow)).toEqual([
      { source: "Salary", target: "Budget", cents: 300000, share: 100 },
      { source: "Budget", target: "Rent", cents: 120000, share: 40 },
      { source: "Budget", target: '=HYPERLINK("x")', cents: 30000, share: 10 },
      { source: "Budget", target: "Saved", cents: 150000, share: 50 },
    ]);
  });

  it("uses spending as the base and a From savings band when spending was higher", () => {
    const rows = flowRows({ sources: [], sinks: [{ name: "Food", cents: 5000, slot: 1 }], saved: 0, fromSavings: 5000 });
    expect(rows).toEqual([
      { source: "From savings", target: "Budget", cents: 5000, share: 100 },
      { source: "Budget", target: "Food", cents: 5000, share: 100 },
    ]);
  });

  it("writes spreadsheet-safe CSV", () => {
    const lines = flowCsv(flow, "EUR").split("\r\n");
    expect(lines[0]).toBe("source,target,amount,currency,share_percent");
    expect(lines[2]).toBe("Budget,Rent,1200.00,EUR,40");
    // Formula-looking names stay text.
    expect(lines[3]).toBe(`Budget,"'=HYPERLINK(""x"")",300.00,EUR,10`);
  });
});
