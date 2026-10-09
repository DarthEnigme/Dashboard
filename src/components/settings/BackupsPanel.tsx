"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { BackupInfo, BackupStatus } from "@/lib/backup";
import { DeleteButton } from "../edit/controls";
import { dateTime } from "@/i18n/format";
import { useT } from "@/i18n/client";

interface State {
  backups: BackupInfo[];
  last: BackupStatus | null;
  dir: string;
  enabled: boolean;
  time: string;
  keep: number;
}

const size = (n: number) => (n > 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (ms: number | string) => dateTime(ms);

/** Settings → Backup & history: the nightly backups, Back up now, download and delete. */
export function BackupsPanel() {
  const t = useT();
  const { data, mutate } = useSWR<State>("/api/backups", fetcher);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const backupNow = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await mutate(await sendJson<State>("/api/backups", "POST"), { revalidate: false });
    } catch (e) {
      setError((e as Error).message);
      await mutate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5" id="backups">
      <h3 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Backups")}</h3>
      <p className="-mt-1 text-xs text-muted">
        {data?.enabled ? t("Every night at {time}, keeping the newest {n}.", { time: data.time, n: data.keep }) : t("Nightly backups are off.")} {t("Each one holds the config files, the database, uploads and the secret key, so keep the downloads somewhere safe. Saved in")}{" "}<code className="rounded bg-chip px-1">{data?.dir ?? "…"}</code>.
      </p>
      {data?.last && (
        <p className={`flex items-center gap-1.5 text-sm ${data.last.ok ? "text-muted" : "text-[var(--err)]"}`} role={data.last.ok ? undefined : "alert"}>
          {data.last.ok ? <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" /> : <AlertTriangle className="h-4 w-4" />}
          {t("Last backup")}{" "}{when(data.last.at)} ({data.last.by}){data.last.ok ? `: ${size(data.last.size ?? 0)}` : ` ${t("failed: {error}", { error: data.last.error ?? "" })}`}
        </p>
      )}
      <div>
        <button
          type="button"
          onClick={backupNow}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
        >
          <DatabaseBackup className="h-4 w-4" /> {busy ? t("Backing up…") : t("Back up now")}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--err)]">{error}</p>}
      {!!data?.backups.length && (
        <ul className="flex flex-col divide-y divide-line/60 rounded-2xl ring-1 ring-line" aria-label={t("Backups")}>
          {data.backups.map((b) => (
            <li key={b.name} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="mr-auto min-w-0">
                <span className="block truncate font-medium">{when(b.at)}</span>
                <span className="block truncate text-xs text-muted">
                  {b.name} · {size(b.size)}
                </span>
              </span>
              <a href={`/api/backups/${encodeURIComponent(b.name)}`} download className="flex items-center gap-1 rounded-full px-3 py-1 text-xs hover:bg-hover" aria-label={t("Download {name}", { name: b.name })}>
                <Download className="h-3.5 w-3.5" /> {t("Download")}
              </a>
              <DeleteButton
                label={t("Delete {name}", { name: b.name })}
                onConfirm={async () => {
                  await sendJson(`/api/backups/${encodeURIComponent(b.name)}`, "DELETE");
                  await mutate();
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {data && !data.backups.length && <p className="text-sm text-muted">{t("No backups yet.")}</p>}
    </div>
  );
}
