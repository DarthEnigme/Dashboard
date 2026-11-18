"use client";

import { useState } from "react";
import useSWR from "swr";
import { Bot, Check, Copy, KeyRound } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { ApiToken } from "@/lib/auth/tokens";
import { dateTime } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Dialog } from "../edit/Dialog";
import { DeleteButton } from "../edit/controls";
import { inputClass, labelClass } from "../edit/FieldInput";

const MINE = "/api/tokens?mine=1";

/** Text to copy, with a button that copies it. */
function CopyBox({ text, label, wrap }: { text: string; label: string; wrap?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <code aria-label={label} className={`min-w-0 flex-1 rounded-lg bg-track px-2 py-1.5 font-mono text-xs ${wrap ? "break-all whitespace-pre-wrap" : "truncate"}`}>
        {text}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => {});
          setCopied(true);
        }}
        className="flex shrink-0 items-center gap-1 rounded-full bg-track px-3 py-1 text-xs hover:bg-hover"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? t("Copied") : t("Copy")}
      </button>
    </div>
  );
}

/**
 * Lets Claude manage your boards: makes a `tasks` token (yours, shown once) and gives the command
 * that adds the board's MCP server to Claude Code. Lists your tokens, to revoke one.
 */
function ConnectDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { data, mutate } = useSWR<ApiToken[]>(MINE, fetcher);
  const [name, setName] = useState("Claude");
  const [fresh, setFresh] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const endpoint = `${origin}/api/mcp`;
  const mine = (data ?? []).filter((x) => x.scope === "tasks");

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await sendJson<{ token: string; list: ApiToken[] }>("/api/tokens", "POST", { name, scope: "tasks" });
      setFresh(r.token);
      await mutate(r.list, { revalidate: false });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("Connect Claude")} onClose={onClose} onSubmit={fresh ? onClose : create} submitLabel={fresh ? t("Done") : t("Create token")} error={error} busy={busy}>
      <p className="text-sm text-muted">{t("Claude can read and change your task boards: add tasks, move them, tick them off. It sees only your boards, and only while its token is valid.")}</p>
      {!fresh && (
        <div className="flex flex-col gap-2 rounded-2xl bg-chip p-3 text-sm">
          <p>{t("claude.ai (web and phone): in Settings → Connectors, add a custom connector with this URL, then approve it here. No token needed. This address must be reachable from the internet over HTTPS.")}</p>
          <CopyBox text={endpoint} label={t("Connector URL")} />
          <p className="text-xs text-muted">{t("Claude Code: create a token below.")}</p>
        </div>
      )}
      {fresh ? (
        <div className="flex flex-col gap-3 text-sm" role="status">
          <p>{t("Copy it now: it won't be shown again.")}</p>
          <CopyBox text={fresh} label={t("Token")} />
          <p>{t("In a terminal, add it to Claude Code:")}</p>
          <CopyBox wrap label={t("Command")} text={`claude mcp add --transport http nanodash ${endpoint} --header "Authorization: Bearer ${fresh}"`} />
          <p className="text-xs text-muted">{t("Other MCP clients: the server is {url}, with the token as a bearer token.", { url: endpoint })}</p>
        </div>
      ) : (
        <label className={labelClass}>
          {t("Token name")}
          <input autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
      )}
      {mine.length > 0 && (
        <ul className="flex flex-col divide-y divide-line/60 rounded-2xl ring-1 ring-line" aria-label={t("Your Claude tokens")}>
          {mine.map((tok) => (
            <li key={tok.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <KeyRound className="h-4 w-4 shrink-0 text-muted" />
              <span className="mr-auto min-w-0">
                <span className="block truncate font-medium">{tok.name}</span>
                <span className="block truncate text-xs text-muted">
                  <code>{tok.prefix}…</code> · {tok.last_used ? t("used {when}", { when: dateTime(tok.last_used) }) : t("never used")}
                </span>
              </span>
              <DeleteButton label={t("Revoke {name}", { name: tok.name })} onConfirm={async () => void mutate(await sendJson<ApiToken[]>(`/api/tokens?id=${tok.id}&mine=1`, "DELETE"), { revalidate: false })} />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/** The Tasks header's button for it. */
export function ConnectClaude() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t("Connect Claude")} title={t("Connect Claude")} className="rounded-full p-2 text-muted hover:bg-hover hover:text-fg">
        <Bot className="h-5 w-5" />
      </button>
      {open && <ConnectDialog onClose={() => setOpen(false)} />}
    </>
  );
}
