import { http, httpJson, trimSlash } from "@/lib/http";

/** How NanoDash talks to Yahoo: a browser-like user agent, a mock in tests, and the session some endpoints need. */

// Yahoo rejects requests without a browser-like user agent.
// (It also rate-limits some UA strings, e.g. Linux Chrome, so this one is deliberate.)
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/** PAGE_YAHOO_URL points tests at a mock. */
export const base = () => trimSlash(process.env.PAGE_YAHOO_URL ?? "https://query1.finance.yahoo.com");
export const get = <T>(path: string, headers: Record<string, string> = {}) => httpJson<T>(`${base()}${path}`, { headers: { "User-Agent": UA, ...headers }, timeoutMs: 12_000 });

export const dayOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

// ---------- the session (cookie + crumb) the quote summary asks for ----------

interface Session {
  cookie: string;
  crumb: string;
}
let session: Promise<Session> | undefined;

/** Yahoo hands out its cookie on any page of fc.yahoo.com (even a 404), and a crumb for that cookie. */
async function openSession(): Promise<Session> {
  const cookieUrl = process.env.PAGE_YAHOO_URL ? `${base()}/cookie` : "https://fc.yahoo.com";
  const res = await http(cookieUrl, { headers: { "User-Agent": UA }, redirect: "manual", timeoutMs: 12_000 });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Yahoo gave no session cookie");
  const crumbRes = await http(`${base()}/v1/test/getcrumb`, { headers: { "User-Agent": UA, Cookie: cookie }, timeoutMs: 12_000 });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.includes("<")) throw new Error(`Yahoo gave no crumb (HTTP ${crumbRes.status})`);
  return { cookie, crumb };
}

/** GET with the session; a refused session is opened again once. */
export async function getWithSession<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const current = (session ??= openSession().catch((e) => {
      session = undefined;
      throw e;
    }));
    const s = await current;
    try {
      return await get<T>(`${path}${path.includes("?") ? "&" : "?"}crumb=${encodeURIComponent(s.crumb)}`, { Cookie: s.cookie });
    } catch (e) {
      if (attempt > 0 || !/HTTP 40[13]/.test((e as Error).message)) throw e;
      session = undefined;
    }
  }
}
