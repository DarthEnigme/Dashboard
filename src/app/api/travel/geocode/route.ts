import { NextResponse } from "next/server";
import { httpJson } from "@/lib/http";
import { cached } from "@/lib/cache";
import { getLocale } from "@/i18n/server";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** Open-Meteo's place search (no key); PAGE_GEOCODER_URL points tests at a mock. */
const BASE = process.env.PAGE_GEOCODER_URL ?? "https://geocoding-api.open-meteo.com";

interface OmResult {
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  country?: string;
  admin1?: string;
  population?: number;
}

/** ?q=lisbon: up to 8 places with country code and coordinates, biggest first. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json([]);
  const lang = await getLocale();
  try {
    const r = await cached(`geocode|${lang}|${q.toLowerCase()}`, 3_600_000, () =>
      httpJson<{ results?: OmResult[] }>(`${BASE}/v1/search?${new URLSearchParams({ name: q, count: "8", language: lang, format: "json" })}`, { timeoutMs: 6000 }),
    );
    return NextResponse.json(
      (r.results ?? [])
        .filter((p) => p.country_code)
        .map((p) => ({ name: p.name, country: p.country_code!.toUpperCase(), region: p.admin1 ?? null, lat: p.latitude, lon: p.longitude })),
    );
  } catch (e) {
    return NextResponse.json({ error: `Place search is unavailable: ${(e as Error).message}` }, { status: 502 });
  }
}
