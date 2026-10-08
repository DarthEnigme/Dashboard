"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { sendJson } from "@/lib/fetcher";
import type { ClientAuth } from "@/lib/auth";
import { Icon } from "../Icon";
import { inputClass } from "../edit/FieldInput";

const providerIcon = (type: string) => (type === "google" ? "si-google" : type === "github" ? "si-github" : undefined);

interface Props {
  title: string;
  methods: ClientAuth["methods"];
  error?: string;
  canGoBack: boolean;
}

export function LoginForm({ title, methods, error: initialError, canGoBack }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  // Second step when the account has two-factor sign-in.
  const [ticket, setTicket] = useState<string>();
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const passwordLogin = methods.local || methods.ldap;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (ticket) {
        await sendJson("/api/auth/2fa", "POST", { ticket, code });
      } else {
        const r = await sendJson<{ twoFactor?: boolean; ticket?: string }>("/api/auth", "POST", { username, password, remember });
        if (r.twoFactor && r.ticket) {
          setTicket(r.ticket);
          setBusy(false);
          return;
        }
      }
      window.location.href = "/";
    } catch (err) {
      if (ticket && /took too long|again/i.test((err as Error).message)) setTicket(undefined);
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="glass w-full max-w-sm rounded-3xl p-7">
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mb-6 text-sm text-muted">to {title}</p>

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">
          {error}
        </p>
      )}

      {ticket && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 shrink-0 text-accent" /> Enter the code from your authenticator app.
          </p>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Code
            <input
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputClass} text-center font-mono text-lg tracking-[0.3em]`}
            />
          </label>
          <p className="text-xs text-muted">Lost your phone? Enter one of your recovery codes instead.</p>
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="mt-2 flex h-10 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify
          </button>
          <button type="button" onClick={() => (setTicket(undefined), setCode(""))} className="text-sm text-muted hover:text-fg">
            Use another account
          </button>
        </form>
      )}

      {passwordLogin && !ticket && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Username
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Keep me signed in for 30 days
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-2 flex h-10 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </button>
        </form>
      )}

      {methods.providers.length > 0 && !ticket && (
        <>
          {passwordLogin && (
            <div className="my-5 flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-track" /> or <span className="h-px flex-1 bg-track" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            {methods.providers.map((p) => (
              <a
                key={p.id}
                href={`/api/auth/oauth/${p.id}/start`}
                className="flex h-10 items-center justify-center gap-2.5 rounded-xl border border-line bg-chip text-sm font-medium transition hover:bg-hover"
              >
                {providerIcon(p.type) ? <Icon icon={providerIcon(p.type)} name={p.label} size={18} /> : <KeyRound className="h-4 w-4" />}
                Continue with {p.label}
              </a>
            ))}
          </div>
        </>
      )}

      {!passwordLogin && !methods.providers.length && (
        <p className="text-sm text-muted">No login method is enabled. Configure one under auth: in settings.yaml.</p>
      )}

      {canGoBack && (
        <a href="/" className="mt-6 flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </a>
      )}
    </div>
  );
}
