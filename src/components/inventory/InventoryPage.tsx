"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, Download, ExternalLink, FileUp, Pencil, Plus, Power, Search } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Device } from "@/lib/inventory/store";
import type { PingResult } from "@/lib/checks";
import type { FieldSpec } from "@/integrations/fields";
import { msg } from "@/i18n";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { FieldsDialog } from "../edit/FieldsDialog";
import { DeleteButton, IconButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";

const KEY = "/api/inventory";
const KINDS = ["server", "nas", "router", "switch", "ap", "computer", "laptop", "phone", "tablet", "tv", "printer", "camera", "iot", "other"];

const fields: FieldSpec[] = [
  { key: "name", label: msg("Name"), required: true, placeholder: msg("NAS, living room TV…") },
  { key: "kind", label: msg("Kind"), kind: "select", options: KINDS, required: true },
  { key: "ip", label: msg("IP address or host name"), placeholder: "192.168.1.20" },
  { key: "mac", label: msg("MAC address"), placeholder: "AA:BB:CC:DD:EE:FF", help: msg("Needed for Wake-on-LAN.") },
  { key: "location", label: msg("Location"), placeholder: msg("Rack, office, living room…") },
  { key: "vendor", label: msg("Vendor") },
  { key: "model", label: msg("Model") },
  { key: "serial", label: msg("Serial number") },
  { key: "purchase_date", label: msg("Bought on (YYYY-MM-DD)") },
  { key: "price", label: msg("Price"), kind: "number" },
  { key: "warranty_until", label: msg("Warranty until (YYYY-MM-DD)"), help: msg("The alert channels hear about it a month before (inventory.warrantyDays).") },
  { key: "service_id", label: msg("Dashboard service"), placeholder: "infra.nas", help: msg("Its id (group.service): the device links to the service's page.") },
  { key: "check_port", label: msg("Check this TCP port"), kind: "number", placeholder: "22", help: msg("Instead of a ping (which needs ping permission in the container).") },
  { key: "wol_broadcast", label: msg("Wake-on-LAN broadcast"), placeholder: "255.255.255.255", help: msg("The subnet's broadcast address, optionally with :port.") },
  { key: "tags", label: msg("Tags") },
  { key: "notes", label: msg("Notes"), kind: "textarea" },
];

type Status = Record<number, PingResult>;

/** Every device on the network: where it is, whether it answers, its warranty, and Wake-on-LAN. */
export function InventoryPage({ canWake }: { canWake: boolean }) {
  const t = useT();
  const { data: devices, mutate, error } = useSWR<Device[]>(KEY, fetcher);
  const { data: status, mutate: recheck } = useSWR<Status>(`${KEY}/status`, fetcher, { refreshInterval: 30_000 });
  // New or changed devices get their status right away, not at the next 30 s refresh.
  const ids = (devices ?? []).map((d) => `${d.id}:${d.ip}:${d.check_port}`).join(",");
  useEffect(() => {
    if (ids) void recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState("");
  const [editing, setEditing] = useState<Device | "new">();
  const [msgText, setMsg] = useState<{ text: string; error?: boolean }>();
  const file = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const list = devices ?? [];
  const locations = [...new Set(list.map((d) => d.location).filter(Boolean) as string[])].sort();
  const needle = q.trim().toLowerCase();
  const shown = list.filter(
    (d) =>
      (!location || d.location === location) &&
      (!kind || d.kind === kind) &&
      (!needle || [d.name, d.ip, d.mac, d.hostname, d.vendor, d.model, d.serial, d.tags, d.notes].some((v) => v?.toLowerCase().includes(needle))),
  );
  const up = list.filter((d) => status?.[d.id]?.up).length;
  const checked = list.filter((d) => status?.[d.id]).length;

  const wakeDevice = async (d: Device) => {
    try {
      const r = await sendJson<{ message: string }>(`${KEY}/${d.id}/wake`, "POST");
      setMsg({ text: r.message });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  const importFile = async (f: File) => {
    try {
      const r = await sendJson<{ added: number; updated: number; errors: string[] }>(`${KEY}/csv`, "POST", { text: await f.text() });
      setMsg({ text: t("Imported: {added} added, {updated} updated.", { added: r.added, updated: r.updated }) + (r.errors.length ? ` ${r.errors.slice(0, 3).join(" · ")}` : ""), error: r.errors.length > 0 });
      await mutate();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {t("Dashboard")}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("Inventory")}</h1>
          <p className="text-muted">
            {t.plural(list.length, "{n} device", "{n} devices")}
            {checked > 0 && ` · ${t("{up} of {n} answering", { up, n: checked })}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`${KEY}/csv`} download className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2 text-sm hover:bg-hover">
            <Download className="h-4 w-4" /> {t("Export CSV")}
          </a>
          <button type="button" onClick={() => file.current?.click()} className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2 text-sm hover:bg-hover">
            <FileUp className="h-4 w-4" /> {t("Import CSV")}
          </button>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => (e.target.files?.[0] && void importFile(e.target.files[0]), (e.target.value = ""))} />
          <button type="button" onClick={() => setEditing("new")} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
            <Plus className="h-4 w-4" /> {t("Add device")}
          </button>
        </div>
      </header>
      {error && <p className="text-[var(--err)]">{(error as Error).message}</p>}
      {msgText && (
        <p role={msgText.error ? "alert" : "status"} className={`text-sm ${msgText.error ? "text-[var(--err)]" : "text-muted"}`}>
          {msgText.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Name, IP, MAC, serial…")} aria-label={t("Search devices")} className={`${inputBase} w-64 pl-9`} />
        </label>
        <select aria-label={t("Location")} value={location} onChange={(e) => setLocation(e.target.value)} className={`${inputBase} w-44`}>
          <option value="">{t("All locations")}</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label={t("Kind")} value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputBase} w-40`}>
          <option value="">{t("All kinds")}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      {devices && !list.length && <p className="glass rounded-3xl p-8 text-center text-sm text-muted">{t("No devices yet. Add them one by one, or import a CSV (the export shows the columns).")}</p>}
      {shown.length > 0 && (
        <div className="glass overflow-x-auto rounded-3xl p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="w-8 px-2 py-2" aria-label={t("Status")} />
                <th className="px-2 py-2 font-medium">{t("Name")}</th>
                <th className="px-2 py-2 font-medium">{t("IP / MAC")}</th>
                <th className="px-2 py-2 font-medium">{t("Location")}</th>
                <th className="px-2 py-2 font-medium">{t("Model")}</th>
                <th className="px-2 py-2 font-medium">{t("Warranty")}</th>
                <th className="w-32" />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const s = status?.[d.id];
                const expired = d.warranty_until && d.warranty_until < today;
                const ending = d.warranty_until && !expired && d.warranty_until <= soon;
                return (
                  <tr key={d.id} className="border-t border-line/50" data-device={d.name}>
                    <td className="px-2 py-2">
                      <span
                        className={`block h-2.5 w-2.5 rounded-full ${!s ? "bg-track" : s.up ? "bg-[var(--ok)]" : "bg-[var(--err)]"}`}
                        role="img"
                        aria-label={!s ? t("Not checked") : s.up ? t("Up") : t("Down")}
                        title={!s ? t("No IP to check") : s.up ? `${t("Up")}${s.latencyMs !== undefined ? ` · ${s.latencyMs} ms` : ""}` : `${t("Down")}${s.error ? ` (${s.error})` : ""}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5 font-medium">
                        {d.name}
                        {d.service_id && (
                          <Link href={`/service/${encodeURIComponent(d.service_id)}`} aria-label={t("Open the service page")} className="text-muted hover:text-accent">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                      <div className="text-xs text-muted">{[d.kind, d.tags].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">
                      <div>{d.ip ?? d.hostname ?? "–"}</div>
                      <div className="text-muted">{d.mac ?? ""}</div>
                    </td>
                    <td className="px-2 py-2">{d.location ?? "–"}</td>
                    <td className="px-2 py-2">
                      <div>{[d.vendor, d.model].filter(Boolean).join(" ") || "–"}</div>
                      {d.serial && <div className="font-mono text-xs text-muted">{d.serial}</div>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {d.warranty_until ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${expired ? "bg-chip text-muted line-through" : ending ? "bg-[var(--warn)]/20 text-[var(--warn)]" : "bg-chip"}`} title={expired ? t("Warranty ended") : undefined}>
                          {dateOnly(d.warranty_until)}
                        </span>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex items-center justify-end gap-0.5">
                      {canWake && d.mac && (
                        <IconButton label={t("Wake {name}", { name: d.name })} onClick={() => void wakeDevice(d)}>
                          <Power className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      <IconButton label={t("Edit {name}", { name: d.name })} onClick={() => setEditing(d)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <DeleteButton label={t("Delete {name}", { name: d.name })} onConfirm={async () => void mutate(await sendJson<Device[]>(`${KEY}?id=${d.id}`, "DELETE"), { revalidate: false })} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <FieldsDialog
          title={editing === "new" ? t("Add device") : t("Edit {name}", { name: editing.name })}
          fields={fields}
          initial={editing === "new" ? { kind: "other" } : { ...editing, price: editing.price_cents === null ? undefined : editing.price_cents / 100 }}
          onClose={() => setEditing(undefined)}
          onSave={async (v) => {
            await mutate(await sendJson<Device[]>(KEY, editing === "new" ? "POST" : "PATCH", editing === "new" ? v : { ...v, id: editing.id }), { revalidate: false });
          }}
        />
      )}
    </main>
  );
}
