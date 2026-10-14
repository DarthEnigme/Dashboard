import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listBackups, prune } from "@/lib/backup";
import { CONFIG_DIR, invalidate } from "@/lib/config/load";
import { servicesFileSchema, settingsSchema } from "@/lib/config/schema";
import { db, incidentsSince, openIncident } from "@/lib/db";
import { collectMetrics } from "@/lib/export/prometheus";
import { addTransaction } from "@/lib/finance/store";
import { endMaintenance, listMaintenance, listMutes, maintenanceNow, mute, mutedNow, quietNow, startMaintenance, unmute } from "@/lib/maintenance";
import { count, counters, dropLabel, gauge, gauges } from "@/lib/stats";
import { pickServices } from "@/lib/statusPage";

const DAY = 86_400_000;

describe("backups: age limit", () => {
  it("also drops backups past the age limit, but never the newest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "page-prune-"));
    const now = Date.parse("2026-10-20T04:00:00Z");
    const make = (day: string, daysAgo: number) => {
      const p = path.join(dir, `page-backup-2026-10-${day}-0300.zip`);
      fs.writeFileSync(p, "x");
      const t = new Date(now - daysAgo * DAY);
      fs.utimesSync(p, t, t);
    };
    make("19", 1);
    make("15", 5);
    make("10", 10);
    // Without a limit, the count alone decides.
    prune(dir, 7, undefined, now);
    expect(listBackups(dir)).toHaveLength(3);
    prune(dir, 7, 7, now);
    expect(listBackups(dir).map((b) => b.name)).toEqual(["page-backup-2026-10-19-0300.zip", "page-backup-2026-10-15-0300.zip"]);
    // Everything is too old: the newest still stays.
    prune(dir, 7, 1, now + 30 * DAY);
    expect(listBackups(dir).map((b) => b.name)).toEqual(["page-backup-2026-10-19-0300.zip"]);
    expect(settingsSchema.parse({}).backup.maxAgeDays).toBeUndefined();
  });
});

describe("maintenance notes", () => {
  it("keeps a note for admins on a mute, and nothing public", () => {
    const now = Date.now();
    mute("infra.nas", 30, "root", now, { note: "  replacing the PSU ", publicNote: "Hardware work", extra: "ignored" } as never);
    mute("infra.router", 30, "root", now);
    expect(listMutes(now)["infra.nas"]).toMatchObject({ note: "replacing the PSU" });
    expect(listMutes(now)["infra.nas"]).not.toHaveProperty("publicNote");
    expect(mutedNow(listMutes(now), "infra.nas", new Date(now))).toEqual({ until: now + 30 * 60_000, note: "replacing the PSU" });
    expect(mutedNow(listMutes(now), "infra.router", new Date(now))).toEqual({ until: now + 30 * 60_000 });
    // Long notes are cut, not refused.
    mute("infra.nas", null, "root", now, { note: "x".repeat(500) });
    expect(listMutes(now)["infra.nas"].note).toHaveLength(200);
    unmute("infra.nas", now);
    unmute("infra.router", now);
  });

  it("runs one-off maintenance now or later, and keeps it apart from mutes", () => {
    const now = Date.now();
    const a = startMaintenance("infra.nas", now, now + 60 * 60_000, "root", now, { note: " disk swap ", publicNote: "Storage upgrade" });
    const later = startMaintenance("infra.router", now + 3600_000, null, "root", now);
    expect(maintenanceNow([], listMaintenance(now), "infra.nas", new Date(now))).toEqual({ id: a.id, until: now + 60 * 60_000, note: "disk swap", publicNote: "Storage upgrade" });
    // Planned for later: not yet, then yes.
    expect(maintenanceNow([], listMaintenance(now), "infra.router", new Date(now))).toBeUndefined();
    expect(maintenanceNow([], listMaintenance(now), "infra.router", new Date(now + 2 * 3600_000))).toMatchObject({ id: later.id });
    // A mute is not maintenance, and maintenance is not a mute; both hold alerts back.
    mute("infra.kuma", 30, "root", now);
    expect(quietNow([], listMutes(now), listMaintenance(now), "infra.kuma", new Date(now))).toMatchObject({ maintenance: undefined, held: true });
    expect(quietNow([], listMutes(now), listMaintenance(now), "infra.nas", new Date(now))).toMatchObject({ muted: undefined, held: true });
    unmute("infra.kuma", now);
    // Ending one under way closes it; ending one still to come drops it.
    expect(endMaintenance(a.id, now + 1000)).toBe(true);
    expect(endMaintenance(later.id, now + 1000)).toBe(true);
    expect(listMaintenance(now + 2000)).toEqual([]);
    expect(endMaintenance("nope")).toBe(false);
  });

  it("takes notes from recurring windows, and stores both on a planned outage", () => {
    const windows = settingsSchema.parse({ maintenance: [{ from: "00:00", to: "00:00", services: ["infra.nas"], note: "weekly snapshots", publicNote: "Weekly maintenance" }] }).maintenance;
    expect(maintenanceNow(windows, [], "infra.nas")).toEqual({ window: "00:00–00:00", note: "weekly snapshots", publicNote: "Weekly maintenance" });
    expect(() => settingsSchema.parse({ maintenance: [{ from: "00:00", to: "01:00", note: "x".repeat(201) }] })).toThrow();

    openIncident("notes.a", 5000, "no response", true, { note: "weekly snapshots", publicNote: "Weekly maintenance" });
    openIncident("notes.b", 5000, "no response");
    expect(incidentsSince("notes.a", 0)[0]).toMatchObject({ planned: 1, note: "weekly snapshots", public_note: "Weekly maintenance" });
    expect(incidentsSince("notes.b", 0)[0]).toMatchObject({ planned: 0, note: null, public_note: null });
  });
});

describe("page settings", () => {
  it("has defaults that change nothing", () => {
    const s = settingsSchema.parse({});
    expect(s.login).toEqual({ backLink: true, passwordForm: true });
    expect(s.errorPages).toEqual({ logo: true });
    expect(s.finance.exportMetrics).toBe(false);
    expect(() => settingsSchema.parse({ statusPage: { announcementLevel: "loud" } })).toThrow();
    expect(() => settingsSchema.parse({ statusPage: { incidentDays: 0 } })).toThrow();
  });

  it("renames services on the status page by id", () => {
    const groups = servicesFileSchema.parse([{ name: "Infra", services: [{ name: "NAS", href: "http://nas", ping: true }, { name: "Router", href: "http://r", ping: true }] }]);
    expect(pickServices(groups, undefined, { "infra.nas": "File storage", "infra.router": "  " }).map((s) => s.name)).toEqual(["File storage", "Router"]);
  });
});

describe("counters for the exporter", () => {
  it("adds up per label set, remembers last values, and forgets removed services", () => {
    count("t_total", { channel: "Discord" });
    count("t_total", { channel: "Discord" }, 2);
    count("t_total", { channel: "ntfy" });
    expect(counters("t_total")).toEqual([
      { labels: { channel: "Discord" }, value: 3 },
      { labels: { channel: "ntfy" }, value: 1 },
    ]);
    gauge("t_ok", { service: "a.b" }, 1);
    gauge("t_ok", { service: "a.b" }, 0);
    gauge("t_ok", { service: "a.gone" }, 1);
    dropLabel("service", new Set(["a.b"]));
    expect(gauges("t_ok")).toEqual([{ labels: { service: "a.b" }, value: 0 }]);
    // Samples without that label are not touched.
    expect(counters("t_total")).toHaveLength(2);
    expect(counters("t_nothing")).toEqual([]);
  });
});

describe("Prometheus export: internals and finance", () => {
  const settings = (text: string) => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(CONFIG_DIR, "settings.yaml"), text);
    invalidate();
  };
  beforeEach(() => settings("title: Test\n"));

  it("exports its own work and process, with counters typed as counters", async () => {
    count("page_alerts_sent_total", { channel: "Webhook" }, 4);
    count("page_alerts_failed_total", { channel: "Webhook" });
    count("page_checks_total", { result: "up" }, 10);
    count("page_login_failures_total");
    gauge("page_widget_fetch_ok", { service: "infra.nas" }, 1);
    gauge("page_widget_fetch_duration_ms", { service: "infra.nas" }, 42);
    const out = await collectMetrics();
    expect(out).toContain('# TYPE page_alerts_sent_total counter\npage_alerts_sent_total{channel="Webhook"} 4\n');
    expect(out).toContain('page_alerts_failed_total{channel="Webhook"} 1');
    expect(out).toContain('page_checks_total{result="up"} 10');
    expect(out).toContain("\npage_login_failures_total 1\n");
    expect(out).toContain('page_widget_fetch_ok{service="infra.nas"} 1');
    expect(out).toContain('page_widget_fetch_duration_ms{service="infra.nas"} 42');
    expect(out).toContain("\npage_config_errors 0\n");
    expect(out).toMatch(/^# TYPE page_process_cpu_seconds_total counter\npage_process_cpu_seconds_total [\d.]+$/m);
    expect(out).toMatch(/^page_nodejs_heap_used_bytes \d+$/m);
    expect(out).toMatch(/^page_nodejs_eventloop_lag_seconds [\d.e-]+$/m);
    expect(out).toMatch(/^page_table_rows\{table="pings"\} \d+$/m);
    expect(out).toMatch(/^page_backups \d+$/m);
  });

  it("counts a broken config file", async () => {
    settings("title: [unclosed\n");
    expect(await collectMetrics()).toContain("\npage_config_errors 1\n");
  });

  it("leaves finance out unless it is asked for", async () => {
    db().exec("DELETE FROM fin_transactions;");
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    addTransaction({ date: day, amountCents: 250_000, currency: "EUR", description: "Salary", category: "Income", account: "Checking" });
    addTransaction({ date: day, amountCents: -4_250, currency: "EUR", description: "Groceries", category: "Food", account: "Checking" });
    expect(await collectMetrics()).not.toContain("page_finance_");

    settings("title: Test\nfinance:\n  currency: EUR\n  exportMetrics: true\n");
    const { seedAccounts } = await import("@/lib/finance/accounts");
    seedAccounts("EUR");
    const out = await collectMetrics();
    expect(out).toContain('page_finance_month_income{currency="EUR"} 2500');
    expect(out).toContain('page_finance_month_spending{currency="EUR"} 42.5');
    expect(out).toContain('page_finance_account_balance{account="Checking",currency="EUR"} 2457.5');
  });
});
