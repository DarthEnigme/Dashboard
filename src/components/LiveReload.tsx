"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { RefreshCw, Sparkles } from "lucide-react";
import { lastLocalConfigWrite } from "@/lib/fetcher";
import { useT } from "@/i18n/client";

const SELF_ECHO_MS = 3000;
const REFRESH_DEBOUNCE_MS = 300;

/**
 * Listens to /api/events and re-renders the page when a config file changes on the server.
 * `version` is the config version the page was rendered with: the stream sends the current one on
 * every (re)connect, so changes made while disconnected are caught too.
 * While `paused` (e.g. the editor is open with its own copy of the config) it offers a reload instead.
 * It also notices when Page itself was updated (a new build) and offers a full reload for the new code;
 * a tab in the background just reloads.
 */
export function LiveReload({ paused = false, onReload, version }: { paused?: boolean; onReload?: () => void; version?: string }) {
  const t = useT();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [stale, setStale] = useState(false);
  const [updated, setUpdated] = useState<string>();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const versionRef = useRef(version);
  versionRef.current = version;

  const apply = () => {
    setStale(false);
    onReload?.();
    router.refresh();
    void mutate((key) => typeof key === "string" && /^\/api\/(info|widget|ping)\b/.test(key));
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;
    let closed = false;

    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => (backoff = 1000);
      const changed = () => {
        if (Date.now() - lastLocalConfigWrite() < SELF_ECHO_MS) return;
        if (pausedRef.current) return setStale(true);
        clearTimeout(debounce);
        debounce = setTimeout(() => applyRef.current(), REFRESH_DEBOUNCE_MS);
      };
      es.addEventListener("config", changed);
      es.addEventListener("version", (e) => {
        if (versionRef.current && (e as MessageEvent<string>).data !== versionRef.current) changed();
      });
      es.addEventListener("build", (e) => {
        const b = JSON.parse((e as MessageEvent<string>).data) as { id: string; version: string };
        const mine = document.documentElement.dataset.build;
        if (!mine || b.id === mine) return;
        if (document.visibilityState === "hidden" && !pausedRef.current) window.location.reload();
        else setUpdated(b.version);
      });
      es.onerror = () => {
        // EventSource retries on its own unless the server refused us; then back off and reconnect.
        if (es?.readyState !== EventSource.CLOSED || closed) return;
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 60_000);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      clearTimeout(retry);
      clearTimeout(debounce);
    };
  }, []);

  if (updated) {
    return (
      <div role="status" className="glass fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
        <Sparkles className="h-4 w-4 text-accent" />
        <span>{t("Page was updated to")}{" "}{updated}.</span>
        <button type="button" onClick={() => window.location.reload()} className="glass-interactive flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1 font-medium text-white">
          <RefreshCw className="h-3.5 w-3.5" /> {t("Reload")}
        </button>
      </div>
    );
  }
  if (!stale) return null;
  return (
    <div role="status" className="glass fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
      <span>{t("Config changed on disk.")}</span>
      <button type="button" onClick={apply} className="glass-interactive flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1 font-medium text-white">
        <RefreshCw className="h-3.5 w-3.5" /> {t("Reload")}
      </button>
      <button type="button" onClick={() => setStale(false)} className="text-muted hover:text-[var(--fg)]">
        {t("Dismiss")}
      </button>
    </div>
  );
}
