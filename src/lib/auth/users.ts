import { db } from "../db";

export type Role = "admin" | "user";

export interface User {
  id: number;
  username: string;
  email: string | null;
  name: string | null;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
  createdAt: number;
  /** URL of an uploaded profile picture. */
  avatar: string | null;
  /** Signs in with a one-time code as well. */
  twoFactor: boolean;
}

interface Row {
  id: number;
  username: string;
  email: string | null;
  name: string | null;
  password_hash: string | null;
  role: string;
  disabled: number;
  created_at: number;
  avatar: string | null;
  totp_secret: string | null;
  totp_recovery: string | null;
}

const toUser = (r: Row | undefined): User | undefined =>
  r && {
    id: r.id,
    username: r.username,
    email: r.email,
    name: r.name,
    role: r.role === "admin" ? "admin" : "user",
    disabled: !!r.disabled,
    hasPassword: !!r.password_hash,
    createdAt: r.created_at,
    avatar: r.avatar ?? null,
    twoFactor: !!r.totp_secret,
  };

const one = (sql: string, ...args: (string | number | null)[]) => db().prepare(sql).get(...args) as Row | undefined;

export const countUsers = () => (db().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
export const countAdmins = () =>
  (db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get() as { n: number }).n;

export const getUser = (id: number) => toUser(one("SELECT * FROM users WHERE id = ?", id));
export const findByUsername = (username: string) => toUser(one("SELECT * FROM users WHERE username = ?", username));
export const findByEmail = (email: string) => toUser(one("SELECT * FROM users WHERE email = ? ORDER BY id LIMIT 1", email));
export const passwordHash = (id: number) => one("SELECT * FROM users WHERE id = ?", id)?.password_hash ?? null;

export function findByIdentity(provider: string, subject: string): User | undefined {
  return toUser(
    one("SELECT u.* FROM users u JOIN identities i ON i.user_id = u.id WHERE i.provider = ? AND i.subject = ?", provider, subject),
  );
}

export function listUsers(): (User & { identities: { provider: string; subject: string }[] })[] {
  const rows = db().prepare("SELECT * FROM users ORDER BY username").all() as unknown as Row[];
  const ids = db().prepare("SELECT user_id, provider, subject FROM identities").all() as unknown as {
    user_id: number;
    provider: string;
    subject: string;
  }[];
  return rows.map((r) => ({
    ...toUser(r)!,
    identities: ids.filter((i) => i.user_id === r.id).map(({ provider, subject }) => ({ provider, subject })),
  }));
}

export function createUser(u: { username: string; email?: string | null; name?: string | null; role: Role; passwordHash?: string | null }): User {
  const res = db()
    .prepare("INSERT INTO users (username, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(u.username, u.email ?? null, u.name ?? null, u.passwordHash ?? null, u.role, Date.now());
  return getUser(Number(res.lastInsertRowid))!;
}

export function updateUser(
  id: number,
  patch: Partial<{ email: string | null; name: string | null; role: Role; disabled: boolean; passwordHash: string | null; avatar: string | null }>,
) {
  const cols: Record<string, string | number | null | undefined> = {
    email: patch.email,
    name: patch.name,
    avatar: patch.avatar,
    role: patch.role,
    disabled: patch.disabled === undefined ? undefined : patch.disabled ? 1 : 0,
    password_hash: patch.passwordHash,
  };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (!set.length) return;
  db()
    .prepare(`UPDATE users SET ${set.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...set.map(([, v]) => v ?? null), id);
}

/** The sealed TOTP secret and recovery-code hashes, or null when 2FA is off. */
export function getTwoFactor(id: number): { secret: string; recovery: string[] } | null {
  const r = one("SELECT * FROM users WHERE id = ?", id);
  return r?.totp_secret ? { secret: r.totp_secret, recovery: JSON.parse(r.totp_recovery ?? "[]") as string[] } : null;
}

export function setTwoFactor(id: number, v: { secret: string; recovery: string[] } | null) {
  db().prepare("UPDATE users SET totp_secret = ?, totp_recovery = ? WHERE id = ?").run(v?.secret ?? null, v ? JSON.stringify(v.recovery) : null, id);
}

export const deleteUser = (id: number) => db().prepare("DELETE FROM users WHERE id = ?").run(id);

export const linkIdentity = (userId: number, provider: string, subject: string) =>
  db().prepare("INSERT OR REPLACE INTO identities (user_id, provider, subject) VALUES (?, ?, ?)").run(userId, provider, subject);

export const unlinkIdentity = (userId: number, provider: string, subject: string) =>
  db().prepare("DELETE FROM identities WHERE user_id = ? AND provider = ? AND subject = ?").run(userId, provider, subject);

export function audit(user: string | null, action: string, detail?: unknown) {
  db()
    .prepare("INSERT INTO audit (ts, user, action, detail) VALUES (?, ?, ?, ?)")
    .run(Date.now(), user, action, detail === undefined ? null : JSON.stringify(detail));
}
