import { db, getAppMeta, setAppMeta } from "../db";
import { loadConfig } from "../config/load";
import { hasAlertChannel, sendNotice } from "../alerts";
import { cached } from "../cache";
import { runCheck, type PingResult } from "../checks";
import { parseCsv } from "../finance/csv";
import { safeText, toCsv } from "../finance/csvText";
import { normalizeMac } from "../wol";

export const DEVICE_KINDS = ["server", "nas", "router", "switch", "ap", "computer", "laptop", "phone", "tablet", "tv", "printer", "camera", "iot", "other"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export interface Device {
  id: number;
  name: string;
  kind: DeviceKind;
  ip: string | null;
  mac: string | null;
  hostname: string | null;
  location: string | null;
  vendor: string | null;
  model: string | null;
  serial: string | null;
  purchase_date: string | null;
  price_cents: number | null;
  warranty_until: string | null;
  /** A dashboard service this device runs (its status and page are linked). */
  service_id: string | null;
  tags: string | null;
  notes: string | null;
  /** Check this TCP port instead of pinging (ICMP needs ping permission in the container). */
  check_port: number | null;
  /** Where Wake-on-LAN packets go, e.g. 192.168.1.255 (default the global broadcast). */
  wol_broadcast: string | null;
}

/** The editable columns, in CSV order. */
export const DEVICE_COLUMNS = ["name", "kind", "ip", "mac", "hostname", "location", "vendor", "model", "serial", "purchase_date", "price", "warranty_until", "service_id", "tags", "notes", "check_port", "wol_broadcast"] as const;

const text = (s: unknown, max = 200) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
const day = (d: unknown, what: string) => {
  if (d === undefined || d === null || d === "") return null;
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new Error(`${what} must be YYYY-MM-DD`);
  return d;
};
const ipOrHost = (s: unknown) => {
  const v = text(s, 255);
  if (v && !/^[\w.:-]+$/.test(v)) throw new Error("IP must be an address or host name");
  return v;
};

/** A device from a form, the API or a CSV row (all values may be strings). */
export function cleanDevice(b: Record<string, unknown>): Omit<Device, "id"> {
  const name = text(b.name, 100);
  if (!name) throw new Error("Name required");
  const mac = text(b.mac, 30);
  if (mac && !normalizeMac(mac)) throw new Error(`Not a MAC address: ${mac}`);
  const port = b.check_port === undefined || b.check_port === null || b.check_port === "" ? null : Number(b.check_port);
  if (port !== null && !(Number.isInteger(port) && port > 0 && port < 65536)) throw new Error("Port must be 1–65535");
  const price = b.price ?? (typeof b.price_cents === "number" ? b.price_cents / 100 : undefined);
  const priceNum = price === undefined || price === null || price === "" ? null : Number(String(price).replace(",", "."));
  if (priceNum !== null && !Number.isFinite(priceNum)) throw new Error("Price must be a number");
  return {
    name,
    kind: DEVICE_KINDS.includes(b.kind as DeviceKind) ? (b.kind as DeviceKind) : "other",
    ip: ipOrHost(b.ip),
    mac: mac ? normalizeMac(mac)! : null,
    hostname: ipOrHost(b.hostname),
    location: text(b.location, 80),
    vendor: text(b.vendor, 80),
    model: text(b.model, 120),
    serial: text(b.serial, 120),
    purchase_date: day(b.purchase_date, "Purchase date"),
    price_cents: priceNum === null ? null : Math.round(priceNum * 100),
    warranty_until: day(b.warranty_until, "Warranty end"),
    service_id: text(b.service_id, 120),
    tags: text(b.tags, 200),
    notes: text(b.notes, 4000),
    check_port: port,
    wol_broadcast: text(b.wol_broadcast, 60),
  };
}

const COLS = "name, kind, ip, mac, hostname, location, vendor, model, serial, purchase_date, price_cents, warranty_until, service_id, tags, notes, check_port, wol_broadcast";
const values = (d: Omit<Device, "id">) => [d.name, d.kind, d.ip, d.mac, d.hostname, d.location, d.vendor, d.model, d.serial, d.purchase_date, d.price_cents, d.warranty_until, d.service_id, d.tags, d.notes, d.check_port, d.wol_broadcast];

export const listDevices = () => db().prepare(`SELECT id, ${COLS} FROM devices ORDER BY location IS NULL, location COLLATE NOCASE, name COLLATE NOCASE`).all() as unknown as Device[];
export const getDevice = (id: number) => db().prepare(`SELECT id, ${COLS} FROM devices WHERE id = ?`).get(id) as Device | undefined;

export function addDevice(b: Record<string, unknown>) {
  const d = cleanDevice(b);
  db().prepare(`INSERT INTO devices (${COLS}, created_at) VALUES (${"?, ".repeat(17)}?)`).run(...values(d), Date.now());
  return listDevices();
}

export function updateDevice(id: number, b: Record<string, unknown>) {
  const cur = getDevice(id);
  if (!cur) throw new Error("No such device");
  const d = cleanDevice({ ...cur, price: cur.price_cents === null ? null : cur.price_cents / 100, ...b });
  db().prepare(`UPDATE devices SET ${COLS.split(", ").map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...values(d), id);
  return listDevices();
}

export function deleteDevice(id: number) {
  db().prepare("DELETE FROM devices WHERE id = ?").run(id);
  return listDevices();
}

// ---------- CSV ----------

export function devicesCsv(list = listDevices()): string {
  return toCsv([
    [...DEVICE_COLUMNS],
    ...list.map((d) =>
      DEVICE_COLUMNS.map((c) => {
        if (c === "price") return d.price_cents === null ? "" : (d.price_cents / 100).toFixed(2);
        const v = d[c as keyof Device];
        return typeof v === "string" ? safeText(v) : (v ?? "");
      }),
    ),
  ]);
}

/**
 * Add devices from a CSV whose header names the columns (any order, unknown ones ignored). A row
 * whose MAC (or else name) matches an existing device updates it, so importing an export again is safe.
 */
export function importDevices(text: string): { added: number; updated: number; errors: string[] } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) throw new Error("The file has no rows");
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!header.includes("name")) throw new Error("The first row must name the columns, including name");
  const existing = listDevices();
  let added = 0;
  let updated = 0;
  const errors: string[] = [];
  db().exec("BEGIN");
  try {
    rows.slice(1).forEach((r, i) => {
      if (r.every((c) => !c.trim())) return;
      const raw = Object.fromEntries(header.map((h, j) => [h, (r[j] ?? "").replace(/^'(?=[=+\-@])/, "")]));
      try {
        const d = cleanDevice(raw);
        const match = existing.find((e) => (d.mac && e.mac === d.mac) || (!d.mac && e.name.toLowerCase() === d.name.toLowerCase()));
        if (match) {
          db().prepare(`UPDATE devices SET ${COLS.split(", ").map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...values(d), match.id);
          updated++;
        } else {
          db().prepare(`INSERT INTO devices (${COLS}, created_at) VALUES (${"?, ".repeat(17)}?)`).run(...values(d), Date.now());
          added++;
        }
      } catch (e) {
        errors.push(`Line ${i + 2}: ${(e as Error).message}`);
      }
    });
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
  return { added, updated, errors };
}

// ---------- status ----------

/** Up or down for every device with an IP or host name: TCP when a port is set, else ICMP. Cached 30 s. */
export async function deviceStatuses(list = listDevices()): Promise<Record<number, PingResult>> {
  const out: Record<number, PingResult> = {};
  await Promise.all(
    list.map(async (d) => {
      const host = d.ip ?? d.hostname;
      if (!host) return;
      const check = d.check_port ? ({ type: "tcp", host, port: d.check_port } as const) : ({ type: "icmp", host } as const);
      out[d.id] = await cached(`device|${check.type}|${host}|${d.check_port ?? ""}`, 30_000, () => runCheck(check)).catch((e) => ({ up: false, error: (e as Error).message }));
    }),
  );
  return out;
}

// ---------- warranty reminders ----------

/** Hourly: tell the alert channels once when a device's warranty is about to end. */
export async function warrantyJob(now = new Date()) {
  const { settings } = loadConfig();
  const days = settings.inventory.warrantyDays;
  if (!days || !hasAlertChannel(settings.alerts)) return;
  const today = now.toISOString().slice(0, 10);
  const limit = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  for (const d of listDevices()) {
    if (!d.warranty_until || d.warranty_until < today || d.warranty_until > limit) continue;
    const key = `warranty:${d.id}:${d.warranty_until}`;
    if (getAppMeta(key)) continue;
    const left = Math.round((Date.parse(d.warranty_until) - Date.parse(today)) / 86_400_000);
    const errors = await sendNotice(settings.alerts, {
      kind: "warranty",
      level: "warn",
      message: `The warranty of ${d.name} ends in ${left} days (${d.warranty_until}).`,
      device: d.name,
      until: d.warranty_until,
      days: left,
    });
    if (!errors.length) setAppMeta(key, true);
  }
}
