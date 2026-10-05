"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
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
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const passwordLogin = methods.local || methods.ldap;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await sendJson("/api/auth", "POST", { username, password });
      window.location.href = "/";
    } catch (err) {
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

      {passwordLogin && (
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

      {methods.providers.length > 0 && (
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
