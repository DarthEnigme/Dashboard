import { http } from "./http";
import type { Settings } from "./config/schema";
import { duration } from "@/integrations/format";

export interface AlertState {
  failures: number;
  down: boolean;
  /** First failed check of the current outage. */
  since?: number;
}

export type AlertEvent = { kind: "down"; since: number } | { kind: "recovered"; since: number; durationMs: number };

/**
 * One check result in, maybe one event out. DOWN fires after `threshold` consecutive failures;
 * RECOVERED fires on the first success after a DOWN.
 */
export function evaluate(
  state: AlertState,
  up: boolean,
  threshold: number,
  now: number,
): { state: AlertState; event?: AlertEvent } {
  if (up) {
    const fresh: AlertState = { failures: 0, down: false };
    if (state.down && state.since !== undefined) {
      return { state: fresh, event: { kind: "recovered", since: state.since, durationMs: now - state.since } };
    }
    return { state: fresh };
  }
  const failures = state.failures + 1;
  const since = state.since ?? now;
  if (!state.down && failures >= threshold) {
    return { state: { failures, down: true, since }, event: { kind: "down", since } };
  }
  return { state: { ...state, failures, since } };
}

export interface AlertPayload {
  service: string;
  status: "down" | "up" | "test";
  url?: string;
  since?: string;
  durationSeconds?: number;
  error?: string;
  httpStatus?: number;
}

export function describeAlert(p: AlertPayload): string {
  if (p.status === "test") return "Test alert from Page: notifications are working.";
  if (p.status === "down") {
    const why = p.httpStatus ? `HTTP ${p.httpStatus}` : p.error ?? "no response";
    return `${p.service} is DOWN (${why}).`;
  }
  const secs = Math.round(p.durationSeconds ?? 0);
  return `${p.service} is back UP after ${secs < 60 ? `${secs}s` : duration(secs)}.`;
}

type Level = "info" | "warn" | "error";

/** Is any alert channel configured? */
export const hasAlertChannel = (cfg: Settings["alerts"]) => !!(cfg.discord || cfg.webhook || (cfg.gotify && cfg.gotifyToken) || cfg.ntfy);

/**
 * Fill {{name}} placeholders; unknown names become empty. `escape` adapts values to the target (JSON strings).
 * Alerts have service, status, reason, duration, durationSeconds, since, url, error, httpStatus; notices have
 * their own fields (service, version, category…); all have message, level, kind, time and title.
 */
export function renderTemplate(tpl: string, vars: Record<string, unknown>, escape: (s: string) => string = (s) => s): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return escape(v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  });
}

const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1);

/** Send to every configured channel; resolves to the per-channel errors (empty on success). */
export async function sendAlert(cfg: Settings["alerts"], p: AlertPayload): Promise<string[]> {
  const level: Level = p.status === "down" ? "error" : "info";
  const color = p.status === "down" ? 0xf43f5e : p.status === "up" ? 0x10b981 : 0x8b5cf6;
  const builtIn = describeAlert(p);
  const secs = Math.round(p.durationSeconds ?? 0);
  const vars = {
    ...p,
    kind: p.status,
    level,
    message: builtIn,
    duration: p.durationSeconds === undefined ? "" : secs < 60 ? `${secs}s` : duration(secs),
    reason: p.httpStatus ? `HTTP ${p.httpStatus}` : p.error ?? (p.status === "down" ? "no response" : ""),
  };
  const tpl = p.status === "down" ? cfg.messages?.down : p.status === "up" ? cfg.messages?.up : undefined;
  const text = tpl?.trim() ? renderTemplate(tpl, withCommon(cfg, vars)) : builtIn;
  return deliver(cfg, text, level, color, p.url, { ...p, message: text }, vars);
}

export interface Notice {
  /** Short machine-readable kind, e.g. "budget", "update", "cert". */
  kind: string;
  level: Level;
  message: string;
  url?: string;
  [extra: string]: unknown;
}

/** Anything that is not a service going up or down (budgets, updates, certificates…). */
export function sendNotice(cfg: Settings["alerts"], n: Notice): Promise<string[]> {
  const color = n.level === "error" ? 0xf43f5e : n.level === "warn" ? 0xf59e0b : 0x8b5cf6;
  const tpl = cfg.messages?.notice;
  const text = tpl?.trim() ? renderTemplate(tpl, withCommon(cfg, n)) : n.message;
  return deliver(cfg, text, n.level, color, n.url, { ...n, message: text }, n);
}

const senderName = (cfg: Settings["alerts"]) => cfg.title?.trim() || "Page";

const withCommon = (cfg: Settings["alerts"], vars: Record<string, unknown>) => ({ time: new Date().toISOString(), title: senderName(cfg), ...vars });

/** HTTP headers are Latin-1: anything else goes as an RFC 2047 encoded word (ntfy decodes it). */
const headerText = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

const PRIORITY = { gotify: { info: 3, warn: 5, error: 8 }, ntfy: { info: "3", warn: "4", error: "5" } } as const;
const TAGS = { info: "information_source", warn: "warning", error: "rotating_light" } as const;

async function deliver(
  cfg: Settings["alerts"],
  text: string,
  level: Level,
  color: number,
  url: string | undefined,
  webhookBody: object,
  vars: Record<string, unknown>,
): Promise<string[]> {
  const errors: string[] = [];
  const title = senderName(cfg);
  const post = async (name: string, target: string, body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) => {
    try {
      const res = await http(target, {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
        timeoutMs: 8000,
      });
      await res.body?.cancel();
      if (!res.ok) errors.push(`${name}: HTTP ${res.status}`);
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  };

  const jobs: Promise<void>[] = [];
  if (cfg.discord) {
    jobs.push(
      post("Discord", cfg.discord, {
        username: title,
        // Embed titles are capped at 256 characters; longer templates go in the description.
        embeds: [text.length > 256 ? { title, description: text.slice(0, 4000), url, color, timestamp: new Date().toISOString() } : { title: text, url, color, timestamp: new Date().toISOString() }],
      }),
    );
  }
  if (cfg.webhook) {
    const custom = cfg.webhookBody?.trim();
    jobs.push(post("Webhook", cfg.webhook, custom ? renderTemplate(custom, withCommon(cfg, { ...vars, message: text }), jsonEscape) : webhookBody));
  }
  if (cfg.gotify && cfg.gotifyToken) {
    jobs.push(
      post("Gotify", `${cfg.gotify.replace(/\/+$/, "")}/message?token=${encodeURIComponent(cfg.gotifyToken)}`, {
        title,
        message: url ? `${text}\n${url}` : text,
        priority: PRIORITY.gotify[level],
      }),
    );
  }
  if (cfg.ntfy) {
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", Title: headerText(title), Priority: PRIORITY.ntfy[level], Tags: TAGS[level] };
    if (url) headers.Click = url;
    if (cfg.ntfyToken) headers.Authorization = `Bearer ${cfg.ntfyToken}`;
    jobs.push(post("ntfy", cfg.ntfy, text, headers));
  }
  await Promise.all(jobs);
  if (!jobs.length) errors.push("No alert channel configured");
  return errors;
}
