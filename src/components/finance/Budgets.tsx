"use client";

import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import type { BudgetStatus } from "@/lib/finance/aggregate";
import { categoryColor, money } from "@/lib/finance/format";

const BUDGET_WARN = 0.8; // same as BUDGET_WARN_SHARE in lib/finance/budgets.ts (server-only module)

function status(b: BudgetStatus) {
  const r = b.spent / b.budget;
  if (r >= 1) return { tone: "var(--err)", icon: CircleAlert, label: r > 1 ? "Over budget" : "Budget used up" };
  if (r >= BUDGET_WARN) return { tone: "var(--warn)", icon: AlertTriangle, label: "Close to budget" };
  return { tone: "var(--ok)", icon: CheckCircle2, label: "On track" };
}

/** Progress per budgeted category; the status is spelled out (icon + text), not color alone. */
export function Budgets({ budgets, currency, yearly }: { budgets: BudgetStatus[]; currency: string; yearly: boolean }) {
  if (!budgets.length) {
    return <p className="text-sm text-muted">No budgets yet. Set a monthly budget per category under Categories.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {budgets.map((b) => {
        const s = status(b);
        const pct = Math.round((b.spent / b.budget) * 100);
        return (
          <li key={b.name} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: categoryColor(b.slot, b.color) }} />
              <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
              <span className="tabular-nums text-muted">
                {money(b.spent, currency)} / {money(b.budget, currency)}
                {yearly && " a year"}
              </span>
            </div>
            <div
              role="meter"
              aria-label={`${b.name} budget used`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(pct, 100)}
              aria-valuetext={`${pct}%, ${s.label.toLowerCase()}`}
              className="h-2 overflow-hidden rounded-full bg-track"
            >
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: s.tone }} />
            </div>
            <div className="flex items-center gap-1 text-xs" style={{ color: s.tone }}>
              <s.icon className="h-3.5 w-3.5" aria-hidden />
              <span>
                {s.label} · {pct}%
              </span>
              {b.spent < b.budget && <span className="ml-auto text-muted">{money(b.budget - b.spent, currency)} left</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
