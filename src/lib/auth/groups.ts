import { db } from "../db";

/**
 * Groups of users: they can see items marked `visible: [group, …]`, and they get permissions on top of
 * what every signed-in user may do (auth.userPermissions). Members are added by hand, or follow the
 * groups an SSO, LDAP or proxy sign-in reports (`sso`: those groups' names).
 */

import { PERMISSIONS, type Permission } from "../config/schema";

export { PERMISSIONS, type Permission };
export const PERMISSION_LABELS: Record<Permission, string> = {
  finance: "Use the finance tracker",
  actions: "Run widget actions (start, stop, restart)",
};

export interface Group {
  id: number;
  name: string;
  description: string | null;
  permissions: Permission[];
  /** External group names (from SSO, LDAP or proxy headers) whose members join automatically. */
  sso: string[];
  members: number;
}

interface Row {
  id: number;
  name: string;
  description: string | null;
  permissions: string;
  sso: string;
  members?: number;
}

const perms = (json: string) => (JSON.parse(json) as string[]).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
const toGroup = (r: Row): Group => ({ id: r.id, name: r.name, description: r.description, permissions: perms(r.permissions), sso: JSON.parse(r.sso) as string[], members: r.members ?? 0 });

export const listGroups = () =>
  (
    db()
      .prepare("SELECT g.*, (SELECT COUNT(*) FROM user_group_members m WHERE m.group_id = g.id) AS members FROM user_groups g ORDER BY g.name")
      .all() as unknown as Row[]
  ).map(toGroup);

export const GROUP_NAME = /^[\w.-][\w .-]{0,47}$/;

export function createGroup(g: { name: string; description?: string | null; permissions?: Permission[]; sso?: string[] }) {
  if (!GROUP_NAME.test(g.name)) throw new Error("Group name: letters, digits, spaces, . _ - (up to 48)");
  if (["public", "users", "admins"].includes(g.name.toLowerCase())) throw new Error(`"${g.name}" is reserved`);
  db()
    .prepare("INSERT INTO user_groups (name, description, permissions, sso) VALUES (?, ?, ?, ?)")
    .run(g.name, g.description ?? null, JSON.stringify(g.permissions ?? []), JSON.stringify(g.sso ?? []));
}

export function updateGroup(id: number, patch: { name?: string; description?: string | null; permissions?: Permission[]; sso?: string[] }) {
  if (patch.name !== undefined && !GROUP_NAME.test(patch.name)) throw new Error("Group name: letters, digits, spaces, . _ - (up to 48)");
  const cols = Object.entries({
    name: patch.name,
    description: patch.description,
    permissions: patch.permissions && JSON.stringify(patch.permissions),
    sso: patch.sso && JSON.stringify(patch.sso),
  }).filter(([, v]) => v !== undefined);
  if (!cols.length) return;
  db()
    .prepare(`UPDATE user_groups SET ${cols.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...cols.map(([, v]) => v as string | null), id);
}

export const deleteGroup = (id: number) => db().prepare("DELETE FROM user_groups WHERE id = ?").run(id);

/** A user's groups, with how they joined. */
export function groupsOf(userId: number): (Group & { source: "manual" | "sso" })[] {
  return (
    db()
      .prepare("SELECT g.*, m.source FROM user_groups g JOIN user_group_members m ON m.group_id = g.id WHERE m.user_id = ? ORDER BY g.name")
      .all(userId) as unknown as (Row & { source: "manual" | "sso" })[]
  ).map((r) => ({ ...toGroup(r), source: r.source }));
}

/** Memberships for every user at once (for the users list). */
export function allMemberships(): Map<number, { name: string; source: string }[]> {
  const rows = db().prepare("SELECT m.user_id, g.name, m.source FROM user_group_members m JOIN user_groups g ON g.id = m.group_id ORDER BY g.name").all() as {
    user_id: number;
    name: string;
    source: string;
  }[];
  const out = new Map<number, { name: string; source: string }[]>();
  for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), { name: r.name, source: r.source }]);
  return out;
}

/** Set the groups an admin chose for a user (by name); memberships from SSO stay. */
export function setManualGroups(userId: number, names: string[]) {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const groups = listGroups();
  const unknown = names.filter((n) => !groups.some((g) => g.name.toLowerCase() === n.toLowerCase()));
  if (unknown.length) throw new Error(`No such group: ${unknown.join(", ")}`);
  db().exec("BEGIN");
  try {
    db().prepare("DELETE FROM user_group_members WHERE user_id = ? AND source = 'manual'").run(userId);
    for (const g of groups) {
      if (wanted.has(g.name.toLowerCase())) {
        db().prepare("INSERT OR REPLACE INTO user_group_members (user_id, group_id, source) VALUES (?, ?, 'manual')").run(userId, g.id);
      }
    }
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}

/**
 * Follow the groups an external sign-in reported: join the Page groups mapped to any of them, leave
 * SSO-made memberships that no longer match. Hand-made memberships are never touched. Writes only
 * on change (proxy sign-in calls this on every request).
 */
export function syncSsoGroups(userId: number, external: string[] | undefined) {
  if (!external) return;
  const ext = new Set(external.map((e) => e.toLowerCase()));
  const groups = listGroups();
  const should = new Set(groups.filter((g) => g.sso.some((s) => ext.has(s.toLowerCase()))).map((g) => g.id));
  const current = db().prepare("SELECT group_id, source FROM user_group_members WHERE user_id = ?").all(userId) as { group_id: number; source: string }[];
  const has = new Map(current.map((c) => [c.group_id, c.source]));
  const add = [...should].filter((id) => !has.has(id));
  const remove = current.filter((c) => c.source === "sso" && !should.has(c.group_id)).map((c) => c.group_id);
  if (!add.length && !remove.length) return;
  for (const id of add) db().prepare("INSERT INTO user_group_members (user_id, group_id, source) VALUES (?, ?, 'sso')").run(userId, id);
  for (const id of remove) db().prepare("DELETE FROM user_group_members WHERE user_id = ? AND group_id = ?").run(userId, id);
}
