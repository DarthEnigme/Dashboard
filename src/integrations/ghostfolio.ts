import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField } from "./types";

const schema = z.object({
  url: z.string().url(),
  /** The security token shown in Ghostfolio's account settings. */
  token: z.string().min(1),
  currency: z.string().optional(),
  insecure: z.boolean().optional(),
});

export interface GhostfolioPerformance {
  performance: {
    currentNetWorth?: number;
    currentValueInBaseCurrency?: number;
    currentValue?: number;
    netPerformancePercentage?: number;
    netPerformancePercentageWithCurrencyEffect?: number;
  };
}

const pctOf = (p: GhostfolioPerformance["performance"]) =>
  (p.netPerformancePercentageWithCurrencyEffect ?? p.netPerformancePercentage ?? 0) * 100;

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export function parseGhostfolio(today: GhostfolioPerformance, max: GhostfolioPerformance, currency?: string): WidgetField[] {
  const worth = today.performance.currentNetWorth ?? today.performance.currentValueInBaseCurrency ?? today.performance.currentValue ?? 0;
  const value = currency
    ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(worth)
    : Math.round(worth).toLocaleString("en-US");
  const d = pctOf(today.performance);
  const t = pctOf(max.performance);
  return [
    { label: "Net worth", value },
    { label: "Today", value: signed(d), status: d < 0 ? "error" : "ok" },
    { label: "Total return", value: signed(t), status: t < 0 ? "error" : "ok" },
  ];
}

const jwts = new Map<string, { jwt: string; at: number }>();
const JWT_TTL = 60 * 60_000;

async function authToken(cfg: z.infer<typeof schema>): Promise<string> {
  const hit = jwts.get(cfg.url + cfg.token);
  if (hit && Date.now() - hit.at < JWT_TTL) return hit.jwt;
  const { authToken } = await httpJson<{ authToken: string }>(`${trimSlash(cfg.url)}/api/v1/auth/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken: cfg.token }),
    insecure: cfg.insecure,
  });
  jwts.set(cfg.url + cfg.token, { jwt: authToken, at: Date.now() });
  return authToken;
}

export const ghostfolio: Integration<typeof schema> = {
  type: "ghostfolio",
  schema,
  async fetch(cfg) {
    const jwt = await authToken(cfg);
    const perf = (range: string) =>
      httpJson<GhostfolioPerformance>(`${trimSlash(cfg.url)}/api/v2/portfolio/performance?range=${range}`, {
        insecure: cfg.insecure,
        headers: { Authorization: `Bearer ${jwt}` },
      });
    const [today, max] = await Promise.all([perf("1d"), perf("max")]);
    return parseGhostfolio(today, max, cfg.currency);
  },
};
