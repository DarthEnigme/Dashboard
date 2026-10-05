"use client";

import { useState } from "react";
import { FileUp, TriangleAlert } from "lucide-react";
import { sendJson } from "@/lib/fetcher";
import { Dialog } from "./Dialog";
import { inputClass } from "./FieldInput";

const NAMES = ["services", "bookmarks", "settings", "widgets", "docker"] as const;
type Files = Partial<Record<(typeof NAMES)[number], string>>;

interface Summary {
  services: number;
  groups: number;
  bookmarks: number;
  widgets: number;
  warnings: string[];
}

/** Pick (or paste) Homepage YAML files, preview what converts, then replace or merge. */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [files, setFiles] = useState<Files>({});
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const pick = async (list: FileList | null) => {
    const next: Files = { ...files };
    for (const f of Array.from(list ?? [])) {
      const name = NAMES.find((n) => f.name.replace(/\.ya?ml$/, "") === n);
      if (name) next[name] = await f.text();
    }
    setFiles(next);
    setSummary(undefined);
    preview(next);
  };

  const preview = async (f = files) => {
    setError(undefined);
    try {
      setSummary(await sendJson<Summary>("/api/config/import", "POST", { files: f }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    if (!summary) return preview();
    setBusy(true);
    try {
      await sendJson("/api/config/import", "POST", { files, mode, commit: true });
      onImported();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loaded = NAMES.filter((n) => files[n]?.trim());

  return (
    <Dialog title="Import from Homepage" onClose={onClose} onSubmit={submit} submitLabel={summary ? "Import" : "Preview"} error={error} busy={busy}>
      <p className="text-sm text-muted">
        Choose the YAML files from your gethomepage.dev <code>config</code> folder (services, bookmarks, settings, widgets, docker).
      </p>
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-full bg-chip px-4 py-2 text-sm hover:bg-hover">
        <FileUp className="h-4 w-4" /> Choose files
        <input type="file" multiple accept=".yaml,.yml" className="sr-only" onChange={(e) => pick(e.target.files)} />
      </label>
      {loaded.length > 0 && <p className="text-xs text-muted">Loaded: {loaded.map((n) => `${n}.yaml`).join(", ")}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">…or paste services.yaml</summary>
        <textarea
          aria-label="services.yaml"
          rows={6}
          value={files.services ?? ""}
          onChange={(e) => {
            setFiles({ ...files, services: e.target.value });
            setSummary(undefined);
          }}
          className={`${inputClass} mt-2 h-auto py-2 font-mono text-xs`}
        />
      </details>

      {summary && (
        <div className="flex flex-col gap-3 rounded-xl bg-chip p-3 text-sm">
          <p>
            {summary.services} services in {summary.groups} groups, {summary.bookmarks} bookmark groups, {summary.widgets} info widgets.
          </p>
          {summary.warnings.length > 0 && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs text-[var(--warn)]">
              {summary.warnings.map((w) => (
                <li key={w} className="flex gap-1.5">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                </li>
              ))}
            </ul>
          )}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-muted">How to import</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} className="accent-[var(--accent)]" />
              Merge: keep my groups, add the new ones
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-[var(--accent)]" />
              Replace my services, bookmarks and info bar
            </label>
            <p className="text-xs text-muted">Settings are merged either way. Every change can be undone from History.</p>
          </fieldset>
        </div>
      )}
    </Dialog>
  );
}
