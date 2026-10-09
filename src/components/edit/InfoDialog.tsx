"use client";

import { useState } from "react";
import { infoFields } from "@/info/fields";
import { Dialog } from "./Dialog";
import { FieldInput, inputClass } from "./FieldInput";
import { visibleField } from "./fields";
import { useT } from "@/i18n/client";

export type RawInfoWidget = { type: string; [k: string]: unknown };

interface Props {
  initial?: RawInfoWidget;
  onClose: () => void;
  onSave: (w: RawInfoWidget) => Promise<void>;
}

export function InfoDialog({ initial, onClose, onSave }: Props) {
  const t = useT();
  const [w, setW] = useState<RawInfoWidget>(initial ?? { type: "greeting" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const spec = infoFields[w.type];

  const submit = async () => {
    const missing = spec?.fields.find((f) => f.required && (w[f.key] ?? "") === "");
    if (missing) return setError(t("{field} is required", { field: t(missing.label) }));
    setBusy(true);
    try {
      await onSave(w);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={initial ? t("Edit {name}", { name: spec?.label ?? w.type }) : t("Add to info bar")} onClose={onClose} onSubmit={submit} error={error} busy={busy}>
      {!initial && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-info-type" className="text-xs font-medium text-muted">{t("Widget")}</label>
          <select
            id="f-info-type"
            value={w.type}
            onChange={(e) => setW({ type: e.target.value, _key: w._key })}
            className={inputClass}
          >
            {Object.entries(infoFields).map(([type, s]) => (
              <option key={type} value={type}>{s.label}</option>
            ))}
          </select>
        </div>
      )}
      {spec?.fields.map((f, i) => (
        <FieldInput
          key={`${w.type}-${f.key}`}
          spec={f}
          autoFocus={!!initial && i === 0}
          value={w[f.key]}
          onChange={(v) => setW((cur) => ({ ...cur, [f.key]: v }))}
        />
      ))}
      <FieldInput spec={visibleField} value={w.visible} onChange={(v) => setW((cur) => ({ ...cur, visible: v }))} />
      {w.type === "weather" && (
        <p className="text-xs text-muted/80">
          {t("Find coordinates by right-clicking a place in most map apps. Forecasts come from Open-Meteo.")}
        </p>
      )}
      {w.type === "markets" && (
        <p className="text-xs text-muted/80">{t("Stock prices use Yahoo Finance’s unofficial API and may be delayed.")}</p>
      )}
    </Dialog>
  );
}
