"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import { sendJson } from "@/lib/fetcher";
import { inputBase } from "../edit/FieldInput";
import { useT } from "@/i18n/client";

export function TestAlertButton() {
  const t = useT();
  const [state, setState] = useState<{ busy?: boolean; msg?: string; ok?: boolean }>({});
  const [sample, setSample] = useState("");
  const send = async () => {
    setState({ busy: true });
    try {
      await sendJson("/api/alerts/test", "POST", sample ? { sample } : {});
      setState({ ok: true, msg: sample ? t("Sample “{name}” alert sent.", { name: sample }) : t("Test alert sent.") });
    } catch (e) {
      setState({ ok: false, msg: (e as Error).message });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
      <select aria-label={t("Alert to send")} value={sample} onChange={(e) => setSample(e.target.value)} className={`${inputBase} w-44`}>
        <option value="">{t("Test message")}</option>
        <option value="down">{t("Sample: service down")}</option>
        <option value="up">{t("Sample: service back up")}</option>
      </select>
      <button
        type="button"
        onClick={send}
        disabled={state.busy}
        className="flex items-center gap-1.5 rounded-full bg-track px-3 py-1.5 hover:bg-hover disabled:opacity-50"
      >
        <BellRing className="h-4 w-4" /> {t("Send")}
      </button>
      <span className={`text-xs ${state.ok === false ? "text-[var(--err)]" : "text-muted"}`}>
        {state.msg ?? t("Uses the saved settings: save first if you changed the channels or templates.")}
      </span>
    </div>
  );
}
