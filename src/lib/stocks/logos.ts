import { db } from "../db";
import { http } from "../http";
import { loadConfig } from "../config/load";
import { sniffImage } from "../uploads";
import { cached } from "../cache";
import { companyOf } from "./service";

/**
 * Company logos, by symbol: one a person uploaded for themselves first, else one fetched for
 * everyone (the company website's icon, or `stocks.logoSource`), kept a month. Not finding one is
 * kept too, so the page shows its monogram without asking again.
 */

const SHARED = 0;
const MONTH = 30 * 86_400_000;
const MAX_BYTES = 512 * 1024;
const MIME = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" } as const;

export interface Logo {
  mime: string;
  data: Uint8Array;
}

type Row = { mime: string | null; data: Uint8Array | null; at: number };
const row = (symbol: string, owner: number) => db().prepare("SELECT mime, data, at FROM stock_logos WHERE symbol = ? AND owner_id = ?").get(symbol, owner) as Row | undefined;
const save = (symbol: string, owner: number, logo: Logo | null, source: string) =>
  db().prepare("INSERT OR REPLACE INTO stock_logos (symbol, owner_id, mime, data, source, at) VALUES (?, ?, ?, ?, ?, ?)").run(symbol, owner, logo?.mime ?? null, logo?.data ?? null, source, Date.now());
const asLogo = (r: Row | undefined): Logo | null => (r?.data && r.mime ? { mime: r.mime, data: r.data } : null);

/** An image's type from its bytes, or null for anything that isn't a plain image. */
export function imageOf(bytes: Uint8Array): Logo | null {
  const ext = sniffImage(bytes);
  return ext ? { mime: MIME[ext], data: bytes } : null;
}

/** Where to ask for a logo: the configured template, else the website's icon (from Yahoo's profile). */
export async function logoUrl(symbol: string): Promise<string | null> {
  const website = (await companyOf(symbol))?.profile?.website;
  const domain = website ? new URL(website.includes("://") ? website : `https://${website}`).hostname.replace(/^www\./, "") : null;
  const template = process.env.PAGE_LOGO_URL ?? loadConfig().settings.stocks.logoSource;
  if (template) return template.includes("{domain}") && !domain ? null : template.replace("{symbol}", encodeURIComponent(symbol)).replace("{domain}", domain ?? "");
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null;
}

async function fetchLogo(symbol: string): Promise<Logo | null> {
  const url = await logoUrl(symbol).catch(() => null);
  if (!url) return null;
  try {
    const res = await http(url, { timeoutMs: 8000, maxBytes: MAX_BYTES });
    return res.ok ? imageOf(new Uint8Array(await res.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

/** The logo `userId` sees for `symbol`, or null (draw a monogram). */
export async function logoFor(symbol: string, userId: number): Promise<Logo | null> {
  const own = asLogo(row(symbol, userId));
  if (own) return own;
  const shared = row(symbol, SHARED);
  if (shared && Date.now() - shared.at < MONTH) return asLogo(shared);
  // Several icons on a page ask at once: one fetch per symbol.
  return cached(`stock-logo:${symbol}`, 60_000, async () => {
    const logo = await fetchLogo(symbol);
    // A failed fetch keeps an older logo rather than forgetting it.
    if (logo || !shared) save(symbol, SHARED, logo, "fetched");
    return logo ?? asLogo(shared);
  });
}

/** A logo of one's own for a symbol (any plain image), or null to go back to the fetched one. */
export function setOwnLogo(symbol: string, userId: number, bytes: Uint8Array | null) {
  if (!bytes) {
    db().prepare("DELETE FROM stock_logos WHERE symbol = ? AND owner_id = ?").run(symbol, userId);
    return;
  }
  if (bytes.length > MAX_BYTES) throw new Error("A logo can be up to 512 KB");
  const logo = imageOf(bytes) ?? fail();
  save(symbol, userId, logo, "upload");
}

const fail = (): never => {
  throw new Error("Not a supported image (PNG, JPEG, WebP, GIF or AVIF)");
};
