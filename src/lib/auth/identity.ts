import * as users from "./users";
import type { Role, User } from "./users";

/** A person as reported by an external login method (OIDC, GitHub, LDAP, proxy headers). */
export interface ExternalIdentity {
  provider: string;
  subject: string;
  username?: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  groups?: string[];
}

export interface Policy {
  /** Create an account for people who don't have one. */
  signup: boolean;
  defaultRole: Role;
  /** Group whose members become admins (promotion only; never demotes). */
  adminGroup?: string;
  /** The source is a directory you run (LDAP, proxy): match existing users by username too. */
  trustUsername?: boolean;
}

export type Resolution = { ok: true; user: User; created: boolean } | { ok: false; error: string };

type Repo = Pick<
  typeof users,
  "findByIdentity" | "findByEmail" | "findByUsername" | "createUser" | "linkIdentity" | "updateUser" | "getUser"
>;

function uniqueUsername(repo: Repo, wanted: string): string {
  const base = wanted.toLowerCase().replace(/[^a-z0-9._-]/g, "") || "user";
  let name = base;
  for (let i = 2; repo.findByUsername(name); i++) name = `${base}${i}`;
  return name;
}

/**
 * Find or create the local user for an external identity.
 * Order: an already linked identity → a user with the same verified email (or, for trusted
 * directories, the same username), which gets linked → a new account if signups are allowed.
 */
export function resolveIdentity(id: ExternalIdentity, policy: Policy, repo: Repo = users): Resolution {
  const isAdmin = !!policy.adminGroup && !!id.groups?.includes(policy.adminGroup);
  const finish = (user: User, created: boolean): Resolution => {
    if (user.disabled) return { ok: false, error: "This account is disabled." };
    if (isAdmin && user.role !== "admin") {
      repo.updateUser(user.id, { role: "admin" });
      user = repo.getUser(user.id)!;
    }
    return { ok: true, user, created };
  };

  const linked = repo.findByIdentity(id.provider, id.subject);
  if (linked) return finish(linked, false);

  const existing =
    (id.email && id.emailVerified ? repo.findByEmail(id.email) : undefined) ??
    (policy.trustUsername && id.username ? repo.findByUsername(id.username) : undefined);
  if (existing) {
    if (existing.disabled) return { ok: false, error: "This account is disabled." };
    repo.linkIdentity(existing.id, id.provider, id.subject);
    return finish(existing, false);
  }

  if (!policy.signup) {
    const who = id.email ?? id.username ?? "this account";
    return { ok: false, error: `No Page account for ${who}. Ask an admin to add you.` };
  }

  const user = repo.createUser({
    username: uniqueUsername(repo, id.username ?? id.email?.split("@")[0] ?? `${id.provider}-${id.subject}`),
    email: id.emailVerified ? id.email : null,
    name: id.name,
    role: isAdmin ? "admin" : policy.defaultRole,
  });
  repo.linkIdentity(user.id, id.provider, id.subject);
  return finish(user, true);
}
