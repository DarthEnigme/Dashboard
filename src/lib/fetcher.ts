export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

let localConfigWrite = 0;
/** When this tab last wrote config: live reload skips the echo of its own saves. */
export const lastLocalConfigWrite = () => localConfigWrite;

export async function sendJson<T = unknown>(url: string, method: string, data?: unknown): Promise<T> {
  if (method !== "GET" && url.startsWith("/api/config")) localConfigWrite = Date.now();
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}
