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

const LABELS: Record<Permission, string> = {
  finance: "Use the finance tracker",
  actions: "Run widget actions (start, stop, restart)",
};

/** Groups: who sees items marked visible: [group], extra permissions, and SSO group mapping. */
export function GroupsPanel() {
  const { data: groups, mutate, error } = useSWR<Group[]>("/api/groups", fetcher);
  const [editing, setEditing] = useState<Group | "new">();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Groups</h2>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> Add group
        </button>
      </div>
      <p className="px-1 text-xs text-muted">
        Show items to a group with <code>visible: [family, media]</code> (or pick groups in the editor). Members also get the group&apos;s permissions. Admins see and do everything.
      </p>
      {error && <p className="text-sm text-[var(--err)]">{error.message}</p>}
      {groups?.length === 0 && <p className="px-1 py-2 text-sm text-muted">No groups yet.</p>}
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
                <span key={s} className="rounded-full bg-chip px-2 py-0.5" title="Members of this group at the sign-in provider join automatically">
                  sso: {s}
                </span>
              ))}
            </div>
          </div>
          <IconButton label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <DeleteButton label={`Delete ${g.name}`} onConfirm={async () => void mutate(await sendJson<Group[]>(`/api/groups?id=${g.id}`, "DELETE"), { revalidate: false })} />
        </div>
      ))}
      {editing && <GroupDialog group={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={(list) => mutate(list, { revalidate: false })} />}
    </section>
  );
}

function GroupDialog({ group, onClose, onSaved }: { group?: Group; onClose: () => void; onSaved: (list: Group[]) => void }) {
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
    <Dialog title={group ? `Edit ${group.name}` : "New group"} onClose={onClose} onSubmit={save} error={error} busy={busy}>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Name</span>
        <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="family" className={inputClass} />
        {group && name !== group.name && <span className="text-xs text-[var(--warn)]">Items with visible: [{group.name}] need the new name too.</span>}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" className={inputClass} />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted">Members may also</legend>
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
            {LABELS[p]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Sign-in groups that join automatically</span>
        <input value={sso} onChange={(e) => setSso(e.target.value)} placeholder="family, cn=media,ou=groups,dc=example,dc=com" className={inputClass} />
        <span className="text-xs text-muted">Comma-separated names as your SSO provider (groups claim), LDAP (memberOf) or proxy (Remote-Groups) report them. Checked at every sign-in.</span>
      </label>
    </Dialog>
  );
}
