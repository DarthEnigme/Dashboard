"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import { sendJson } from "@/lib/fetcher";

export function TestAlertButton() {
  const [state, setState] = useState<{ busy?: boolean; msg?: string; ok?: boolean }>({});
  const send = async () => {
    setState({ busy: true });
    try {
      await sendJson("/api/alerts/test", "POST");
      setState({ ok: true, msg: "Test alert sent." });
    } catch (e) {
      setState({ ok: false, msg: (e as Error).message });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 text-sm">
      <button
        type="button"
        onClick={send}
        disabled={state.busy}
        className="flex items-center gap-1.5 rounded-full bg-track px-3 py-1.5 hover:bg-hover disabled:opacity-50"
      >
        <BellRing className="h-4 w-4" /> Send test alert
      </button>
      <span className={`text-xs ${state.ok === false ? "text-[var(--err)]" : "text-muted"}`}>
        {state.msg ?? "Uses the saved settings: save first if you changed the webhooks."}
      </span>
    </div>
  );
}
