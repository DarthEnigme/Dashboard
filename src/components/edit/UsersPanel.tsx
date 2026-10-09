"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Link, Link2Off, LogOut, Plus, ShieldCheck, ShieldOff, Users2, UserX } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { User } from "@/lib/auth/users";
import type { FieldSpec } from "@/integrations/fields";
import { FieldsDialog } from "./FieldsDialog";
import { DeleteButton, IconButton } from "./controls";
import { Dialog } from "./Dialog";
import { Avatar } from "../auth/ProfileDialog";
import type { Group } from "@/lib/auth/groups";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n";

type Row = User & { identities: { provider: string; subject: string }[]; groups: { name: string; source: string }[] };

const newUserFields: FieldSpec[] = [
  { key: "username", label: msg("Username"), required: true },
  { key: "name", label: msg("Display name") },
  { key: "email", label: msg("Email"), help: msg("SSO and directory logins with this verified email are linked to this account.") },
  { key: "role", label: msg("Role"), kind: "select", options: ["user", "admin"], required: true },
  { key: "password", label: msg("Password"), secret: true, help: msg("Optional: leave empty for SSO/LDAP-only accounts.") },
];
const passwordFields: FieldSpec[] = [{ key: "password", label: msg("New password (8+ characters)"), secret: true, required: true }];

export function UsersPanel() {
  const t = useT();
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<
    { kind: "new" } | { kind: "password"; user: Row } | { kind: "groups"; user: Row } | { kind: "link"; user: Row; link: string; hours: number }
  >();

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
      const r = await sendJson<{ link?: string; linkHours?: number }>(`/api/users/${id}`, "PATCH", body);
      await load();
      return r;
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
        <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Users")}</h2>
        <button
          onClick={() => setDialog({ kind: "new" })}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> {t("Add user")}
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">{error}</p>}
      {!rows && !error && <div className="glass h-24 animate-pulse rounded-2xl" />}
      {rows?.map((u) => (
        <div key={u.id} className={`glass flex flex-wrap items-center gap-3 rounded-2xl p-3 ${u.disabled ? "opacity-60" : ""}`}>
          <Avatar user={u} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-medium">
              <span className="truncate">{u.name || u.username}</span>
              {u.role === "admin" && (
                <span className="flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-[11px] text-accent">
                  <ShieldCheck className="h-3 w-3" /> {t("admin")}
                </span>
              )}
              {u.disabled && <span className="rounded-full bg-[var(--err)]/15 px-2 py-0.5 text-[11px] text-[var(--err)]">{t("disabled")}</span>}
              {u.twoFactor && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--ok)]/15 px-2 py-0.5 text-[11px] text-[var(--ok)]" title={t("Two-factor sign-in is on")}>
                  <ShieldCheck className="h-3 w-3" /> {t("2FA")}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted">
              {u.username}
              {u.email && ` · ${u.email}`}
              {u.hasPassword ? t(" · password") : ""}
            </div>
            {u.groups.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {u.groups.map((g) => (
                  <span
                    key={g.name}
                    className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent"
                    title={g.source === "sso" ? t("From the groups the sign-in reported") : t("Added by an admin")}
                  >
                    {g.name}
                    {g.source === "sso" && t(" · sso")}
                  </span>
                ))}
              </div>
            )}
            {u.identities.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {u.identities.map((i) => (
                  <span key={`${i.provider}|${i.subject}`} className="flex items-center gap-1 rounded-full bg-chip py-0.5 pr-1 pl-2 text-[11px]" title={i.subject}>
                    {i.provider}
                    <button
                      aria-label={t("Unlink {name}", { name: i.provider })}
                      title={t("Unlink this sign-in")}
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
              {u.role === "admin" ? t("Make user") : t("Make admin")}
            </button>
            <IconButton label={t("Groups")} onClick={() => setDialog({ kind: "groups", user: u })}>
              <Users2 className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={t("Set password")} onClick={() => setDialog({ kind: "password", user: u })}>
              <KeyRound className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label={t("Link to set a password")}
              onClick={async () => {
                const r = await patch(u.id, { resetLink: true });
                if (r?.link) setDialog({ kind: "link", user: u, link: r.link, hours: r.linkHours ?? 48 });
              }}
            >
              <Link className="h-3.5 w-3.5" />
            </IconButton>
            {u.twoFactor && (
              <IconButton label={t("Turn off two-factor sign-in (lost phone)")} onClick={() => patch(u.id, { resetTwoFactor: true })}>
                <ShieldOff className="h-3.5 w-3.5" />
              </IconButton>
            )}
            <IconButton label={t("Sign out everywhere")} onClick={() => patch(u.id, { signOut: true })}>
              <LogOut className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={u.disabled ? t("Enable account") : t("Disable account")} onClick={() => patch(u.id, { disabled: !u.disabled })}>
              <UserX className="h-3.5 w-3.5" />
            </IconButton>
            <DeleteButton label={t("Delete {name}", { name: u.username })} onConfirm={() => remove(u.id)} />
          </div>
        </div>
      ))}

      {dialog?.kind === "new" && (
        <FieldsDialog
          title={t("Add user")}
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
          title={t("Set password for {name}", { name: dialog.user.username })}
          fields={passwordFields}
          initial={{}}
          onClose={() => setDialog(undefined)}
          onSave={async (v) => {
            await sendJson(`/api/users/${dialog.user.id}`, "PATCH", { password: v.password });
            await load();
          }}
        />
      )}
      {dialog?.kind === "groups" && (
        <GroupsDialog
          user={dialog.user}
          onClose={() => setDialog(undefined)}
          onSave={async (groups) => {
            await sendJson(`/api/users/${dialog.user.id}`, "PATCH", { groups });
            await load();
          }}
        />
      )}
      {dialog?.kind === "link" && (
        <Dialog title={t("Password link for {name}", { name: dialog.user.username })} onClose={() => setDialog(undefined)} onSubmit={() => setDialog(undefined)} submitLabel={t("Done")}>
          <p className="text-sm">
            {t("Send this to")}{" "}{dialog.user.name || dialog.user.username}{t(". It works once, within")}{" "}{dialog.hours} {t("hours, and signs them out everywhere when used.")}
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={dialog.link}
              onFocus={(e) => e.target.select()}
              className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-chip px-3 font-mono text-xs"
              aria-label={t("Link")}
            />
            <button type="button" onClick={() => navigator.clipboard?.writeText(dialog.link)} className="flex items-center gap-1.5 rounded-xl bg-chip px-3 text-sm hover:bg-hover">
              <Copy className="h-4 w-4" /> {t("Copy")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** Pick the groups an admin adds a user to; groups from SSO are shown but follow the provider. */
function GroupsDialog({ user, onClose, onSave }: { user: Row; onClose: () => void; onSave: (groups: string[]) => Promise<void> }) {
  const t = useT();
  const [groups, setGroups] = useState<Group[]>();
  const [chosen, setChosen] = useState(new Set(user.groups.filter((g) => g.source === "manual").map((g) => g.name.toLowerCase())));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetcher<Group[]>("/api/groups").then(setGroups, (e: Error) => setError(e.message));
  }, []);
  const sso = new Set(user.groups.filter((g) => g.source === "sso").map((g) => g.name.toLowerCase()));
  return (
    <Dialog
      title={t("Groups of {name}", { name: user.username })}
      onClose={onClose}
      busy={busy}
      error={error}
      onSubmit={async () => {
        setBusy(true);
        try {
          await onSave(groups?.filter((g) => chosen.has(g.name.toLowerCase())).map((g) => g.name) ?? []);
          onClose();
        } catch (e) {
          setError((e as Error).message);
          setBusy(false);
        }
      }}
    >
      {groups?.length === 0 && <p className="text-sm text-muted">{t("No groups yet. Create them under Groups below.")}</p>}
      {groups?.map((g) => {
        const key = g.name.toLowerCase();
        return (
          <label key={g.id} className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              checked={chosen.has(key) || sso.has(key)}
              disabled={sso.has(key)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(key);
                else next.delete(key);
                setChosen(next);
              }}
            />
            <span>
              <span className="font-medium">{g.name}</span>
              {sso.has(key) && <span className="text-xs text-muted"> {t("· from sign-in groups")}</span>}
              {g.description && <span className="block text-xs text-muted">{g.description}</span>}
            </span>
          </label>
        );
      })}
    </Dialog>
  );
}
