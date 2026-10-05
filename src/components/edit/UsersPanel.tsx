"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Link2Off, Plus, ShieldCheck, UserX } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { User } from "@/lib/auth/users";
import type { FieldSpec } from "@/integrations/fields";
import { FieldsDialog } from "./FieldsDialog";
import { DeleteButton, IconButton } from "./controls";

type Row = User & { identities: { provider: string; subject: string }[] };

const newUserFields: FieldSpec[] = [
  { key: "username", label: "Username", required: true },
  { key: "name", label: "Display name" },
  { key: "email", label: "Email", help: "SSO and directory logins with this verified email are linked to this account." },
  { key: "role", label: "Role", kind: "select", options: ["user", "admin"], required: true },
  { key: "password", label: "Password", secret: true, help: "Optional: leave empty for SSO/LDAP-only accounts." },
];
const passwordFields: FieldSpec[] = [{ key: "password", label: "New password (8+ characters)", secret: true, required: true }];

export function UsersPanel() {
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "password"; user: Row }>();

  const load = useCallback(async () => {
    try {
      setRows(await fetcher<Row[]>("/api/users"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const patch = async (id: number, body: Record<string, unknown>) => {
    setError(undefined);
    try {
      await sendJson(`/api/users/${id}`, "PATCH", body);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (id: number) => {
    setError(undefined);
    try {
      await sendJson(`/api/users/${id}`, "DELETE");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Users</h2>
        <button
          onClick={() => setDialog({ kind: "new" })}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Add user
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">{error}</p>}
      {!rows && !error && <div className="glass h-24 animate-pulse rounded-2xl" />}
      {rows?.map((u) => (
        <div key={u.id} className={`glass flex flex-wrap items-center gap-3 rounded-2xl p-3 ${u.disabled ? "opacity-60" : ""}`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent/50 font-semibold text-white">
            {(u.name || u.username)[0]?.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-medium">
              <span className="truncate">{u.name || u.username}</span>
              {u.role === "admin" && (
                <span className="flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-[11px] text-accent">
                  <ShieldCheck className="h-3 w-3" /> admin
                </span>
              )}
              {u.disabled && <span className="rounded-full bg-[var(--err)]/15 px-2 py-0.5 text-[11px] text-[var(--err)]">disabled</span>}
            </div>
            <div className="truncate text-xs text-muted">
              {u.username}
              {u.email && ` · ${u.email}`}
              {u.hasPassword ? " · password" : ""}
            </div>
            {u.identities.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {u.identities.map((i) => (
                  <span key={`${i.provider}|${i.subject}`} className="flex items-center gap-1 rounded-full bg-chip py-0.5 pr-1 pl-2 text-[11px]" title={i.subject}>
                    {i.provider}
                    <button
                      aria-label={`Unlink ${i.provider}`}
                      title="Unlink this sign-in"
                      onClick={() => patch(u.id, { unlink: i })}
                      className="rounded-full p-0.5 text-muted hover:bg-hover hover:text-[var(--err)]"
                    >
                      <Link2Off className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => patch(u.id, { role: u.role === "admin" ? "user" : "admin" })}
              className="rounded-full px-3 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
            >
              {u.role === "admin" ? "Make user" : "Make admin"}
            </button>
            <IconButton label="Set password" onClick={() => setDialog({ kind: "password", user: u })}>
              <KeyRound className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={u.disabled ? "Enable account" : "Disable account"} onClick={() => patch(u.id, { disabled: !u.disabled })}>
              <UserX className="h-3.5 w-3.5" />
            </IconButton>
            <DeleteButton label={`Delete ${u.username}`} onConfirm={() => remove(u.id)} />
          </div>
        </div>
      ))}

      {dialog?.kind === "new" && (
        <FieldsDialog
          title="Add user"
          fields={newUserFields}
          initial={{ role: "user" }}
          onClose={() => setDialog(undefined)}
          onSave={async (v) => {
            await sendJson("/api/users", "POST", v);
            await load();
          }}
        />
      )}
      {dialog?.kind === "password" && (
        <FieldsDialog
          title={`Set password for ${dialog.user.username}`}
          fields={passwordFields}
          initial={{}}
          onClose={() => setDialog(undefined)}
          onSave={async (v) => {
            await sendJson(`/api/users/${dialog.user.id}`, "PATCH", { password: v.password });
            await load();
          }}
        />
      )}
    </section>
  );
}
