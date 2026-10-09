"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { ApiToken } from "@/lib/auth/tokens";
import { dateTime } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { DeleteButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";

/** Settings → Monitoring & alerts: tokens for Prometheus (or anything) to read /api/export/metrics. */
export function TokensPanel() {
  const t = useT();
  const { data, mutate } = useSWR<ApiToken[]>("/api/tokens", fetcher);
  const [name, setName] = useState("Prometheus");
  const [fresh, setFresh] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const create = async () => {
    setError(undefined);
    try {
      const r = await sendJson<{ token: string; list: ApiToken[] }>("/api/tokens", "POST", { name });
      setFresh(r.token);
      setCopied(false);
      await mutate(r.list, { revalidate: false });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5" id="tokens">
      <h3 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Prometheus export and API tokens")}</h3>
      <p className="-mt-1 text-xs text-muted">
        {t("Prometheus can scrape every service's status, latency and uptime, and the recorded widget values, from")}{" "}
        <code className="rounded bg-chip px-1">{origin}/api/export/metrics</code>. {t("It needs one of these tokens.")}
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Token name")} className={`${inputBase} w-56`} />
        <button type="submit" className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("Create token")}
        </button>
      </form>
      {error && <p className="text-sm text-[var(--err)]">{error}</p>}
      {fresh && (
        <div className="flex flex-col gap-2 rounded-2xl bg-chip p-3 text-sm" role="status">
          <p>{t("Copy it now: it won't be shown again.")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-track px-2 py-1 font-mono text-xs" data-token>
              {fresh}
            </code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(fresh).catch(() => {});
                setCopied(true);
              }}
              className="flex items-center gap-1 rounded-full bg-track px-3 py-1 text-xs hover:bg-hover"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? t("Copied") : t("Copy")}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-track p-2 text-[11px] leading-relaxed">{`scrape_configs:
  - job_name: page
    metrics_path: /api/export/metrics
    scheme: ${origin.startsWith("https") ? "https" : "http"}
    authorization:
      credentials: ${fresh}
    static_configs:
      - targets: ["${origin.replace(/^https?:\/\//, "")}"]`}</pre>
        </div>
      )}
      {!!data?.length && (
        <ul className="flex flex-col divide-y divide-line/60 rounded-2xl ring-1 ring-line" aria-label={t("API tokens")}>
          {data.map((tok) => (
            <li key={tok.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <KeyRound className="h-4 w-4 shrink-0 text-muted" />
              <span className="mr-auto min-w-0">
                <span className="block truncate font-medium">{tok.name}</span>
                <span className="block truncate text-xs text-muted">
                  <code>{tok.prefix}…</code> · {tok.owner} · {tok.last_used ? t("used {when}", { when: dateTime(tok.last_used) }) : t("never used")}
                </span>
              </span>
              <DeleteButton label={t("Revoke {name}", { name: tok.name })} onConfirm={async () => void mutate(await sendJson<ApiToken[]>(`/api/tokens?id=${tok.id}`, "DELETE"), { revalidate: false })} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
