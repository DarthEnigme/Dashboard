import { beforeAll, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { resolveIdentity, type ExternalIdentity, type Policy } from "@/lib/auth/identity";
import { escapeFilter, ldapAuthenticate } from "@/lib/auth/ldap";
import type { Role, User } from "@/lib/auth/users";
import { canSee } from "@/lib/auth";
import { maskRaw, sanitize } from "@/lib/config/sanitize";
import { MASK, servicesFileSchema, settingsSchema } from "@/lib/config/schema";

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("sessions", () => {
  beforeAll(() => {
    process.env.HOMEPAGE_SECRET = "test-secret-test-secret-test-secret";
  });

  it("round-trips and rejects tampered or expired tokens", async () => {
    const { sessionToken, signToken, verifyToken } = await import("@/lib/auth/session");
    const t = await sessionToken(42, "sid-1");
    expect(await verifyToken(t)).toMatchObject({ sub: "42", sid: "sid-1", kind: "session" });
    expect(await verifyToken(t.slice(0, -2) + "xx")).toBeNull();
    expect(await verifyToken(await signToken({}, "1", "-1s"))).toBeNull();
    expect(await verifyToken(undefined)).toBeNull();
  });
});

/** In-memory stand-in for the users table. */
function fakeRepo(seed: Partial<User & { identities: string[] }>[] = []) {
  let next = 1;
  const rows: User[] = [];
  const links = new Map<string, number>();
  const make = (u: Partial<User>): User => ({
    id: next++,
    username: u.username ?? "x",
    email: u.email ?? null,
    name: u.name ?? null,
    role: (u.role as Role) ?? "user",
    disabled: !!u.disabled,
    hasPassword: false,
    createdAt: 0,
    avatar: null,
    twoFactor: false,
  });
  for (const s of seed) {
    const u = make(s);
    rows.push(u);
    for (const i of s.identities ?? []) links.set(i, u.id);
  }
  return {
    rows,
    links,
    getUser: (id: number) => rows.find((r) => r.id === id),
    findByIdentity: (p: string, s: string) => rows.find((r) => r.id === links.get(`${p}|${s}`)),
    findByEmail: (e: string) => rows.find((r) => r.email?.toLowerCase() === e.toLowerCase()),
    findByUsername: (n: string) => rows.find((r) => r.username.toLowerCase() === n.toLowerCase()),
    createUser: (u: Parameters<typeof make>[0]) => {
      const user = make(u);
      rows.push(user);
      return user;
    },
    linkIdentity: (id: number, p: string, s: string) => void links.set(`${p}|${s}`, id),
    updateUser: (id: number, patch: Partial<User>) => {
      const r = rows.find((x) => x.id === id)!;
      Object.assign(r, patch);
    },
  };
}

const google = (o: Partial<ExternalIdentity> = {}): ExternalIdentity => ({
  provider: "google",
  subject: "g-123",
  email: "alice@example.com",
  emailVerified: true,
  name: "Alice",
  ...o,
});
const closed: Policy = { signup: false, defaultRole: "user" };

describe("identity resolution (signup policy)", () => {
  it("refuses unknown people when signups are disabled", () => {
    const repo = fakeRepo();
    const r = resolveIdentity(google(), closed, repo as never);
    expect(r).toEqual({ ok: false, error: "No Page account for alice@example.com. Ask an admin to add you." });
    expect(repo.rows).toHaveLength(0);
  });

  it("links an existing account by verified email, then by identity", () => {
    const repo = fakeRepo([{ username: "alice", email: "Alice@Example.com" }]);
    const r = resolveIdentity(google(), closed, repo as never);
    expect(r.ok && r.user.username).toBe("alice");
    expect(repo.links.get("google|g-123")).toBe(1);
    // Next time the identity matches even if the email changed at the provider.
    const again = resolveIdentity(google({ email: "new@example.com" }), closed, repo as never);
    expect(again.ok && again.user.id).toBe(1);
  });

  it("never links by an unverified email", () => {
    const repo = fakeRepo([{ username: "alice", email: "alice@example.com" }]);
    expect(resolveIdentity(google({ emailVerified: false }), closed, repo as never).ok).toBe(false);
  });

  it("matches usernames only for trusted directories", () => {
    const repo = fakeRepo([{ username: "bob" }]);
    const id = { provider: "github", subject: "9", username: "bob", emailVerified: false };
    expect(resolveIdentity(id, closed, repo as never).ok).toBe(false);
    expect(resolveIdentity({ ...id, provider: "ldap" }, { ...closed, trustUsername: true }, repo as never).ok).toBe(true);
  });

  it("creates accounts when signups are on, with unique usernames and admin-group promotion", () => {
    const repo = fakeRepo([{ username: "alice" }]);
    const r = resolveIdentity(google({ groups: ["admins"] }), { signup: true, defaultRole: "user", adminGroup: "admins" }, repo as never);
    expect(r.ok && r.created).toBe(true);
    expect(r.ok && r.user.username).toBe("alice2");
    expect(r.ok && r.user.role).toBe("admin");
  });

  it("rejects disabled accounts", () => {
    const repo = fakeRepo([{ username: "alice", email: "alice@example.com", disabled: true }]);
    expect(resolveIdentity(google(), closed, repo as never)).toEqual({ ok: false, error: "This account is disabled." });
  });
});

describe("ldap", () => {
  const cfg = settingsSchema.parse({
    auth: { ldap: { enabled: true, url: "ldap://x", bindDN: "cn=svc", bindPassword: "svcpw", baseDN: "ou=people,dc=x" } },
  }).auth.ldap;

  function fakeLdap(users: Record<string, { pw: string; mail?: string; cn?: string; memberOf?: string[] }>) {
    const calls: string[] = [];
    const make = () => ({
      bind: vi.fn(async (dn: string, pw: string) => {
        calls.push(`bind ${dn}`);
        if (dn === "cn=svc" && pw === "svcpw") return;
        const uid = /^uid=([^,]+)/.exec(dn)?.[1];
        if (!uid || users[uid]?.pw !== pw) throw new Error("Invalid credentials");
      }),
      search: vi.fn(async (_base: string, opts: { filter: string }) => {
        calls.push(`search ${opts.filter}`);
        const uid = /\(uid=(.*)\)/.exec(opts.filter)?.[1] ?? "";
        const u = users[uid];
        return { searchEntries: u ? [{ dn: `uid=${uid},ou=people,dc=x`, mail: u.mail, cn: u.cn, memberOf: u.memberOf }] : [] };
      }),
      unbind: vi.fn(async () => {}),
    });
    return { calls, makeClient: make as never };
  }

  it("escapes filter metacharacters", () => {
    expect(escapeFilter("a*)(uid=*")).toBe("a\\2a\\29\\28uid=\\2a");
  });

  it("binds as service, searches, then binds as the user", async () => {
    const l = fakeLdap({ carol: { pw: "pw", mail: "carol@x", cn: "Carol", memberOf: ["cn=admins"] } });
    const id = await ldapAuthenticate(cfg, "carol", "pw", l.makeClient);
    expect(id).toMatchObject({ provider: "ldap", subject: "uid=carol,ou=people,dc=x", email: "carol@x", name: "Carol", groups: ["cn=admins"] });
    expect(l.calls).toEqual(["bind cn=svc", "search (uid=carol)", "bind uid=carol,ou=people,dc=x"]);
  });

  it("rejects wrong passwords, unknown users and empty passwords (anonymous bind)", async () => {
    const l = fakeLdap({ carol: { pw: "pw" } });
    expect(await ldapAuthenticate(cfg, "carol", "nope", l.makeClient)).toBeNull();
    expect(await ldapAuthenticate(cfg, "dave", "pw", l.makeClient)).toBeNull();
    expect(await ldapAuthenticate(cfg, "carol", "", l.makeClient)).toBeNull();
  });
});

describe("visibility", () => {
  it("applies roles and publicView", () => {
    expect(canSee("anon", "public", true)).toBe(true);
    expect(canSee("anon", "public", false)).toBe(false);
    expect(canSee("anon", "users", true)).toBe(false);
    expect(canSee("user", "users", true)).toBe(true);
    expect(canSee("user", "admins", true)).toBe(false);
    expect(canSee("admin", "admins", false)).toBe(true);
  });

  it("filters groups, services, bookmarks and widgets, with groups restricting their services", () => {
    const services = servicesFileSchema.parse([
      { name: "Open", services: [{ name: "A" }, { name: "B", visible: "admins" }] },
      { name: "Private", visible: "users", services: [{ name: "C" }] },
    ]);
    const cfg = {
      settings: settingsSchema.parse({}),
      services,
      bookmarks: [{ name: "Links", visible: "users" as const, links: [] }],
      widgets: [{ type: "greeting" }, { type: "resources", visible: "admins" as const }],
      errors: ["boom"],
    };
    const anon = sanitize(cfg, (v) => canSee("anon", v, true));
    expect(anon.services.map((g) => [g.name, g.services.map((s) => s.name)])).toEqual([["Open", ["A"]]]);
    expect(anon.bookmarks).toEqual([]);
    expect(anon.widgets.map((w) => [w.type, w.index])).toEqual([["greeting", 0]]);
    expect(anon.errors).toEqual([]);

    const user = sanitize(cfg, (v) => canSee("user", v, true));
    expect(user.services.map((g) => g.name)).toEqual(["Open", "Private"]);
    // Ids don't depend on what is visible.
    expect(user.services[1].services[0].id).toBe("private.c");

    const admin = sanitize(cfg, (v) => canSee("admin", v, true));
    expect(admin.services[0].services.map((s) => s.name)).toEqual(["A", "B"]);
    expect(admin.widgets.map((w) => w.index)).toEqual([0, 1]);
    expect(admin.errors).toEqual(["boom"]);
    expect(JSON.stringify(admin.settings)).not.toContain("auth");
  });

  it("masks auth secrets for the editor", () => {
    const s = maskRaw("settings", {
      auth: {
        providers: [{ id: "g", type: "google", clientId: "cid", clientSecret: "SHH" }],
        ldap: { bindPassword: "SHH2", bindDN: "cn=svc" },
        proxy: { secret: "{{HOMEPAGE_VAR_PROXY}}" },
      },
    }) as { auth: { providers: { clientSecret: string; clientId: string }[]; ldap: Record<string, string>; proxy: Record<string, string> } };
    expect(s.auth.providers[0]).toMatchObject({ clientId: "cid", clientSecret: MASK });
    expect(s.auth.ldap).toEqual({ bindPassword: MASK, bindDN: "cn=svc" });
    expect(s.auth.proxy.secret).toBe("{{HOMEPAGE_VAR_PROXY}}");
  });
});
