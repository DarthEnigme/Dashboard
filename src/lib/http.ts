import { TransformStream } from "node:stream/web";
import { Agent, fetch as undiciFetch, Response, type BodyInit, type RequestInit } from "undici";

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

/** No integration needs more; a service that sends more is broken, or is the wrong URL (a video stream, a download). */
const MAX_BYTES = 10 * 1024 * 1024;

export interface HttpOptions extends Omit<RequestInit, "dispatcher" | "signal"> {
  insecure?: boolean;
  timeoutMs?: number;
  /** Largest body to read (default 10 MB). Reading more fails, unless `truncate` is set. */
  maxBytes?: number;
  /** Past `maxBytes`, end the body there (for checks that only look for text in it). */
  truncate?: boolean;
}

/** Passes a body through until `max` bytes, then fails (or just ends, with `truncate`). */
function limit(max: number, truncate: boolean, host: string) {
  let seen = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const room = max - seen;
      seen += chunk.byteLength;
      if (seen <= max) return controller.enqueue(chunk);
      if (!truncate) return controller.error(new Error(`The response from ${host} is larger than ${Math.round(max / 1024 / 1024)} MB`));
      if (room > 0) controller.enqueue(chunk.subarray(0, room));
      controller.terminate();
    },
  });
}

export async function http(url: string, { insecure, timeoutMs = 8000, maxBytes = MAX_BYTES, truncate = false, ...init }: HttpOptions = {}) {
  const res = await undiciFetch(url, {
    ...init,
    dispatcher: insecure ? insecureAgent : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.body) return res;
  // undici types its body stream more loosely than node:stream/web does; the chunks are bytes.
  const body = (res.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>).pipeThrough(limit(maxBytes, truncate, new URL(url).host));
  return new Response(body as unknown as BodyInit, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await http(url, { ...opts, headers: { Accept: "application/json", ...(opts.headers as Record<string, string>) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

export const trimSlash = (u: string) => u.replace(/\/+$/, "");
