import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, newRecoveryCodes, openSecret, sealSecret, totpCode, useRecoveryCode, verifyTotp } from "@/lib/auth/totp";
import { checkSession, createResetToken, createSession, listSessions, resetTokenUser, revokeSession, revokeUserSessions, SHORT_MS } from "@/lib/auth/sessions";
import { createGroup, groupsOf, listGroups, setManualGroups, syncSsoGroups, updateGroup } from "@/lib/auth/groups";
import { createUser, getTwoFactor, getUser, setTwoFactor } from "@/lib/auth/users";
import { canSee } from "@/lib/auth";
import { sanitize } from "@/lib/config/sanitize";
import { settingsSchema, servicesFileSchema } from "@/lib/config/schema";
import { db } from "@/lib/db";

describe("totp", () => {
  // RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (6 low digits of the 8-digit values).
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the RFC test vectors", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(secret, 2_000_000_000_000)).toBe("279037");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });

  it("accepts one step of clock drift, not two, and only six digits", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 60_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });

  it("seals the secret so the database alone can't read it", () => {
    const sealed = sealSecret(secret);
    expect(sealed).not.toContain(secret);
    expect(openSecret(sealed)).toBe(secret);
    expect(openSecret(sealed.slice(0, -3) + "AAA")).toBeUndefined();
  });

  it("recovery codes work once each, in any case or spacing", () => {
    const { codes, hashes } = newRecoveryCodes(3);
    expect(codes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const left = useRecoveryCode(hashes, codes[1].toLowerCase().replace("-", " "))!;
    expect(left).toHaveLength(2);
    expect(useRecoveryCode(left, codes[1])).toBeUndefined();
  });

  it("stores 2FA on the user", () => {
    const u = createUser({ username: "tf", role: "user" });
    expect(getUser(u.id)?.twoFactor).toBe(false);
    setTwoFactor(u.id, { secret: sealSecret(secret), recovery: ["a"] });
    expect(getUser(u.id)?.twoFactor).toBe(true);
    expect(getTwoFactor(u.id)?.recovery).toEqual(["a"]);
  });
});

describe("sessions", () => {
  it("can be listed and revoked, one or all but the current", () => {
    const u = createUser({ username: "sess", role: "user" });
    const a = createSession(u.id, { method: "password", remember: true, ip: "10.0.0.2", userAgent: "Firefox" });
    const b = createSession(u.id, { method: "password", remember: false });
    expect(checkSession(a.id, u.id)).toBe(true);
    expect(checkSession(a.id, u.id + 1)).toBe(false); // someone else's session id
    expect(listSessions(u.id)).toHaveLength(2);
    expect(revokeSession(b.id, u.id)).toBe(true);
    expect(checkSession(b.id, u.id)).toBe(false);
    createSession(u.id, { method: "sso", remember: true });
    expect(revokeUserSessions(u.id, a.id)).toBe(1);
    expect(listSessions(u.id).map((s) => s.id)).toEqual([a.id]);
  });

  it("ends short sessions after 12 idle hours", () => {
    const u = createUser({ username: "short", role: "user" });
    const s = createSession(u.id, { method: "password", remember: false });
    expect(s.expires_at - s.created_at).toBe(SHORT_MS);
    db().prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(Date.now() - 1, s.id);
    expect(checkSession(s.id, u.id)).toBe(false);
  });

  it("reset links work once", () => {
    const u = createUser({ username: "reset", role: "user" });
    const t = createResetToken(u.id, "admin");
    expect(resetTokenUser(t)).toBe(u.id);
    expect(resetTokenUser(t, true)).toBe(u.id);
    expect(resetTokenUser(t)).toBeUndefined();
    expect(resetTokenUser("nope")).toBeUndefined();
  });
});

describe("groups", () => {
  it("adds members by hand and from SSO groups, keeping the two apart", () => {
    createGroup({ name: "Family", permissions: ["finance"], sso: ["home-users"] });
    createGroup({ name: "Media", permissions: ["actions"], sso: ["cn=media,ou=groups"] });
    expect(() => createGroup({ name: "admins" })).toThrow(/reserved/);
    const u = createUser({ username: "grp", role: "user" });

    setManualGroups(u.id, ["media"]);
    syncSsoGroups(u.id, ["HOME-USERS"]);
    expect(groupsOf(u.id).map((g) => [g.name, g.source])).toEqual([
      ["Family", "sso"],
      ["Media", "manual"],
    ]);
    // Leaving the SSO group removes only what SSO added.
    syncSsoGroups(u.id, ["CN=Media,OU=Groups"]);
    expect(groupsOf(u.id).map((g) => [g.name, g.source])).toEqual([["Media", "manual"]]);
    syncSsoGroups(u.id, []);
    expect(groupsOf(u.id).map((g) => g.name)).toEqual(["Media"]);
    expect(() => setManualGroups(u.id, ["nope"])).toThrow(/No such group/);

    const family = listGroups().find((g) => g.name === "Family")!;
    updateGroup(family.id, { permissions: ["finance", "actions"] });
    expect(listGroups().find((g) => g.id === family.id)?.permissions).toEqual(["finance", "actions"]);
  });

  it("lets group members (and admins) see items shown to their groups", () => {
    const member = { role: "user" as const, groups: ["family"] };
    expect(canSee(member, ["Family", "media"], true)).toBe(true);
    expect(canSee({ role: "user", groups: ["kids"] }, ["family"], true)).toBe(false);
    expect(canSee({ role: "anon", groups: [] }, ["family"], true)).toBe(false);
    expect(canSee({ role: "admin", groups: [] }, ["family"], true)).toBe(true);
    expect(canSee("user", "users", true)).toBe(true);
  });

  it("filters the dashboard by group, with a group's and a service's audience both applying", () => {
    const services = servicesFileSchema.parse([
      { name: "Kids", visible: ["family"], services: [{ name: "Tablet time" }, { name: "Admin only", visible: "admins" }] },
      { name: "Media", services: [{ name: "Plex", visible: ["media"] }, { name: "Status" }] },
    ]);
    const cfg = { settings: settingsSchema.parse({}), services, bookmarks: [], widgets: [], errors: [] };
    const view = (groups: string[]) =>
      sanitize(cfg, (v) => canSee({ role: "user", groups }, v, true)).services.map((g) => `${g.name}: ${g.services.map((s) => s.name).join(", ")}`);
    expect(view(["family"])).toEqual(["Kids: Tablet time", "Media: Status"]);
    expect(view(["media"])).toEqual(["Media: Plex, Status"]);
  });

  it("accepts group lists in visible:, not other words", () => {
    expect(servicesFileSchema.safeParse([{ name: "G", visible: ["family"], services: [] }]).success).toBe(true);
    expect(servicesFileSchema.safeParse([{ name: "G", visible: "family", services: [] }]).success).toBe(false);
    expect(settingsSchema.parse({}).auth.userPermissions).toEqual(["finance", "travel", "watchlist"]);
  });
});
