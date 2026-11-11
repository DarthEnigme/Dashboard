"use client";

import { useState } from "react";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { Dialog } from "../edit/Dialog";
import { inputClass } from "../edit/FieldInput";
import type { Naming } from "./useTaskBoard";

const TITLES: Record<Naming["what"], [create: string, rename: string]> = {
  board: [msg("New board"), msg("Rename board")],
  column: [msg("New column"), msg("Rename column")],
  lane: [msg("New lane"), msg("Rename lane")],
};

/** Names a new board, column or lane, or renames one. */
export function NameDialog({ naming, onSave, onClose }: { naming: Naming; onSave: (n: Naming) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(naming.name);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onSave({ ...naming, name });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={t(TITLES[naming.what][naming.id === undefined ? 0 : 1])} onClose={onClose} onSubmit={submit} error={error} busy={busy}>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        {t("Name")}
        <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
    </Dialog>
  );
}
