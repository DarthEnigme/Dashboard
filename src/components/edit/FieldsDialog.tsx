"use client";

import { useState, type ReactNode } from "react";
import type { FieldSpec } from "@/integrations/fields";
import { Dialog } from "./Dialog";
import { useT } from "@/i18n/client";
import { FieldInput, type FormValue } from "./FieldInput";

type Obj = Record<string, unknown>;

/** Read "a.b" from an object. */
export function getPath(o: Obj, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Obj)[k] : undefined), o);
}

/** Immutably set "a.b" on an object. */
export function setPath(o: Obj, path: string, value: unknown): Obj {
  const [head, ...rest] = path.split(".");
  if (!rest.length) return { ...o, [head]: value };
  const child = (o[head] && typeof o[head] === "object" ? o[head] : {}) as Obj;
  return { ...o, [head]: setPath(child, rest.join("."), value) };
}

interface Props {
  title: string;
  fields: FieldSpec[];
  initial: Obj;
  onClose: () => void;
  onSave: (value: Obj) => Promise<void>;
  /** Rendered after the fields (e.g. a test button). */
  extra?: ReactNode;
}

/** Generic form over dot-path fields; unknown keys on `initial` are preserved. */
export function FieldsDialog({ title, fields, initial, onClose, onSave, extra }: Props) {
  const t = useT();
  const [value, setValue] = useState<Obj>(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const missing = fields.find((f) => f.required && (getPath(value, f.key) ?? "") === "");
    if (missing) return setError(t("{field} is required", { field: t(missing.label) }));
    setBusy(true);
    try {
      await onSave(value);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose} onSubmit={submit} error={error} busy={busy}>
      {fields.map((f, i) => (
        <FieldInput
          key={f.key}
          spec={f}
          autoFocus={i === 0}
          value={getPath(value, f.key) as FormValue}
          onChange={(v) => setValue((cur) => setPath(cur, f.key, v))}
        />
      ))}
      {extra}
    </Dialog>
  );
}
