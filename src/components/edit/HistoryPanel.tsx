"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { DiffPart, Version } from "@/lib/config/history";
import { useT } from "@/i18n/client";

const FILES = ["all", "services", "settings", "bookmarks", "widgets"] as const;

const when = (ts: number) =>
  new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Config snapshots: each one is a file as it was just before someone changed it. */
export function HistoryPanel({ onRestored }: { onRestored: () => void }) {
  const t = useT();
  const [file, setFile] = useState<(typeof FILES)[number]>("all");
  const [versions, setVersions] = useState<Version[]>();
  const [selected, setSelected] = useState<number>();
  const [detail, setDetail] = useState<{ diff: DiffPart[] } & Version>();
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>();

  const load = async () => {
    const list = await fetcher<Version[]>(`/api/config/history${file === "all" ? "" : `?file=${file}`}`);
    setVersions(list);
    setSelected((s) => (s && list.some((v) => v.id === s) ? s : list[0]?.id));
  };
  useEffect(() => {
    load().catch((e) => setMsg({ text: (e as Error).message, error: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  useEffect(() => {
    setDetail(undefined);
    if (selected) fetcher<typeof detail>(`/api/config/history/${selected}`).then(setDetail, () => {});
  }, [selected]);

  const restore = async () => {
    if (!detail) return;
    try {
      await sendJson(`/api/config/history/${detail.id}`, "POST");
      setMsg({ text: t("Restored {file}.yaml as of {when}.", { file: detail.file, when: when(detail.ts) }) });
      await load();
      onRestored();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };

  const changes = detail?.diff.filter((d) => d.kind !== "same").length ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Config history")}</h2>
        <div className="flex rounded-full bg-chip p-1 text-sm">
          {FILES.map((f) => (
            <button
              key={f}
              onClick={() => setFile(f)}
              className={`rounded-full px-3 py-1 ${file === f ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {msg && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm ${msg.error ? "bg-[var(--err)]/15 text-[var(--err)]" : "bg-chip"}`}>
          {msg.text}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
        <ol className="glass flex max-h-[32rem] flex-col gap-1 overflow-y-auto rounded-2xl p-2">
          {versions?.length === 0 && <li className="p-3 text-sm text-muted">{t("No changes recorded yet.")}</li>}
          {versions?.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => setSelected(v.id)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${selected === v.id ? "bg-accent/20" : "hover:bg-hover"}`}
              >
                <div className="font-medium">{v.file}{t(".yaml")}</div>
                <div className="text-xs text-muted">
                  {t("before")}{" "}{v.user ?? "someone"}{t("’s change ·")}{" "}{when(v.ts)}
                </div>
              </button>
            </li>
          ))}
        </ol>
        <div className="glass min-w-0 rounded-2xl p-4">
          {!detail ? (
            <p className="text-sm text-muted">{t("Select a version to see what restoring it would change.")}</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">
                  {t("Restoring {file}.yaml from {when}:", { file: detail.file, when: when(detail.ts) })} {changes ? t.plural(changes, "{n} changed block", "{n} changed blocks") : t("identical to now")}
                </p>
                <button
                  onClick={restore}
                  disabled={!changes}
                  className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
                >
                  <RotateCcw className="h-4 w-4" /> {t("Restore")}
                </button>
              </div>
              <pre className="max-h-[28rem] overflow-auto rounded-xl bg-chip p-3 font-mono text-xs leading-relaxed">
                {detail.diff.map((d, i) => (
                  <span
                    key={i}
                    className={
                      d.kind === "add"
                        ? "block bg-[var(--ok)]/15 text-[var(--ok)]"
                        : d.kind === "remove"
                          ? "block bg-[var(--err)]/15 text-[var(--err)]"
                          : "block text-muted"
                    }
                  >
                    {d.text.replace(/\n$/, "").split("\n").map((l) => `${d.kind === "add" ? "+ " : d.kind === "remove" ? "- " : "  "}${l}`).join("\n")}
                  </span>
                ))}
              </pre>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
