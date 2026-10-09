"use client";

import { useState } from "react";
import useSWR from "swr";
import { Pencil, Plus } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { PERMISSIONS, type Permission } from "@/lib/config/schema";
import type { Group } from "@/lib/auth/groups";
import { Dialog } from "./Dialog";
import { DeleteButton, IconButton } from "./controls";
import { inputClass } from "./FieldInput";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";

const LABELS: Record<Permission, string> = {
  finance: msg("Use the finance tracker"),
  actions: msg("Run widget actions (start, stop, restart)"),
  travel: msg("Use the travel log"),
  watchlist: msg("Use the watchlist and reading list"),
  inventory: msg("See and edit the device inventory (and wake devices, with actions)"),
};

/** Groups: who sees items marked visible: [group], extra permissions, and SSO group mapping. */
export function GroupsPanel() {
  const t = useT();
  const { data: groups, mutate, error } = useSWR<Group[]>("/api/groups", fetcher);
  const [editing, setEditing] = useState<Group | "new">();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Groups")}</h2>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("Add group")}
        </button>
      </div>
      <p className="px-1 text-xs text-muted">
        {t("Show items to a group with")}{" "}<code>{t("visible: [family, media]")}</code> {t("(or pick groups in the editor). Members also get the group's permissions. Admins see and do everything.")}
      </p>
      {error && <p className="text-sm text-[var(--err)]">{error.message}</p>}
      {groups?.length === 0 && <p className="px-1 py-2 text-sm text-muted">{t("No groups yet.")}</p>}
      {groups?.map((g) => (
        <div key={g.id} className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {g.name} <span className="text-xs font-normal text-muted">· {g.members} {g.members === 1 ? "member" : "members"}</span>
            </div>
            {g.description && <div className="text-xs text-muted">{g.description}</div>}
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
              {g.permissions.map((p) => (
                <span key={p} className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">
                  {p}
                </span>
              ))}
              {g.sso.map((s) => (
                <span key={s} className="rounded-full bg-chip px-2 py-0.5" title={t("Members of this group at the sign-in provider join automatically")}>
                  {t("sso:")}{" "}{s}
                </span>
              ))}
            </div>
          </div>
          <IconButton label={t("Edit {name}", { name: g.name })} onClick={() => setEditing(g)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <DeleteButton label={t("Delete {name}", { name: g.name })} onConfirm={async () => void mutate(await sendJson<Group[]>(`/api/groups?id=${g.id}`, "DELETE"), { revalidate: false })} />
        </div>
      ))}
      {editing && <GroupDialog group={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={(list) => mutate(list, { revalidate: false })} />}
    </section>
  );
}

function GroupDialog({ group, onClose, onSaved }: { group?: Group; onClose: () => void; onSaved: (list: Group[]) => void }) {
  const t = useT();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [perms, setPerms] = useState(new Set<Permission>(group?.permissions ?? []));
  const [sso, setSso] = useState(group?.sso.join(", ") ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const body = { name: name.trim(), description, permissions: [...perms], sso: sso.split(",").map((s) => s.trim()).filter(Boolean) };
      onSaved(await sendJson<Group[]>("/api/groups", group ? "PATCH" : "POST", group ? { ...body, id: group.id } : body));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={group ? t("Edit {name}", { name: group.name }) : t("New group")} onClose={onClose} onSubmit={save} error={error} busy={busy}>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t("Name")}</span>
        <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("family")} className={inputClass} />
        {group && name !== group.name && <span className="text-xs text-[var(--warn)]">{t("Items with visible: [")}{group.name}{t("] need the new name too.")}</span>}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t("Description")}</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("optional")} className={inputClass} />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted">{t("Members may also")}</legend>
        {PERMISSIONS.map((p) => (
          <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={perms.has(p)}
              onChange={(e) => {
                const next = new Set(perms);
                if (e.target.checked) next.add(p);
                else next.delete(p);
                setPerms(next);
              }}
            />
            {t(LABELS[p])}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t("Sign-in groups that join automatically")}</span>
        <input value={sso} onChange={(e) => setSso(e.target.value)} placeholder={t("family, cn=media,ou=groups,dc=example,dc=com")} className={inputClass} />
        <span className="text-xs text-muted">{t("Comma-separated names as your SSO provider (groups claim), LDAP (memberOf) or proxy (Remote-Groups) report them. Checked at every sign-in.")}</span>
      </label>
    </Dialog>
  );
}
