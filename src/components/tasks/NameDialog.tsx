"use client";

import { useState } from "react";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { Dialog, useDialogRun } from "../edit/Dialog";
import { inputClass, labelClass } from "../edit/FieldInput";
import type { Naming } from "./model";

const TITLES: Record<Naming["what"], [create: string, rename: string]> = {
  board: [msg("New board"), msg("Rename board")],
  column: [msg("New column"), msg("Rename column")],
  lane: [msg("New lane"), msg("Rename lane")],
};

/** Names a new board, column or lane, or renames one. */
export function NameDialog({ naming, onSave, onClose }: { naming: Naming; onSave: (n: Naming) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(naming.name);
  const { run, busy, error } = useDialogRun(onClose);
  const submit = () => run(() => onSave({ ...naming, name }));

  return (
    <Dialog title={t(TITLES[naming.what][naming.id === undefined ? 0 : 1])} onClose={onClose} onSubmit={submit} error={error} busy={busy}>
      <label className={labelClass}>
        {t("Name")}
        <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
    </Dialog>
  );
}
