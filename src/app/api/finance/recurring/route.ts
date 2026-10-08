import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { audit } from "@/lib/auth/users";
import { createRecurring, deleteRecurring, EVERY, getRecurring, listRecurring, occurrences, runRecurring, updateRecurring, type Every, type RecurringRule } from "@/lib/finance/recurring";
import { bad, guard, isDate } from "../_shared";

export const dynamic = "force-dynamic";

/** With the date it next adds a transaction (null once it has ended). */
const withNext = (r: RecurringRule) => ({ ...r, next: occurrences(r, r.last_date, "9999-12-31", 1)[0] ?? null });

export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(listRecurring().map(withNext));
}

const cents = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 100) : undefined;
};
const category = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null);

/**
 * { description, amount (negative = expense), every: week|month|year, everyN?, startDate, endDate?, category?, currency? }.
 * Occurrences up to today are added right away (a start date in the past fills them in).
 */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const amount = cents(b.amount);
  if (typeof b.description !== "string" || !b.description.trim()) return bad("Description required");
  if (amount === undefined) return bad("Amount must be a non-zero number");
  if (!EVERY.includes(b.every as Every)) return bad("every must be week, month or year");
  if (!isDate(b.startDate)) return bad("Start date must be YYYY-MM-DD");
  const end = isDate(b.endDate) ? b.endDate : null;
  if (b.endDate && (!end || end < b.startDate)) return bad("End date must be YYYY-MM-DD, after the start");
  const everyN = b.everyN === undefined ? 1 : Number(b.everyN);
  if (!Number.isInteger(everyN) || everyN < 1 || everyN > 52) return bad("everyN must be 1–52");
  const rule = createRecurring({
    description: b.description.trim().slice(0, 300),
    amount_cents: amount,
    currency: typeof b.currency === "string" && /^[A-Za-z]{3}$/.test(b.currency) ? b.currency : loadConfig().settings.finance.currency,
    category: category(b.category),
    every: b.every as Every,
    every_n: everyN,
    start_date: b.startDate,
    end_date: end,
  });
  const added = runRecurring();
  audit(g.user.username, "finance-recurring-create", { id: rule.id, description: rule.description, added });
  return NextResponse.json({ rule: getRecurring(rule.id), added }, { status: 201 });
}

/** { id, active?, endDate? (null removes it), description?, amount?, category? } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!getRecurring(id)) return bad("No such recurring transaction", 404);
  if (b.amount !== undefined && cents(b.amount) === undefined) return bad("Amount must be a non-zero number");
  if (b.endDate && !isDate(b.endDate)) return bad("End date must be YYYY-MM-DD");
  updateRecurring(id, {
    active: typeof b.active === "boolean" ? b.active : undefined,
    end_date: b.endDate === undefined ? undefined : isDate(b.endDate) ? b.endDate : null,
    description: typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 300) : undefined,
    amount_cents: b.amount === undefined ? undefined : cents(b.amount),
    category: b.category === undefined ? undefined : category(b.category),
  });
  // Resuming a paused rule adds what came due meanwhile.
  runRecurring();
  return NextResponse.json(getRecurring(id));
}

/** Stops it; transactions it already added stay. */
export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  deleteRecurring(Number(new URL(req.url).searchParams.get("id")));
  return NextResponse.json({ ok: true });
}
