import type { FieldStatus } from "./types";

export const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

export const loadStatus = (ratio: number): FieldStatus =>
  ratio >= 0.9 ? "error" : ratio >= 0.75 ? "warn" : "ok";

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${Math.max(m, 0)}m`;
}

export function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${units[i]}`;
}
