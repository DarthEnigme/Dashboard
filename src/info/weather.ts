import { z } from "zod";
import { httpJson } from "@/lib/http";
import type { InfoProvider, WeatherData } from "./types";

const schema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  units: z.enum(["metric", "imperial"]).default("metric"),
  label: z.string().optional(),
});

export interface OpenMeteoResponse {
  current: { temperature_2m: number; weather_code: number; is_day: number; wind_speed_10m: number };
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
}

export function parseOpenMeteo(r: OpenMeteoResponse, cfg: z.infer<typeof schema>): WeatherData {
  return {
    label: cfg.label,
    temp: Math.round(r.current.temperature_2m),
    high: Math.round(r.daily.temperature_2m_max[0]),
    low: Math.round(r.daily.temperature_2m_min[0]),
    wind: Math.round(r.current.wind_speed_10m),
    code: r.current.weather_code,
    isDay: r.current.is_day === 1,
    units: cfg.units,
  };
}

export const weather: InfoProvider<typeof schema, WeatherData> = {
  type: "weather",
  schema,
  ttlMs: 10 * 60_000,
  async fetch(cfg) {
    const q = new URLSearchParams({
      latitude: String(cfg.latitude),
      longitude: String(cfg.longitude),
      current: "temperature_2m,weather_code,is_day,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min",
      forecast_days: "1",
      timezone: "auto",
      ...(cfg.units === "imperial" ? { temperature_unit: "fahrenheit", wind_speed_unit: "mph" } : {}),
    });
    return parseOpenMeteo(await httpJson<OpenMeteoResponse>(`https://api.open-meteo.com/v1/forecast?${q}`), cfg);
  },
};
