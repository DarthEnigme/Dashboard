import { z } from "zod";
import { indexOf, num, snmpGet, snmpWalk, type SnmpTarget, type SnmpValue, type Varbind } from "@/lib/snmp";
import type { Integration, WidgetField, WidgetResult, WidgetSpark } from "./types";
import { duration, loadStatus, pct } from "./format";
import { formatMetric, metricField, metricFormats, thresholdSchema } from "./metrics";

// Standard MIB-2 / HOST-RESOURCES / IF-MIB / Printer-MIB objects.
export const OID = {
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  hrProcessorLoad: "1.3.6.1.2.1.25.3.3.1.2",
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
  ifName: "1.3.6.1.2.1.31.1.1.1.1",
  ifHCInOctets: "1.3.6.1.2.1.31.1.1.1.6",
  ifHCOutOctets: "1.3.6.1.2.1.31.1.1.1.10",
  ifHighSpeed: "1.3.6.1.2.1.31.1.1.1.15",
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",
  hrStorageDescr: "1.3.6.1.2.1.25.2.3.1.3",
  hrStorageUnits: "1.3.6.1.2.1.25.2.3.1.4",
  hrStorageSize: "1.3.6.1.2.1.25.2.3.1.5",
  hrStorageUsed: "1.3.6.1.2.1.25.2.3.1.6",
  supplyDescr: "1.3.6.1.2.1.43.11.1.1.6.1",
  supplyMax: "1.3.6.1.2.1.43.11.1.1.8.1",
  supplyLevel: "1.3.6.1.2.1.43.11.1.1.9.1",
};

const oidSchema = z.object({
  oid: z.string().regex(/^\.?\d+(\.\d+)+$/, "numeric OID, e.g. 1.3.6.1.2.1.1.3.0"),
  label: z.string(),
  format: z.enum(metricFormats).default("number"),
  /** Multiply the raw value, e.g. 0.01 for timeticks to seconds or 0.1 for tenths of a degree. */
  scale: z.number().optional(),
  /** Counters: show the per-second rate between two reads instead of the total. */
  rate: z.boolean().optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  suffix: z.string().optional(),
  ...thresholdSchema,
});

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().default(161),
  community: z.string().default("public"),
  version: z.enum(["1", "2c"]).default("2c"),
  /** system: uptime and CPU; interface: traffic of one port; storage: RAM and disks; printer: supplies; custom: only `oids`. */
  preset: z.enum(["system", "interface", "storage", "printer", "custom"]).default("system"),
  /** interface preset: ifIndex, or the interface's name / description (e.g. "eth0", "Port 5"). */
  interface: z.union([z.string(), z.number()]).optional(),
  /** Extra values, after the preset's. */
  oids: z.array(oidSchema).default([]),
});
type Config = z.infer<typeof schema>;

// ---------- pure parts (unit tested) ----------

const TWO64 = 2n ** 64n;

/** Per-second rate between two counter reads; handles a 64-bit wrap; undefined on the first read or a reset. */
export function counterRate(prev: { value: bigint; at: number } | undefined, cur: { value: bigint; at: number }, bits: 32 | 64 = 64): number | undefined {
  if (!prev || cur.at <= prev.at) return undefined;
  let d = cur.value - prev.value;
  if (d < 0n) {
    const wrapped = d + (bits === 64 ? TWO64 : 2n ** 32n);
    // A device reboot also makes the counter smaller: only trust small wrapped deltas.
    if (wrapped < 0n || wrapped > (bits === 64 ? TWO64 / 2n : 2n ** 31n)) return undefined;
    d = wrapped;
  }
  return Number(d) / ((cur.at - prev.at) / 1000);
}

/** ifIndex for "7", or the interface whose ifName / ifDescr / ifAlias matches (case-insensitive). */
export function findInterface(wanted: string | number, names: Varbind[][]): string | undefined {
  const w = String(wanted).trim().toLowerCase();
  if (/^\d+$/.test(w)) return w;
  for (const [column, rows] of [
    [OID.ifName, names[0]],
    [OID.ifDescr, names[1]],
    [OID.ifAlias, names[2]],
  ] as const) {
    const hit = rows?.find((r) => String(r.value ?? "").toLowerCase() === w);
    if (hit) return indexOf(hit.oid, column);
  }
  return undefined;
}

export interface StorageRow {
  name: string;
  size: number;
  used: number;
}

/** hrStorageTable columns → bytes per entry (skipping empty ones). */
export function parseStorage(descr: Varbind[], units: Varbind[], size: Varbind[], used: Varbind[]): StorageRow[] {
  const byIndex = (vbs: Varbind[], column: string) => new Map(vbs.map((v) => [indexOf(v.oid, column), v.value]));
  const u = byIndex(units, OID.hrStorageUnits);
  const s = byIndex(size, OID.hrStorageSize);
  const d = byIndex(used, OID.hrStorageUsed);
  return descr
    .map((v) => {
      const i = indexOf(v.oid, OID.hrStorageDescr);
      const unit = num(u.get(i) ?? 0);
      return { name: String(v.value ?? i), size: num(s.get(i) ?? 0) * unit, used: num(d.get(i) ?? 0) * unit };
    })
    .filter((r) => r.size > 0);
}

export interface Supply {
  name: string;
  /** 0–1, or undefined when the printer only reports "some left" / unknown. */
  level?: number;
}

/** Printer-MIB supplies. Levels: -3 = some remaining, -2 = unknown, -1 = unlimited. */
export function parseSupplies(descr: Varbind[], max: Varbind[], level: Varbind[]): Supply[] {
  const m = new Map(max.map((v) => [indexOf(v.oid, OID.supplyMax), num(v.value)]));
  const l = new Map(level.map((v) => [indexOf(v.oid, OID.supplyLevel), num(v.value)]));
  return descr.map((v) => {
    const i = indexOf(v.oid, OID.supplyDescr);
    const mx = m.get(i) ?? 0;
    const lv = l.get(i) ?? -2;
    return { name: String(v.value ?? `Supply ${i}`), level: mx > 0 && lv >= 0 ? Math.min(1, lv / mx) : undefined };
  });
}

// ---------- fetching ----------

// Counter history per host+oid, for rates and sparklines (kept in memory, like other integrations' caches).
const counters = new Map<string, { value: bigint; at: number }>();
const rates = new Map<string, number[]>();
const big = (v: SnmpValue) => (typeof v === "bigint" ? v : BigInt(Math.trunc(num(v)) || 0));

function trackRate(key: string, value: SnmpValue, at: number): number | undefined {
  if (value === null) return undefined;
  const cur = { value: big(value), at };
  const r = counterRate(counters.get(key), cur);
  counters.set(key, cur);
  if (r !== undefined) rates.set(key, [...(rates.get(key) ?? []), r].slice(-30));
  return r;
}

async function systemPreset(t: SnmpTarget): Promise<WidgetResult> {
  const [name, up, descr] = await snmpGet(t, [OID.sysName, OID.sysUpTime, OID.sysDescr]);
  const loads = await snmpWalk(t, OID.hrProcessorLoad).catch(() => [] as Varbind[]);
  const fields: WidgetField[] = [{ label: "Uptime", value: up?.value === null ? "–" : duration(num(up.value) / 100) }];
  if (loads.length) {
    const cpu = loads.reduce((a, v) => a + num(v.value), 0) / loads.length / 100;
    fields.push({ label: "CPU", value: pct(cpu), status: loadStatus(cpu) });
  }
  if (name?.value) fields.push({ label: "Name", value: String(name.value) });
  return { fields, list: descr?.value ? [{ label: "System", value: String(descr.value).slice(0, 80) }] : undefined };
}

async function interfacePreset(t: SnmpTarget, cfg: Config): Promise<WidgetResult> {
  if (cfg.interface === undefined) throw new Error("Set `interface` (ifIndex or name) for the interface preset");
  let idx = /^\d+$/.test(String(cfg.interface)) ? String(cfg.interface) : undefined;
  if (!idx) {
    const names = await Promise.all([OID.ifName, OID.ifDescr, OID.ifAlias].map((o) => snmpWalk(t, o).catch(() => [] as Varbind[])));
    idx = findInterface(cfg.interface, names);
    if (!idx) throw new Error(`No interface named "${cfg.interface}"`);
  }
  const at = Date.now();
  const [oper, inOct, outOct, speed] = await snmpGet(t, [OID.ifOperStatus, OID.ifHCInOctets, OID.ifHCOutOctets, OID.ifHighSpeed].map((o) => `${o}.${idx}`));
  const key = `${t.host}:${t.port}|${idx}`;
  const rIn = trackRate(`${key}|in`, inOct?.value ?? null, at);
  const rOut = trackRate(`${key}|out`, outOct?.value ?? null, at);
  const isUp = num(oper?.value) === 1;
  const fields: WidgetField[] = [
    { label: "Link", value: isUp ? "up" : "down", status: isUp ? "ok" : "error" },
    { label: "In", value: rIn === undefined ? "–" : formatMetric(rIn, "bytesPerSec") },
    { label: "Out", value: rOut === undefined ? "–" : formatMetric(rOut, "bytesPerSec") },
  ];
  const mbps = num(speed?.value);
  if (mbps > 0) fields.push({ label: "Speed", value: mbps >= 1000 ? `${mbps / 1000} Gb/s` : `${mbps} Mb/s` });
  const sparks: WidgetSpark[] = [];
  for (const [label, k, r] of [["In", "in", rIn], ["Out", "out", rOut]] as const) {
    const values = rates.get(`${key}|${k}`) ?? [];
    if (values.length > 1) sparks.push({ label, values, current: r === undefined ? "–" : formatMetric(r, "bytesPerSec") });
  }
  return { fields, sparks: sparks.length ? sparks : undefined };
}

async function storagePreset(t: SnmpTarget): Promise<WidgetResult> {
  const cols = await Promise.all([OID.hrStorageDescr, OID.hrStorageUnits, OID.hrStorageSize, OID.hrStorageUsed].map((o) => snmpWalk(t, o)));
  const rows = parseStorage(cols[0], cols[1], cols[2], cols[3]);
  if (!rows.length) throw new Error("No HOST-RESOURCES storage table (is it enabled on the device?)");
  const ram = rows.find((r) => /physical memory|real memory|^ram$/i.test(r.name));
  const disks = rows.filter((r) => r.name.startsWith("/") || /^[A-Z]:\\/.test(r.name));
  const fields: WidgetField[] = [];
  if (ram) fields.push({ label: "RAM", value: pct(ram.used / ram.size), status: loadStatus(ram.used / ram.size) });
  const fullest = [...disks].sort((a, b) => b.used / b.size - a.used / a.size)[0];
  if (fullest) fields.push({ label: `Disk ${fullest.name}`.slice(0, 24), value: pct(fullest.used / fullest.size), status: loadStatus(fullest.used / fullest.size) });
  fields.push({ label: "Volumes", value: disks.length });
  return {
    fields,
    list: (disks.length ? disks : rows).map((r) => ({
      label: r.name,
      value: `${formatMetric(r.used, "bytes")} / ${formatMetric(r.size, "bytes")} (${pct(r.used / r.size)})`,
      status: loadStatus(r.used / r.size) === "ok" ? undefined : loadStatus(r.used / r.size),
    })),
  };
}

async function printerPreset(t: SnmpTarget): Promise<WidgetResult> {
  const cols = await Promise.all([OID.supplyDescr, OID.supplyMax, OID.supplyLevel].map((o) => snmpWalk(t, o)));
  const supplies = parseSupplies(cols[0], cols[1], cols[2]);
  if (!supplies.length) throw new Error("No Printer-MIB supplies found");
  const status = (l?: number) => (l === undefined ? undefined : l < 0.05 ? ("error" as const) : l < 0.15 ? ("warn" as const) : undefined);
  const known = supplies.filter((s) => s.level !== undefined);
  const lowest = [...known].sort((a, b) => a.level! - b.level!)[0];
  return {
    fields: [
      { label: "Lowest", value: lowest ? `${lowest.name.slice(0, 18)} ${pct(lowest.level!)}` : "–", status: status(lowest?.level) },
      { label: "Supplies", value: supplies.length },
    ],
    list: supplies.map((s) => ({ label: s.name, value: s.level === undefined ? "ok" : pct(s.level), status: status(s.level) })),
  };
}

async function customOids(t: SnmpTarget, cfg: Config): Promise<WidgetField[]> {
  if (!cfg.oids.length) return [];
  const at = Date.now();
  const vbs = await snmpGet(t, cfg.oids.map((o) => o.oid.replace(/^\./, "")));
  return cfg.oids.map((o, i) => {
    const raw = vbs[i]?.value ?? null;
    if (raw === null) return { label: o.label, value: "–" };
    if (typeof raw === "string" && !/^-?\d+(\.\d+)?$/.test(raw)) return { label: o.label, value: raw };
    let v = o.rate ? trackRate(`${t.host}:${t.port}|${o.oid}`, raw, at) : num(raw);
    if (v === undefined) return { label: o.label, value: "–" };
    if (o.scale) v *= o.scale;
    return metricField(o.label, v, o);
  });
}

export const snmpIntegration: Integration<typeof schema> = {
  type: "snmp",
  schema,
  async fetch(cfg) {
    const t: SnmpTarget = { host: cfg.host, port: cfg.port, community: cfg.community, version: cfg.version };
    const base: WidgetResult =
      cfg.preset === "interface"
        ? await interfacePreset(t, cfg)
        : cfg.preset === "storage"
          ? await storagePreset(t)
          : cfg.preset === "printer"
            ? await printerPreset(t)
            : cfg.preset === "custom"
              ? { fields: [] }
              : await systemPreset(t);
    const extra = await customOids(t, cfg);
    return { ...base, fields: [...base.fields, ...extra] };
  },
};
