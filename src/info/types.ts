import type { z } from "zod";

/** A server-side data source for an info bar widget. */
export interface InfoProvider<C extends z.ZodTypeAny = z.ZodTypeAny, D = unknown> {
  type: string;
  schema: C;
  ttlMs: number;
  fetch(config: z.infer<C>): Promise<D>;
}

export interface WeatherData {
  label?: string;
  temp: number;
  high: number;
  low: number;
  wind: number;
  code: number;
  isDay: boolean;
  units: "metric" | "imperial";
}

export interface ResourcesData {
  cpu: number; // 0-1
  mem: { used: number; total: number };
  disks: { mount: string; used: number; total: number }[];
  temp: number | null; // °C
  uptime: number; // seconds
}

export interface Quote {
  symbol: string;
  name?: string;
  price: number;
  change: number | null; // percent
  currency: string;
}

export interface MarketsData {
  quotes: Quote[];
  errors: string[];
}

/** Labelled numbers (Prometheus queries). */
export interface StatsData {
  label?: string;
  stats: { label: string; value: string | number; status?: "ok" | "warn" | "error" }[];
}

export interface CurrencyData {
  base: string;
  date: string;
  rates: { symbol: string; rate: number }[];
}
