import { describe, expect, it } from "vitest";
import { summarize, type Txn } from "@/lib/finance/aggregate";
import { budgetCrossings } from "@/lib/finance/budgets";
import { bandPath, foldSmall, layoutSankey, placeLabels } from "@/components/charts/sankeyLayout";

const txns: Txn[] = [
  { date: "2026-10-01", amount_cents: 300000, currency: "EUR", category: "Salary" },
  { date: "2026-10-03", amount_cents: 20000, currency: "EUR", category: null },
  { date: "2026-10-02", amount_cents: -12000, currency: "EUR", category: "Groceries" },
  { date: "2026-10-05", amount_cents: -80000, currency: "EUR", category: "rent" },
  { date: "2026-10-06", amount_cents: -2000, currency: "EUR", category: "Hobbies" },
];
const cats = [
  { name: "Groceries", slot: 1, budget: 10000 },
  { name: "Rent", slot: 2, budget: 100000 },
  { name: "Hobbies", slot: null, budget: null },
  { name: "Salary", slot: 3 },
];

describe("money flow", () => {
  it("splits income by category and balances with Saved", () => {
    const { flow } = summarize(txns, cats, "2026-10", "EUR");
    expect(flow.sources).toEqual([
      { name: "Salary", cents: 300000, slot: 3 },
      { name: "Income", cents: 20000, slot: null },
    ]);
    expect(flow.sinks.map((s) => s.name)).toEqual(["Rent", "Groceries", "Other"]);
    expect(flow.saved).toBe(320000 - 94000);
    expect(flow.fromSavings).toBe(0);
  });

  it("shows spending beyond income as coming from savings", () => {
    const { flow } = summarize([{ date: "2026-10-02", amount_cents: -5000, currency: "EUR", category: null }], cats, "2026-10", "EUR");
    expect(flow.sources).toEqual([]);
    expect([flow.saved, flow.fromSavings]).toEqual([0, 5000]);
  });
});

describe("budgets", () => {
  it("reports spending per budgeted category (case-insensitive), fullest first", () => {
    const { budgets } = summarize(txns, cats, "2026-10", "EUR");
    expect(budgets).toEqual([
      { name: "Groceries", slot: 1, budget: 10000, spent: 12000 },
      { name: "Rent", slot: 2, budget: 100000, spent: 80000 },
    ]);
  });

  it("scales monthly budgets to a year", () => {
    expect(summarize(txns, cats, "2026", "EUR").budgets[1].budget).toBe(1200000);
  });

  it("alerts once per threshold and month", () => {
    const { budgets } = summarize(txns, cats, "2026-10", "EUR");
    const none = () => false;
    expect(budgetCrossings(budgets, "over", none, "2026-10").map((c) => [c.budget.name, c.mark])).toEqual([["Groceries", "over"]]);
    expect(budgetCrossings(budgets, "warn", none, "2026-10").map((c) => [c.budget.name, c.mark])).toEqual([
      ["Groceries", "over"],
      ["Rent", "warn"],
    ]);
    const sent = new Set(["budget-alert:2026-10:groceries:over"]);
    expect(budgetCrossings(budgets, "over", (k) => sent.has(k), "2026-10")).toEqual([]);
  });
});

describe("sankey layout", () => {
  const c = "red";
  it("folds slices under the share into Other (merged with an existing Other)", () => {
    const items = [
      { name: "A", value: 90, color: c },
      { name: "B", value: 1, color: c },
      { name: "Other", value: 4, color: c },
      { name: "C", value: 5, color: c },
    ];
    expect(foldSmall(items, 0.02, "grey").map((i) => [i.name, i.value])).toEqual([
      ["A", 90],
      ["C", 5],
      ["Other", 5],
    ]);
  });

  it("uses one scale so both columns and the middle node have matching heights", () => {
    const { nodes, links } = layoutSankey(
      [{ name: "In", value: 100, color: c }],
      { name: "Budget", color: c },
      [
        { name: "X", value: 60, color: c },
        { name: "Y", value: 40, color: c },
      ],
      { width: 400, height: 208, gap: 8 },
    );
    const by = (n: string) => nodes.find((x) => x.name === n)!;
    expect(by("X").h + by("Y").h).toBeCloseTo(200);
    expect(by("In").h).toBeCloseTo(200);
    expect(by("Budget").h).toBeCloseTo(200);
    expect(by("Y").y - (by("X").y + by("X").h)).toBeCloseTo(8);
    expect(by("X").x).toBe(390);
    expect(links).toHaveLength(3);
    for (const n of nodes) expect(n.y).toBeGreaterThanOrEqual(0);
  });

  it("returns nothing to draw for empty data", () => {
    expect(layoutSankey([], { name: "B", color: c }, [], { width: 300, height: 100 }).nodes).toEqual([]);
  });

  it("draws closed bands", () => {
    expect(bandPath(0, 0, 100, 50, 10)).toBe("M0,0 C50,0 50,50 100,50 L100,60 C50,60 50,10 0,10 Z");
  });
});

describe("sankey labels", () => {
  it("keeps labels on their nodes when there is room, and spreads crowded ones apart", () => {
    expect(placeLabels([{ y: 0, h: 100, lines: 1 }], 10, 200)).toEqual([50]);
    const ys = placeLabels(
      [
        { y: 190, h: 2, lines: 1 },
        { y: 194, h: 2, lines: 1 },
        { y: 198, h: 2, lines: 1 },
      ],
      10,
      200,
    );
    expect(ys[2]).toBeLessThanOrEqual(194);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(12);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(12);
  });
});
