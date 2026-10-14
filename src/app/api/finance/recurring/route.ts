import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { audit } from "@/lib/auth/users";
import {
  createRecurring,
  deleteRecurring,
  EVERY,
  getRecurring,
  listRecurring,
  occurrences,
  runRecurring,
  updateRecurring,
  type Every,
  type RecurringRule,
  type SubscriptionFields,
} from "@/lib/finance/recurring";
import { bad, guard, isDate } from "../_shared";

export const dynamic = "force-dynamic";

/** With the date it next adds a transaction (null once it has ended). */
const withNext = (r: RecurringRule) => ({ ...r, next: occurrences(r, r.last_date, "9999-12-31", 1)[0] ?? null });

/** ?subscriptions=1: only the ones tracked as subscriptions. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const subs = new URL(req.url).searchParams.get("subscriptions") === "1";
  return NextResponse.json(listRecurring().filter((r) => !subs || r.subscription).map(withNext));
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const url = (v: unknown) => {
  const s = text(v, 500);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

/** The subscription fields of a request body; undefined where it doesn't mention them, an error message when invalid. */
function subscriptionFields(b: Record<string, unknown>): Partial<SubscriptionFields> | string {
  if (b.url && !url(b.url)) return "Link must start with http:// or https://";
  if (b.cancelBy && !isDate(b.cancelBy)) return "Cancel-by date must be YYYY-MM-DD";
  const remind = b.remindDays === undefined || b.remindDays === null || b.remindDays === "" ? null : Number(b.remindDays);
  if (remind !== null && !(Number.isInteger(remind) && remind >= 0 && remind <= 90)) return "Reminder: 0–90 days before";
  return {
    subscription: typeof b.subscription === "boolean" ? b.subscription : undefined,
    url: b.url === undefined ? undefined : url(b.url),
    notes: b.notes === undefined ? undefined : text(b.notes, 1000),
    remind_days: b.remindDays === undefined ? undefined : remind,
    account: b.account === undefined ? undefined : text(b.account, 60),
    cancel_by: b.cancelBy === undefined ? undefined : isDate(b.cancelBy) ? b.cancelBy : null,
  };
}

const cents = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 100) : undefined;
};
const category = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null);

/**
 * { description, amount (negative = expense), every: week|month|year, everyN?, startDate, endDate?, category?, currency? }
 * and for subscriptions { subscription: true, url?, notes?, remindDays?, account?, cancelBy? }.
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
  const sub = subscriptionFields(b);
  if (typeof sub === "string") return bad(sub);
  const rule = createRecurring({
    ...sub,
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

/** { id, active?, endDate? (null removes it), description?, amount?, category?, subscription?, url?, notes?, remindDays?, account?, cancelBy? } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!getRecurring(id)) return bad("No such recurring transaction", 404);
  if (b.amount !== undefined && cents(b.amount) === undefined) return bad("Amount must be a non-zero number");
  if (b.endDate && !isDate(b.endDate)) return bad("End date must be YYYY-MM-DD");
  const sub = subscriptionFields(b);
  if (typeof sub === "string") return bad(sub);
  updateRecurring(id, {
    ...sub,
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
