import { loadConfig } from "@/lib/config/load";
import { configVersion, onConfigChange } from "@/lib/config/watch";
import { viewer } from "@/lib/auth";
import { buildInfo } from "@/lib/version";
import { onUpdateProgress } from "@/lib/update/apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events, so open dashboards refresh themselves: "version" on connect (the page compares it
 * with the version it was rendered with) and "config" whenever a config file changes. Also "build" on
 * connect (a different build means Page itself was updated) and "update" while an update installs.
 */
export async function GET(req: Request) {
  const { settings } = loadConfig();
  if (!settings.auth.publicView && (await viewer()).role === "anon") return new Response("Unauthorized", { status: 401 });

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const build = buildInfo();
      send(`retry: 3000\nevent: version\ndata: ${configVersion()}\n\n`);
      send(`event: build\ndata: ${JSON.stringify({ id: build.buildId, version: build.version })}\n\n`);
      const offConfig = onConfigChange((c) => send(`event: config\ndata: ${JSON.stringify(c)}\n\n`));
      const offUpdate = onUpdateProgress((p) => send(`event: update\ndata: ${JSON.stringify({ phase: p.phase, percent: p.percent, target: p.target })}\n\n`));
      const off = () => {
        offConfig();
        offUpdate();
      };
      const ping = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        off();
        clearInterval(ping);
        cleanup = () => {};
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
