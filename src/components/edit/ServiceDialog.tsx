"use client";

import { useState } from "react";
import { integrationFields, type FieldSpec } from "@/integrations/fields";
import { tileSizes } from "@/lib/config/schema";
import { visibleField } from "./fields";
import { Icon } from "../Icon";
import { Dialog } from "./Dialog";
import { FieldInput, inputClass, type FormValue } from "./FieldInput";

export type RawService = {
  name: string;
  href?: string;
  icon?: string;
  description?: string;
  ping?: boolean | string | { type: string; [k: string]: unknown };
  widget?: { type: string; [k: string]: unknown };
  [k: string]: unknown;
};

const base: FieldSpec[] = [
  { key: "name", label: "Name", required: true },
  { key: "href", label: "Link", placeholder: "https://service.local" },
  { key: "description", label: "Description" },
];

const sizeSpec: FieldSpec = {
  key: "size",
  label: "Tile size",
  kind: "select",
  options: [...tileSizes],
  help: "wide = 2×1, tall = 1×2 with latency chart, large = 2×2 with detail list.",
};

const iconSpec: FieldSpec = {
  key: "icon",
  label: "Icon",
  placeholder: "proxmox, mdi-server, si-docker or a URL",
  help: "Names come from dashboardicons.com.",
};

/** Fields per typed check (`ping: { type: … }`). */
const checkFields: Record<string, { label: string; fields: FieldSpec[] }> = {
  http: {
    label: "HTTP (advanced)",
    fields: [
      { key: "url", label: "URL", placeholder: "Empty: the service link" },
      { key: "expect", label: "Expected status codes", kind: "list", placeholder: "200, 204", help: "Empty: anything below 500 is up." },
      { key: "keyword", label: "Body must contain", placeholder: "OK" },
      { key: "jsonPath", label: "JSON value", placeholder: "$.status", help: "Up when this value equals the next field (or is truthy when that is empty)." },
      { key: "equals", label: "…equals", placeholder: "ok" },
    ],
  },
  tcp: {
    label: "TCP port",
    fields: [
      { key: "host", label: "Host", required: true, placeholder: "10.0.0.5" },
      { key: "port", label: "Port", kind: "number", required: true, placeholder: "22" },
    ],
  },
  udp: {
    label: "UDP port",
    fields: [
      { key: "host", label: "Host", required: true, placeholder: "10.0.0.5" },
      { key: "port", label: "Port", kind: "number", required: true, placeholder: "51820" },
      { key: "payload", label: "Send", placeholder: "0x00", help: "Text, or bytes as 0x… hex. Up when anything answers; many services only answer their own protocol." },
      { key: "expect", label: "Reply must contain", placeholder: "optional" },
    ],
  },
  minecraft: {
    label: "Minecraft server",
    fields: [
      { key: "host", label: "Host", required: true, placeholder: "mc.example.com" },
      { key: "edition", label: "Edition", kind: "select", options: ["java", "bedrock"], placeholder: "java" },
      { key: "port", label: "Port", kind: "number", placeholder: "25565 (Java) / 19132 (Bedrock)" },
    ],
  },
  icmp: {
    label: "ICMP ping",
    fields: [{ key: "host", label: "Host", required: true, placeholder: "10.0.0.1", help: "Needs ping permission in the container; a TCP check works everywhere." }],
  },
  dns: {
    label: "DNS lookup",
    fields: [
      { key: "host", label: "Name to resolve", required: true, placeholder: "nas.home.arpa" },
      { key: "server", label: "DNS server", placeholder: "10.0.0.53", help: "Empty: the system resolver." },
      { key: "record", label: "Record", kind: "select", options: ["A", "AAAA", "CNAME", "MX", "TXT"], placeholder: "A" },
      { key: "expect", label: "Expected answer", placeholder: "10.0.0.20" },
    ],
  },
  snmp: {
    label: "SNMP",
    fields: [
      { key: "host", label: "Host", required: true, placeholder: "10.0.0.2" },
      { key: "community", label: "Community", placeholder: "public", secret: true },
      { key: "version", label: "Version", kind: "select", options: ["2c", "1"], placeholder: "2c" },
      { key: "oid", label: "OID", placeholder: "1.3.6.1.2.1.1.3.0 (sysUpTime)" },
      { key: "port", label: "Port", kind: "number", placeholder: "161" },
    ],
  },
};

const recordSpec: FieldSpec = {
  key: "record",
  label: "Record history",
  kind: "boolean",
  help: "Store this widget's numbers every minute: charts on the service page, and sparklines on the tile.",
};

const thresholdSpec: FieldSpec = {
  key: "thresholds",
  label: "Alert thresholds",
  kind: "yaml",
  placeholder: 'CPU: { above: 90, for: 5 }     # minutes past the limit before alerting\n"Disk /": { above: 85 }\nBattery: { below: 20 }',
  help: "Per field label. The field turns red past its limit; the alert channels hear about it (and when it's back).",
};

interface Props {
  title: string;
  initial: RawService;
  onClose: () => void;
  onSave: (s: RawService) => Promise<void>;
}

export function ServiceDialog({ title, initial, onClose, onSave }: Props) {
  const [s, setS] = useState<RawService>(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: unknown) => setS((cur) => ({ ...cur, [k]: v }));
  const pingMode = s.ping === true ? "link" : typeof s.ping === "string" ? "custom" : typeof s.ping === "object" ? s.ping.type : "off";
  const checkSpec = typeof s.ping === "object" ? checkFields[s.ping.type] : undefined;
  const widgetType = s.widget?.type ?? "";
  const widgetSpec = integrationFields[widgetType];

  const setWidgetType = (type: string) => {
    if (!type) return set("widget", undefined);
    // Keep the existing config when re-selecting the original type.
    set("widget", initial.widget?.type === type ? initial.widget : { type });
  };

  const submit = async () => {
    if (!s.name?.trim()) return setError("Name is required");
    const missing = widgetSpec?.fields.find((f) => f.required && (s.widget?.[f.key] ?? "") === "");
    if (missing) return setError(`${widgetSpec.label}: ${missing.label} is required`);
    if (pingMode === "link" && !s.href) return setError("Pinging the link requires a link");
    if (pingMode === "http" && !s.href && !(s.ping as { url?: string }).url) return setError("Set a URL for the HTTP check, or a link");
    const missingCheck = checkSpec?.fields.find((f) => f.required && ((s.ping as Record<string, unknown>)[f.key] ?? "") === "");
    if (missingCheck) return setError(`Status check: ${missingCheck.label} is required`);
    setBusy(true);
    try {
      await onSave(s);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose} onSubmit={submit} error={error} busy={busy}>
      {base.map((f, i) => (
        <FieldInput key={f.key} spec={f} autoFocus={i === 0} value={s[f.key] as FormValue} onChange={(v) => set(f.key, v)} />
      ))}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <FieldInput spec={iconSpec} value={s.icon} onChange={(v) => set("icon", v)} />
        </div>
        <div className="glass mb-[1.4rem] grid h-12 w-12 shrink-0 place-items-center rounded-xl">
          <Icon icon={s.icon} name={s.name || "?"} size={32} />
        </div>
      </div>

      <FieldInput spec={sizeSpec} value={s.size} onChange={(v) => set("size", v)} />
      <FieldInput spec={visibleField} value={s.visible} onChange={(v) => set("visible", v)} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="f-ping" className="text-xs font-medium text-muted">Status check</label>
        <div className="flex gap-2">
          <select
            id="f-ping"
            value={pingMode}
            onChange={(e) => {
              const v = e.target.value;
              const keep = typeof initial.ping === "object" && initial.ping.type === v ? initial.ping : { type: v };
              set("ping", v === "link" ? true : v === "custom" ? "" : v === "off" ? undefined : keep);
            }}
            className={`${inputClass} w-44 shrink-0`}
          >
            <option value="off">Off</option>
            <option value="link">Ping link</option>
            <option value="custom">Custom URL</option>
            {Object.entries(checkFields).map(([type, c]) => (
              <option key={type} value={type}>
                {c.label}
              </option>
            ))}
          </select>
          {pingMode === "custom" && (
            <input
              value={s.ping as string}
              onChange={(e) => set("ping", e.target.value)}
              placeholder="http://10.0.0.5:8080/health"
              className={inputClass}
              required
            />
          )}
        </div>
        {checkSpec && (
          <div className="mt-1 grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-2">
            {checkSpec.fields.map((f) => (
              <FieldInput
                key={f.key}
                spec={f}
                value={(s.ping as Record<string, unknown>)[f.key] as FormValue}
                onChange={(v) => set("ping", { ...(s.ping as object), [f.key]: v })}
              />
            ))}
          </div>
        )}
        {pingMode !== "off" && (
          <label className="mt-1 flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={s.alert !== false}
              onChange={(e) => set("alert", e.target.checked ? undefined : false)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Send down/up alerts for this service
          </label>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-line p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-widget" className="text-xs font-medium text-muted">Integration</label>
          <select id="f-widget" value={widgetType} onChange={(e) => setWidgetType(e.target.value)} className={inputClass}>
            <option value="">None</option>
            {Object.entries(integrationFields).map(([type, spec]) => (
              <option key={type} value={type}>{spec.label}</option>
            ))}
            {widgetType && !widgetSpec && <option value={widgetType}>{widgetType} (unknown)</option>}
          </select>
        </div>
        {widgetSpec?.fields.map((f) => (
          <FieldInput
            key={f.key}
            spec={f}
            value={s.widget?.[f.key] as FormValue}
            onChange={(v) => set("widget", { ...s.widget!, [f.key]: v })}
          />
        ))}
        {widgetType && (
          <>
            <FieldInput
              spec={recordSpec}
              value={s.widget?.record as FormValue}
              onChange={(v) => set("widget", { ...s.widget!, record: v || undefined })}
            />
            <FieldInput
              spec={thresholdSpec}
              value={s.widget?.thresholds as FormValue}
              onChange={(v) => set("widget", { ...s.widget!, thresholds: v })}
            />
          </>
        )}
        {widgetSpec && (
          <p className="text-xs text-muted/80">
            Secrets can reference environment variables, e.g. <code className="text-fg">{"{{HOMEPAGE_VAR_MY_KEY}}"}</code>.
          </p>
        )}
      </div>
    </Dialog>
  );
}
