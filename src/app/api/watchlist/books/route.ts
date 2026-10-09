import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";
import { httpJson } from "@/lib/http";
import { cached } from "@/lib/cache";
import { parseOpenLibrary } from "@/lib/watchlist/store";

export const dynamic = "force-dynamic";

/** Open Library (free, no key); PAGE_OPENLIBRARY_URL and _COVERS_URL point tests at a mock. */
const BASE = process.env.PAGE_OPENLIBRARY_URL ?? "https://openlibrary.org";
const COVERS = process.env.PAGE_OPENLIBRARY_COVERS_URL ?? "https://covers.openlibrary.org";

/** ?q=dune: books with author, first year, pages and cover. */
export async function GET(req: Request) {
  const g = await guardPermission("watchlist", undefined, "the watchlist");
  if ("error" in g) return g.error;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json([]);
  try {
    const r = await cached(`openlibrary|${q.toLowerCase()}`, 3_600_000, () =>
      httpJson<{ docs?: [] }>(`${BASE}/search.json?${new URLSearchParams({ q, limit: "10", fields: "key,title,author_name,first_publish_year,number_of_pages_median,cover_i" })}`, {
        timeoutMs: 8000,
        headers: { "User-Agent": "Page dashboard (https://github.com/DarthEnigme/Dashboard)" },
      }),
    );
    return NextResponse.json(parseOpenLibrary(r, COVERS));
  } catch (e) {
    return NextResponse.json({ error: `Book search is unavailable: ${(e as Error).message}` }, { status: 502 });
  }
}
