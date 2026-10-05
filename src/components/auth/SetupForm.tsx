"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { sendJson } from "@/lib/fetcher";
import { inputClass } from "../edit/FieldInput";

export function SetupForm({ title }: { title: string }) {
  const [form, setForm] = useState({ username: "admin", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError("The passwords don't match");
    setBusy(true);
    setError(undefined);
    try {
      await sendJson("/api/auth/setup", "POST", { username: form.username, email: form.email, password: form.password });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const field = (label: string, k: keyof typeof form, type = "text", autoComplete?: string) => (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
      {label}
      <input type={type} value={form[k]} onChange={set(k)} autoComplete={autoComplete} className={inputClass} />
    </label>
  );

  return (
    <form onSubmit={submit} className="glass flex w-full max-w-sm flex-col gap-3 rounded-3xl p-7">
      <h1 className="text-2xl font-bold tracking-tight">Welcome to {title}</h1>
      <p className="mb-3 text-sm text-muted">Create the admin account. You can add more users and single sign-on later.</p>
      {error && (
        <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">
          {error}
        </p>
      )}
      {field("Username", "username", "text", "username")}
      {field("Email (optional, used to match SSO logins)", "email", "email", "email")}
      {field("Password (8+ characters)", "password", "password", "new-password")}
      {field("Confirm password", "confirm", "password", "new-password")}
      <button
        type="submit"
        disabled={busy}
        className="mt-2 flex h-10 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Create admin account
      </button>
    </form>
  );
}
