"use client";

import type { WidgetCharts } from "@/integrations/types";
import type { TileSize } from "@/lib/config/schema";
import { money, monthLabel } from "@/lib/finance/format";
import { Donut } from "./Donut";
import { Bars } from "./Bars";
import { LineChart } from "./LineChart";
import { Sankey } from "./Sankey";

/** Which finance charts a tile shows grows with its size: wide adds the donut, tall the bars, large all three. */
export function FinanceCharts({ charts, size }: { charts: WidgetCharts; size: TileSize | "detail" }) {
  const cur = charts.currency;
  const sankey = charts.main === "sankey" && !!charts.flow && size !== "small" && size !== "tall";
  const showDonut = size !== "small" && !sankey;
  const showBars = size === "tall" || size === "large" || size === "detail";
  const showBalance = size === "large" || size === "detail";
  const spent = (charts.donut ?? []).reduce((a, s) => a + s.cents, 0);
  const months = charts.bars?.slice(size === "tall" ? -6 : -12) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {sankey && <Sankey flow={charts.flow!} currency={cur} height={size === "wide" ? 150 : 200} />}
      {showDonut && charts.donut && (
        <Donut
          slices={charts.donut.map((s) => ({ name: s.name, value: s.cents, slot: s.slot, color: s.color, label: money(s.cents, cur) }))}
          total={money(spent, cur)}
          size={size === "wide" ? 112 : 128}
          compact={size === "wide" || size === "tall"}
          ariaLabel="Spending by category"
        />
      )}
      {showBars && months.length > 0 && (
        <Bars
          groups={months.map((m) => ({ label: monthLabel(m.month), values: [m.income / 100, m.expense / 100] }))}
          series={[
            { name: "Income", color: "var(--series-1)" },
            { name: "Spent", color: "var(--series-2)" },
          ]}
          height={size === "tall" ? 150 : 170}
          format={(v) => money(Math.round(v * 100), cur)}
          ariaLabel="Income and spending per month"
        />
      )}
      {showBalance && charts.balance && charts.balance.length > 1 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted">Balance</div>
          <LineChart
            x={charts.balance.map((b) => Date.parse(`${b.month}-01T00:00:00Z`))}
            series={[{ name: "Balance", color: "var(--series-1)", values: charts.balance.map((b) => b.cents / 100) }]}
            height={140}
            area
            formatX={(t) => monthLabel(new Date(t).toISOString().slice(0, 7), true)}
            ariaLabel="Balance at the end of each month"
          />
        </div>
      )}
    </div>
  );
}
