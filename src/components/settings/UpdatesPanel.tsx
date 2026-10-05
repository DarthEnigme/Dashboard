"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ArrowUpCircle, CheckCircle2, ExternalLink, History, Loader2, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { FullStatus } from "@/app/api/update/_shared";
import { Markdown } from "./Markdown";

const ago = (iso?: string) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

type Live = { phase: string; percent?: number; target?: string };

/**
 * Current and latest version, release notes, and one-click install. Installing hands over to a
 * helper container; this panel follows along over /api/events and notices the new build.
 */
export function UpdatesPanel() {
  const { data, mutate, error } = useSWR<FullStatus>("/api/update", fetcher);
  const [busy, setBusy] = useState<"check" | "apply">();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [live, setLive] = useState<Live>();
  const [newBuild, setNewBuild] = useState<string>();
  const [allNotes, setAllNotes] = useState(false);

  // Follow progress, and notice the restart (the stream reconnects to the new build).
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("update", (e) => setLive(JSON.parse((e as MessageEvent<string>).data) as Live));
    es.addEventListener("build", (e) => {
      const b = JSON.parse((e as MessageEvent<string>).data) as { id: string; version: string };
      if (b.id !== document.documentElement.dataset.build) setNewBuild(b.version);
    });
    return () => es.close();
  }, []);

  const phase = live?.phase ?? data?.progress.phase;
  const running = phase === "preparing" || phase === "pulling" || phase === "restarting";

  const check = async () => {
    setBusy("check");
    setMessage(undefined);
    try {
      const s = await sendJson<FullStatus>("/api/update/check", "POST");
      await mutate(s, { revalidate: false });
      setMessage(s.error ? { text: s.error, error: true } : { text: s.available ? `${s.latest?.version} is available` : "You're on the latest version" });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(undefined);
    }
  };

  const apply = async () => {
    setBusy("apply");
    setMessage(undefined);
    try {
      await sendJson("/api/update/apply", "POST", { version: data?.latest?.version });
      setLive({ phase: "preparing", target: data?.latest?.version });
      setConfirm(false);
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(undefined);
    }
  };

  if (error) return <p className="text-sm text-[var(--err)]">{(error as Error).message}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  const { current, latest, preflight } = data;
  const notes = latest?.notes?.trim();

  return (
    <div className="flex flex-col gap-4 border-t border-line pt-5" data-testid="updates-panel">
      {newBuild ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-chip p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-[var(--ok)]" />
          <span className="flex-1">Page is now running {newBuild}.</span>
          <button type="button" onClick={() => window.location.reload()} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 font-medium text-white">
            <RefreshCw className="h-4 w-4" /> Reload
          </button>
        </div>
      ) : running ? (
        <div role="status" className="flex flex-col gap-2 rounded-2xl bg-chip p-4 text-sm">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {phase === "pulling"
              ? `Downloading ${live?.target ?? data.progress.target ?? "the update"}… ${live?.percent ?? data.progress.percent ?? 0}%`
              : phase === "restarting"
                ? "Restarting with the new version. This page reconnects by itself (usually under a minute)."
                : "Preparing…"}
          </div>
          {phase === "pulling" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-track" role="progressbar" aria-label="Download" aria-valuenow={live?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${live?.percent ?? data.progress.percent ?? 0}%` }} />
            </div>
          )}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-chip p-4">
          <div className="text-xs text-muted">Running</div>
          <div className="text-xl font-semibold">{current.version}</div>
          <div className="text-xs text-muted">
            {current.commit ? `commit ${current.commit.slice(0, 7)}` : "local build"} · {data.channel} channel
          </div>
        </div>
        <div className="rounded-2xl bg-chip p-4">
          <div className="text-xs text-muted">Latest</div>
          <div className="flex items-center gap-2 text-xl font-semibold">
            {latest?.version ?? "–"}
            {data.available ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white">New</span>
            ) : latest ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" aria-label="Up to date" />
            ) : null}
          </div>
          <div className="text-xs text-muted">
            Checked {ago(data.checkedAt)}
            {data.repo ? ` · ${data.repo}` : ""}
          </div>
        </div>
      </div>

      {data.error && (
        <p className="flex items-center gap-1.5 text-sm text-[var(--warn)]">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {data.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={check} disabled={!!busy || running} className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2 text-sm hover:bg-hover disabled:opacity-50">
          {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check now
        </button>
        {data.available && preflight.canApply && !running && !newBuild && !confirm && (
          <button type="button" onClick={() => setConfirm(true)} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
            <ArrowUpCircle className="h-4 w-4" /> Update to {latest?.version}
          </button>
        )}
        {latest?.url && (
          <a href={latest.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-sm text-muted hover:text-fg">
            Release page <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {message && (
          <span role="status" className={`text-sm ${message.error ? "text-[var(--err)]" : "text-muted"}`}>
            {message.text}
          </span>
        )}
      </div>

      {confirm && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line p-4 text-sm">
          <p>
            Page downloads <code className="rounded bg-track px-1">{preflight.image}:{data.channel === "edge" ? "latest" : latest?.version}</code>, then replaces the{" "}
            <code className="rounded bg-track px-1">{preflight.container}</code> container with the same settings and volumes. It is unavailable for about a minute.
            If the new version doesn&apos;t start, the current one is put back automatically.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={apply} disabled={!!busy} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 font-medium text-white disabled:opacity-50">
              {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />} Update now
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="rounded-full px-3 py-1.5 hover:bg-hover">
              Cancel
            </button>
          </div>
        </div>
      )}

      {data.available && !preflight.canApply && (
        <div className="flex flex-col gap-2 rounded-2xl border border-line p-4 text-sm">
          <p className="text-muted">{preflight.reason}</p>
          <p>To update by hand:</p>
          <pre className="overflow-x-auto rounded-xl bg-track p-3 text-xs">
            {`# Docker Compose (in the folder with docker-compose.yml)
docker compose pull && docker compose up -d

# From source
git pull && npm ci && npm run build && npm start`}
          </pre>
        </div>
      )}

      {notes && (data.available || allNotes) && (
        <section aria-labelledby="notes-title" className="flex flex-col gap-2">
          <h3 id="notes-title" className="text-sm font-semibold">
            What&apos;s new in {latest?.version}
          </h3>
          <div className={`relative overflow-hidden ${allNotes ? "" : "max-h-56"}`}>
            <Markdown text={notes} />
            {!allNotes && notes.length > 600 && <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--dialog)] to-transparent" />}
          </div>
          {!allNotes && notes.length > 600 && (
            <button type="button" onClick={() => setAllNotes(true)} className="w-fit text-sm text-accent hover:underline">
              Show all
            </button>
          )}
        </section>
      )}

      {data.history.length > 0 && (
        <section aria-labelledby="history-title" className="flex flex-col gap-2">
          <h3 id="history-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="h-4 w-4" /> History
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {data.history.map((h) => (
              <li key={h.at} className="flex flex-wrap items-center gap-2 rounded-xl bg-row px-3 py-1.5">
                {h.result === "updated" ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" />
                ) : h.result === "rolled back" ? (
                  <RotateCcw className="h-4 w-4 text-[var(--warn)]" />
                ) : (
                  <XCircle className="h-4 w-4 text-[var(--err)]" />
                )}
                <span>
                  {h.from} → {h.to}: {h.result}
                </span>
                <span className="text-xs text-muted">
                  {new Date(h.at).toLocaleString()}
                  {h.user ? ` · ${h.user}` : ""}
                </span>
                {h.detail && <span className="w-full text-xs text-muted">{h.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
