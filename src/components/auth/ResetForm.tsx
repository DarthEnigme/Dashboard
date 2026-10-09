"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { inputClass } from "../edit/FieldInput";
import { useT } from "@/i18n/client";

export function ResetForm({ title, token }: { title: string; token: string }) {
  const t = useT();
  const [who, setWho] = useState<{ username: string; name: string | null }>();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetcher<{ username: string; name: string | null }>(`/api/auth/reset?token=${encodeURIComponent(token)}`)
      .then(setWho)
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(t("The passwords don't match"));
    setBusy(true);
    setError(undefined);
    try {
      await sendJson("/api/auth/reset", "POST", { token, password });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass w-full max-w-sm rounded-3xl p-7">
      <h1 className="text-2xl font-bold tracking-tight">{t("Set your password")}</h1>
      <p className="mb-6 text-sm text-muted">
        {t("for")}{" "}{title}
        {who && (
          <>
            {" "}
            · {who.name || who.username} ({who.username})
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">
          {error}
        </p>
      )}
      {done ? (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-[var(--ok)]" /> {t("Password set. Sign in with it now.")}
          </p>
          <a href="/login" className="flex h-10 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-white hover:brightness-110">
            {t("Sign in")}
          </a>
        </div>
      ) : (
        who && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <input type="text" autoComplete="username" value={who.username} readOnly hidden />
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              {t("New password (8+ characters)")}
              <input type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              {t("Repeat it")}
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
            </label>
            <button
              type="submit"
              disabled={busy || password.length < 8}
              className="mt-2 flex h-10 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("Set password")}
            </button>
          </form>
        )
      )}
    </div>
  );
}
