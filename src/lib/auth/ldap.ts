import { Client } from "ldapts";
import type { AuthConfig } from "../config/schema";
import type { ExternalIdentity } from "./identity";

/** RFC 4515 escaping so a username can't change the search filter. */
export function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

const first = (v: unknown): string | undefined =>
  Array.isArray(v) ? (v[0] as string | undefined)?.toString() : v == null ? undefined : String(v);
const all = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

type Ldap = AuthConfig["ldap"];

/**
 * Service-account bind → search for the user → bind as the user with their password.
 * Returns null for unknown users or wrong passwords; throws on configuration/connection errors.
 */
export async function ldapAuthenticate(cfg: Ldap, username: string, password: string, makeClient = (url: string) => new Client({
  url,
  timeout: 8000,
  connectTimeout: 8000,
  tlsOptions: { rejectUnauthorized: !cfg.insecure },
})): Promise<ExternalIdentity | null> {
  // An empty password would be an anonymous bind, which most servers accept.
  if (!password || !username) return null;
  if (!cfg.url || !cfg.baseDN) throw new Error("LDAP is enabled but url/baseDN are not set");

  const service = makeClient(cfg.url);
  let dn: string;
  let entry: Record<string, unknown>;
  try {
    if (cfg.bindDN) await service.bind(cfg.bindDN, cfg.bindPassword ?? "");
    const filter = cfg.userFilter.replaceAll("{{username}}", escapeFilter(username));
    const { searchEntries } = await service.search(cfg.baseDN, {
      scope: "sub",
      filter,
      sizeLimit: 2,
      attributes: ["dn", cfg.emailAttribute, cfg.nameAttribute, "memberOf"],
    });
    if (searchEntries.length !== 1) return null;
    entry = searchEntries[0] as Record<string, unknown>;
    dn = String(entry.dn);
  } finally {
    await service.unbind().catch(() => {});
  }

  const user = makeClient(cfg.url);
  try {
    await user.bind(dn, password);
  } catch {
    return null;
  } finally {
    await user.unbind().catch(() => {});
  }

  return {
    provider: "ldap",
    subject: dn,
    username,
    email: first(entry[cfg.emailAttribute]),
    emailVerified: true, // the directory is authoritative
    name: first(entry[cfg.nameAttribute]),
    groups: all(entry.memberOf),
  };
}
