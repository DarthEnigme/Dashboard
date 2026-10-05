"use client";

import { useState } from "react";
import YAML from "yaml";
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
