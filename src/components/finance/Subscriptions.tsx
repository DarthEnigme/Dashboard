"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Bell, CreditCard, ExternalLink, Pause, Pencil, Play, Plus, StopCircle } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { RecurringRule } from "@/lib/finance/recurring";
import { money } from "@/lib/finance/format";
import { localDay } from "@/lib/day";
import { DeleteButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";
import { everyText } from "./Plan";
import { useT } from "@/i18n/client";

type Item = RecurringRule & { next: string | null; running: boolean; monthly: number; monthlyConverted: number | null };
type Answer = {
  currency: string;
  items: Item[];
  totals: { monthly: number; yearly: number; running: number; unconverted: number; byCategory: { name: string; monthly: number }[] };
};
const RECURRING = "/api/finance/recurring";

const days = (to: string) => Math.round((Date.parse(to) - Date.parse(localDay())) / 86_400_000);

type Form = { description: string; price: string; every: string; everyN: string; startDate: string; category: string; account: string; url: string; remindDays: string; cancelBy: string; notes: string };
const blank = (): Form => ({ description: "", price: "", every: "month", everyN: "1", startDate: localDay(), category: "", account: "", url: "", remindDays: "3", cancelBy: "", notes: "" });

/**
 * Streaming, domains, servers: recurring payments tracked as subscriptions. Each one still adds
 * its transaction on its date (like any recurring payment) and can remind you before it renews.
 */
export function Subscriptions({ currency, onChanged }: { currency: string; onChanged: () => void }) {
  const t = useT();
  const { data, mutate } = useSWR<Answer>(`/api/finance/subscriptions?currency=${currency}`, fetcher, { keepPreviousData: true });
  const { data: recurring } = useSWR<(RecurringRule & { next: string | null })[]>(RECURRING, fetcher);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<Item | "new">();

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      await mutate();
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const candidates = (recurring ?? []).filter((r) => !r.subscription && r.amount_cents < 0);
  const items = [...(data?.items ?? [])].sort((a, b) => Number(b.running) - Number(a.running) || (a.next ?? "9").localeCompare(b.next ?? "9"));
  const cur = data?.currency ?? currency;

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Per month")} value={data ? money(data.totals.monthly, cur) : "–"} />
        <Stat label={t("Per year")} value={data ? money(data.totals.yearly, cur) : "–"} />
        <Stat label={t("Running")} value={data ? String(data.totals.running) : "–"} note={data?.totals.unconverted ? t("{n} left out: no exchange rate", { n: data.totals.unconverted }) : undefined} />
        <div className="glass rounded-2xl p-4">
          <div className="text-xs text-muted">{t("By category, per month")}</div>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {data?.totals.byCategory.slice(0, 4).map((c) => (
              <li key={c.name} className="flex justify-between gap-2">
                <span className="truncate">{c.name || t("No category")}</span>
                <span className="tabular-nums">{money(c.monthly, cur)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="glass flex flex-col gap-3 rounded-3xl p-4" aria-labelledby="subs-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="subs-title" className="flex items-center gap-2 font-semibold">
            <CreditCard className="h-4 w-4 text-accent" /> {t("Subscriptions")}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {candidates.length > 0 && (
              <select
                aria-label={t("Track a recurring payment as a subscription")}
                value=""
                onChange={(e) => e.target.value && act(() => sendJson(RECURRING, "PATCH", { id: Number(e.target.value), subscription: true, remindDays: 3 }))}
                className={`${inputBase} w-56`}
              >
                <option value="">{t("Track a recurring payment…")}</option>
                {candidates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.description} · {money(r.amount_cents, r.currency, true)}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={() => setEditing("new")} className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:brightness-110">
              <Plus className="h-4 w-4" /> {t("Add a subscription")}
            </button>
          </div>
        </div>
        <p className="text-sm text-muted">{t("Each one adds its payment as a transaction when it renews, and can remind you through your alert channels a few days before.")}</p>
        {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
        {editing && (
          <SubscriptionForm
            currency={currency}
            item={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(undefined)}
            onSave={async (body) => {
              const ok = await act(() => (editing === "new" ? sendJson(RECURRING, "POST", { ...body, subscription: true }) : sendJson(RECURRING, "PATCH", { id: editing.id, ...body })));
              if (ok) setEditing(undefined);
            }}
          />
        )}
        {data && !items.length && <p className="py-6 text-center text-sm text-muted">{t("No subscriptions yet.")}</p>}
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((s) => {
            const left = s.next ? days(s.next) : null;
            const cancelLeft = s.cancel_by ? days(s.cancel_by) : null;
            return (
              <li key={s.id} data-subscription={s.description} className={`flex flex-col gap-2 rounded-2xl bg-chip p-4 ${s.running ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <span className="truncate">{s.description}</span>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noreferrer" aria-label={t("Open {name}", { name: s.description })} className="text-muted hover:text-fg">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-muted">
                      {[s.category, s.account].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{money(-s.amount_cents, s.currency)}</div>
                    <div className="text-xs text-muted">{everyText(s, t)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {!s.active ? (
                    <span className="rounded-full bg-track px-2 py-0.5">{t("paused")}</span>
                  ) : s.next ? (
                    <span className={`rounded-full px-2 py-0.5 ${left !== null && left <= (s.remind_days ?? 3) ? "bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-[var(--warn)]" : "bg-track"}`}>
                      {left === 0 ? t("renews today") : left === 1 ? t("renews tomorrow") : t("renews {date}", { date: s.next })}
                    </span>
                  ) : (
                    <span className="rounded-full bg-track px-2 py-0.5">{t("ended")}</span>
                  )}
                  {s.cancel_by && cancelLeft !== null && cancelLeft >= 0 && (
                    <span className="rounded-full bg-[color-mix(in_oklab,var(--err)_16%,transparent)] px-2 py-0.5 text-[var(--err)]">{t("cancel by {date}", { date: s.cancel_by })}</span>
                  )}
                  {s.remind_days !== null && (
                    <span className="flex items-center gap-1 text-muted" title={t("Reminder {n} days before", { n: s.remind_days })}>
                      <Bell className="h-3 w-3" /> {s.remind_days}{t("d")}
                    </span>
                  )}
                  {s.currency !== cur && s.monthlyConverted !== null && <span className="text-muted">≈ {money(s.monthlyConverted, cur)}{t("/mo")}</span>}
                </div>
                {s.notes && <p className="text-sm whitespace-pre-line text-muted">{s.notes}</p>}
                <div className="flex items-center justify-end gap-0.5">
                  <IconBtn label={t("Edit {name}", { name: s.description })} onClick={() => setEditing(s)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn label={s.active ? t("Pause {name}", { name: s.description }) : t("Resume {name}", { name: s.description })} onClick={() => act(() => sendJson(RECURRING, "PATCH", { id: s.id, active: !s.active }))}>
                    {s.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </IconBtn>
                  {s.running && (
                    <IconBtn label={t("End {name} after today", { name: s.description })} onClick={() => act(() => sendJson(RECURRING, "PATCH", { id: s.id, endDate: localDay() }))}>
                      <StopCircle className="h-3.5 w-3.5" />
                    </IconBtn>
                  )}
                  <DeleteButton label={t("Delete {name}", { name: s.description })} onConfirm={() => act(() => sendJson(`${RECURRING}?id=${s.id}`, "DELETE"))} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}

function SubscriptionForm({ currency, item, onCancel, onSave }: { currency: string; item?: Item; onCancel: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [f, setF] = useState<Form>(() =>
    item
      ? {
          description: item.description,
          price: String(-item.amount_cents / 100),
          every: item.every,
          everyN: String(item.every_n),
          startDate: item.start_date,
          category: item.category ?? "",
          account: item.account ?? "",
          url: item.url ?? "",
          remindDays: item.remind_days === null ? "" : String(item.remind_days),
          cancelBy: item.cancel_by ?? "",
          notes: item.notes ?? "",
        }
      : blank(),
  );
  const [error, setError] = useState<string>();
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const price = Number(f.price.replace(",", "."));
    if (!f.description.trim() || !Number.isFinite(price) || price <= 0) return setError(t("Enter a name and a positive price"));
    setError(undefined);
    const common = {
      description: f.description,
      amount: -price,
      category: f.category || null,
      account: f.account || null,
      url: f.url || null,
      notes: f.notes || null,
      remindDays: f.remindDays === "" ? null : Number(f.remindDays),
      cancelBy: f.cancelBy || null,
    };
    // The billing cycle and first date of an existing one stay: they define the dates already added.
    await onSave(item ? common : { ...common, every: f.every, everyN: Number(f.everyN) || 1, startDate: f.startDate, currency });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-2xl bg-chip p-3" aria-label={item ? t("Edit {name}", { name: item.description }) : t("Add a subscription")}>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={t("Name")} placeholder={t("Netflix, domain, VPS…")} value={f.description} onChange={set("description")} className={`${inputBase} min-w-40 flex-1`} />
        <input aria-label={t("Price in {currency}", { currency: item?.currency ?? currency })} inputMode="decimal" placeholder={`0.00 ${item?.currency ?? currency}`} value={f.price} onChange={set("price")} className={`${inputBase} w-28 text-right tabular-nums`} />
        {!item && (
          <>
            {t("every")}
            <input aria-label={t("Repeat every")} type="number" min={1} max={52} value={f.everyN} onChange={set("everyN")} className={`${inputBase} w-16`} />
            <select aria-label={t("Period")} value={f.every} onChange={set("every")} className={`${inputBase} w-28`}>
              <option value="week">{t("week(s)")}</option>
              <option value="month">{t("month(s)")}</option>
              <option value="year">{t("year(s)")}</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              {t("next payment")}
              <input aria-label={t("Next payment")} type="date" value={f.startDate} onChange={set("startDate")} className={`${inputBase} w-40`} />
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={t("Category")} placeholder={t("Category")} list="fin-categories" value={f.category} onChange={set("category")} className={`${inputBase} w-36`} />
        <input aria-label={t("Account")} placeholder={t("Account")} value={f.account} onChange={set("account")} className={`${inputBase} w-36`} />
        <input aria-label={t("Link")} placeholder="https://…" value={f.url} onChange={set("url")} className={`${inputBase} min-w-40 flex-1`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <label className="flex items-center gap-1.5">
          {t("Remind me")}
          <input aria-label={t("Days before renewal")} type="number" min={0} max={90} placeholder="–" value={f.remindDays} onChange={set("remindDays")} className={`${inputBase} w-16`} />
          {t("days before")}
        </label>
        <label className="flex items-center gap-1.5">
          {t("Cancel by")}
          <input aria-label={t("Cancel by")} type="date" value={f.cancelBy} onChange={set("cancelBy")} className={`${inputBase} w-40`} />
        </label>
      </div>
      <textarea aria-label={t("Notes")} placeholder={t("Notes: plan, login, how to cancel…")} value={f.notes} onChange={set("notes")} rows={2} className={`${inputBase} w-full`} />
      {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-hover">
          {t("Cancel")}
        </button>
        <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
          {t("Save")}
        </button>
      </div>
      {!item && <p className="text-xs text-muted">{t("A date in the past adds the payments since then.")}</p>}
    </form>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg">
      {children}
    </button>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
}
