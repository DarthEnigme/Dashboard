"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Copy, Laptop, LogOut, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { inputClass } from "../edit/FieldInput";

interface SessionInfo {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeen: number;
  ip: string | null;
  userAgent: string | null;
  method: string | null;
}

type Setup = { setup: string; secret: string; qr: string; url: string };

/** "Firefox on Windows" from a user agent, good enough to recognise your own devices. */
export function deviceName(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Two-factor sign-in and where you are signed in. Opened from the account menu. */
export function SecurityDialog({ onClose }: { onClose: () => void }) {
  const { data: tf, mutate: reloadTf } = useSWR<{ enabled: boolean; recoveryCodesLeft: number }>("/api/profile/2fa", fetcher);
  const { data: sessions, mutate: reloadSessions } = useSWR<SessionInfo[]>("/api/profile/sessions", fetcher);
  const [setup, setSetup] = useState<Setup>();
  const [codes, setCodes] = useState<string[]>();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tfa = (body: Record<string, unknown>) => sendJson<Record<string, unknown>>("/api/profile/2fa", "POST", body);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Security">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="glass glass-lens relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-5 overflow-y-auto rounded-3xl p-6" style={{ background: "var(--dialog)" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Security</h2>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-sm text-muted hover:bg-hover hover:text-fg">
            Done
          </button>
        </div>
        {error && <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">{error}</p>}

        <section className="flex flex-col gap-3" aria-labelledby="tfa-title">
          <h3 id="tfa-title" className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4 text-accent" /> Two-factor sign-in
          </h3>
          {codes ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone. They won&apos;t be shown again.
              </p>
              <pre className="grid grid-cols-2 gap-1 rounded-xl bg-chip p-3 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</pre>
              <div className="flex gap-2">
                <button onClick={() => navigator.clipboard?.writeText(codes.join("\n"))} className="flex items-center gap-1.5 rounded-full bg-chip px-3 py-1.5 text-sm hover:bg-hover">
                  <Copy className="h-4 w-4" /> Copy
                </button>
                <button onClick={() => setCodes(undefined)} className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white">
                  I saved them
                </button>
              </div>
            </div>
          ) : setup ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">Scan this with an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password…), then enter the code it shows.</p>
              <div className="flex flex-wrap items-center gap-4">
                {/* Server-made SVG of our own otpauth URL. */}
                <div className="h-40 w-40 shrink-0 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qr }} />
                <div className="min-w-0 flex-1 text-xs text-muted">
                  Can&apos;t scan? Enter this key:
                  <code className="mt-1 block font-mono text-sm break-all text-fg">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                  <a href={setup.url} className="mt-2 inline-block text-accent hover:underline">
                    Open in an app on this device
                  </a>
                </div>
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const r = await tfa({ action: "enable", setup: setup.setup, code });
                    setCodes(r.recoveryCodes as string[]);
                    setSetup(undefined);
                    setCode("");
                    await reloadTf();
                    await reloadSessions();
                  });
                }}
              >
                <input autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} font-mono`} />
                <button type="submit" disabled={busy || code.trim().length < 6} className="shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60">
                  Turn on
                </button>
              </form>
            </div>
          ) : tf?.enabled ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                On. Signing in with a password also asks for a code. {tf.recoveryCodesLeft} recovery {tf.recoveryCodesLeft === 1 ? "code" : "codes"} left.
              </p>
              <div className="flex flex-wrap gap-2">
                <input placeholder="Current code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} className={`${inputClass} w-36 font-mono`} aria-label="Current code" />
                <input type="password" placeholder="…or password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} w-40`} aria-label="Password" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={busy || !code}
                  onClick={() =>
                    run(async () => {
                      setCodes((await tfa({ action: "recovery", code })).recoveryCodes as string[]);
                      setCode("");
                      await reloadTf();
                    })
                  }
                  className="rounded-full bg-chip px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
                >
                  New recovery codes
                </button>
                <button
                  disabled={busy || (!code && !password)}
                  onClick={() =>
                    run(async () => {
                      await tfa({ action: "disable", code, password });
                      setCode("");
                      setPassword("");
                      await reloadTf();
                    })
                  }
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-[var(--err)] hover:bg-hover disabled:opacity-50"
                >
                  <ShieldOff className="h-4 w-4" /> Turn off
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">Off. With it on, signing in with a password also asks for a code from your phone. SSO sign-ins use your provider&apos;s own second factor.</p>
              <button
                disabled={busy}
                onClick={() => run(async () => setSetup((await tfa({ action: "start" })) as unknown as Setup))}
                className="w-fit rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
              >
                Set up
              </button>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-line pt-4" aria-labelledby="sessions-title">
          <div className="flex items-center justify-between">
            <h3 id="sessions-title" className="font-semibold">
              Signed in
            </h3>
            {(sessions?.length ?? 0) > 1 && (
              <button
                onClick={() => run(async () => void (await sendJson("/api/profile/sessions?others=1", "DELETE"), await reloadSessions()))}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
              >
                <LogOut className="h-4 w-4" /> Sign out the others
              </button>
            )}
          </div>
          <ul className="flex flex-col">
            {sessions?.map((s) => {
              const Device = /iPhone|Android|Mobile/.test(s.userAgent ?? "") ? Smartphone : Laptop;
              return (
                <li key={s.id} className="flex items-center gap-3 border-t border-line/50 py-2 text-sm first:border-0">
                  <Device className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {deviceName(s.userAgent)}
                      {s.current && <span className="ml-2 rounded-full bg-accent/20 px-2 py-0.5 text-[11px] text-accent">this device</span>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {s.ip ?? "unknown address"} · {s.method} · active {ago(s.lastSeen)}
                    </div>
                  </div>
                  {!s.current && (
                    <button
                      onClick={() => run(async () => void (await sendJson(`/api/profile/sessions?id=${encodeURIComponent(s.id)}`, "DELETE"), await reloadSessions()))}
                      className="rounded-full px-3 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
                    >
                      Sign out
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
