"use client";

import { useState } from "react";
import YAML from "yaml";
import { Upload, X } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { FieldSpec } from "@/integrations/fields";
import { MASK } from "@/lib/config/schema";

/** Strings, numbers and booleans, plus string[] for "list" and any YAML value for "yaml". */
export type FormValue = unknown;

/** Input look without a width, for inline rows that size their own fields. */
export const inputBase =
  "h-10 rounded-xl border border-line bg-chip px-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/30";
export const inputClass = `${inputBase} w-full`;

export function FieldInput({
  spec,
  value,
  onChange,
  autoFocus,
}: {
  spec: FieldSpec;
  value: FormValue;
  onChange: (v: FormValue) => void;
  autoFocus?: boolean;
}) {
  const id = `f-${spec.key}`;

  if (spec.kind === "boolean") {
    return (
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={value === undefined ? !!spec.default : !!value}
          // Store only differences from the default, so defaults stay out of the YAML.
          onChange={(e) => onChange(e.target.checked === !!spec.default ? undefined : e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        {spec.label}
      </label>
    );
  }

  let control;
  if (spec.kind === "list") {
    control = <ListInput id={id} value={value} placeholder={spec.placeholder} onChange={onChange} />;
  } else if (spec.kind === "yaml") {
    control = <YamlInput id={id} value={value} placeholder={spec.placeholder} onChange={onChange} />;
  } else if (spec.kind === "textarea") {
    const text = String(value ?? "");
    control = (
      <textarea
        id={id}
        rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
        value={text}
        placeholder={spec.placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        className={`${inputClass} h-auto py-2 font-mono text-xs leading-relaxed`}
      />
    );
  } else if (spec.kind === "audience") {
    control = <AudienceInput id={id} value={value} onChange={onChange} />;
  } else if (spec.kind === "image") {
    control = <ImageInput id={id} value={value} placeholder={spec.placeholder} upload={spec.upload} onChange={onChange} />;
  } else if (spec.kind === "select") {
    control = (
      <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)} className={inputClass}>
        {!spec.required && <option value="">{spec.placeholder ? `${spec.placeholder} (default)` : "—"}</option>}
        {spec.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (spec.kind === "range") {
    const n = typeof value === "number" ? value : Number(spec.placeholder ?? spec.min ?? 0);
    control = (
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? "any"}
          value={n}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-10 flex-1 accent-[var(--accent)]"
        />
        <span className="w-12 text-right text-sm tabular-nums">{n}</span>
      </div>
    );
  } else if (spec.kind === "color") {
    control = (
      <div className="flex gap-2">
        <input
          type="color"
          value={String(value || "#8b5cf6")}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border border-line bg-transparent"
        />
        <input id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      </div>
    );
  } else {
    const isMasked = spec.secret && value === MASK;
    control = (
      <input
        id={id}
        autoFocus={autoFocus}
        type={spec.secret ? "password" : spec.kind === "number" ? "number" : "text"}
        step="any"
        required={spec.required && !isMasked}
        value={isMasked ? "" : String(value ?? "")}
        placeholder={isMasked ? "•••••••• (unchanged)" : spec.placeholder}
        autoComplete={spec.secret ? "new-password" : "off"}
        onChange={(e) => {
          const v = e.target.value;
          if (spec.secret && v === "" && isMasked) return;
          onChange(v === "" ? undefined : spec.kind === "number" ? Number(v) : v);
        }}
        className={inputClass}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {spec.label}
        {spec.required && <span className="text-accent"> *</span>}
      </label>
      {control}
      {spec.help && <p className="text-xs text-muted/80">{spec.help}</p>}
    </div>
  );
}

/** public / users / admins, or a list of groups (visible: [family, media]). */
function AudienceInput({ id, value, onChange }: { id: string; value: unknown; onChange: (v: FormValue) => void }) {
  const { data: groups } = useSWR<{ id: number; name: string }[]>("/api/groups", fetcher);
  const picked = Array.isArray(value) ? (value as string[]) : undefined;
  const mode = picked ? "groups" : typeof value === "string" ? value : "";
  return (
    <div className="flex flex-col gap-2">
      <select
        id={id}
        value={mode}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "groups" ? (picked ?? (groups?.[0] ? [groups[0].name] : ["family"])) : v || undefined);
        }}
        className={inputClass}
      >
        <option value="">public (default)</option>
        <option value="users">users</option>
        <option value="admins">admins</option>
        <option value="groups">specific groups…</option>
      </select>
      {picked && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-xl border border-line px-3 py-2 text-sm">
          {groups?.length === 0 && <span className="text-xs text-muted">No groups yet: create them in Settings → Accounts & sign-in.</span>}
          {[...new Set([...(groups ?? []).map((g) => g.name), ...picked])].map((name) => (
            <label key={name} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={picked.some((p) => p.toLowerCase() === name.toLowerCase())}
                onChange={(e) => {
                  const next = e.target.checked ? [...picked, name] : picked.filter((p) => p.toLowerCase() !== name.toLowerCase());
                  onChange(next.length ? next : "admins");
                }}
              />
              {name}
              {!groups?.some((g) => g.name.toLowerCase() === name.toLowerCase()) && groups && <span className="text-xs text-[var(--warn)]">(no such group)</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** POST one file as multipart `file`; the endpoint answers { url } or { error }. */
export async function uploadFile(endpoint: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(endpoint, { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (HTTP ${res.status})`);
  return data.url;
}

/** A URL field with a thumbnail, an upload button and a clear button. */
function ImageInput({ id, value, placeholder, upload, onChange }: { id: string; value: unknown; placeholder?: string; upload?: string; onChange: (v: FormValue) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const url = typeof value === "string" ? value : "";
  const pick = async (file: File | undefined) => {
    if (!file || !upload) return;
    setBusy(true);
    setError(undefined);
    try {
      onChange(await uploadFile(upload, file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="flex items-center gap-2">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-10 w-16 shrink-0 rounded-lg object-cover ring-1 ring-line" />
        )}
        <input id={id} value={url} placeholder={placeholder} onChange={(e) => onChange(e.target.value || undefined)} className={inputClass} />
        {upload && (
          <label className={`flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-track px-3 text-sm hover:bg-hover ${busy ? "pointer-events-none opacity-60" : ""}`}>
            <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="sr-only"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        )}
        {url && (
          <button type="button" onClick={() => onChange(undefined)} aria-label="Remove image" title="Remove image" className="shrink-0 rounded-lg p-2 text-muted hover:bg-hover hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {error && <p className="text-xs text-[var(--err)]">{error}</p>}
    </>
  );
}

/** Comma-separated strings. Keeps its own text so typing "a, " isn't normalised away mid-edit. */
function ListInput({ id, value, placeholder, onChange }: { id: string; value: unknown; placeholder?: string; onChange: (v: FormValue) => void }) {
  const [text, setText] = useState(Array.isArray(value) ? value.join(", ") : String(value ?? ""));
  return (
    <input
      id={id}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const items = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
        onChange(items.length ? items : undefined);
      }}
      className={inputClass}
    />
  );
}

/** Nested values edited as YAML; the last valid parse is kept while the text is invalid. */
function YamlInput({ id, value, placeholder, onChange }: { id: string; value: unknown; placeholder?: string; onChange: (v: FormValue) => void }) {
  const [text, setText] = useState(value === undefined ? "" : YAML.stringify(value).trimEnd());
  const [error, setError] = useState<string>();
  return (
    <>
      <textarea
        id={id}
        rows={Math.min(10, Math.max(3, text.split("\n").length + 1))}
        value={text}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = e.target.value.trim() ? YAML.parse(e.target.value) : undefined;
            setError(undefined);
            onChange(parsed ?? undefined);
          } catch (err) {
            setError((err as Error).message.split("\n")[0]);
          }
        }}
        className={`${inputClass} h-auto py-2 font-mono text-xs leading-relaxed`}
      />
      {error && <p className="text-xs text-[var(--err)]">{error}</p>}
    </>
  );
}
