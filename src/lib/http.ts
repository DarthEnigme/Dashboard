import { Agent, fetch as undiciFetch, type RequestInit } from "undici";

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export interface HttpOptions extends Omit<RequestInit, "dispatcher" | "signal"> {
  insecure?: boolean;
  timeoutMs?: number;
}

export function http(url: string, { insecure, timeoutMs = 8000, ...init }: HttpOptions = {}) {
  return undiciFetch(url, {
    ...init,
    dispatcher: insecure ? insecureAgent : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await http(url, { ...opts, headers: { Accept: "application/json", ...(opts.headers as Record<string, string>) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

export const trimSlash = (u: string) => u.replace(/\/+$/, "");
