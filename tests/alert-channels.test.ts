import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasAlertChannel, sendNotice } from "@/lib/alerts";

describe("gotify and ntfy channels", () => {
  let server: http.Server;
  let base = "";
  const got: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        got.push({ url: req.url ?? "", headers: req.headers, body });
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("knows when a channel is configured", () => {
    expect(hasAlertChannel({ threshold: 2, certDays: 14 })).toBe(false);
    expect(hasAlertChannel({ threshold: 2, certDays: 14, gotify: "http://g" })).toBe(false); // needs a token
    expect(hasAlertChannel({ threshold: 2, certDays: 14, ntfy: "http://n/topic" })).toBe(true);
  });

  it("posts with the right priority, title and token", async () => {
    const errors = await sendNotice(
      { threshold: 2, certDays: 14, gotify: `${base}/`, gotifyToken: "AppTok", ntfy: `${base}/homelab`, ntfyToken: "tk_1" },
      { kind: "cert", level: "error", message: "NAS: the TLS certificate expired.", url: "https://nas" },
    );
    expect(errors).toEqual([]);
    const gotify = got.find((g) => g.url.startsWith("/message"))!;
    expect(gotify.url).toBe("/message?token=AppTok");
    expect(JSON.parse(gotify.body)).toEqual({ title: "Page", message: "NAS: the TLS certificate expired.\nhttps://nas", priority: 8 });
    const ntfy = got.find((g) => g.url === "/homelab")!;
    expect(ntfy.body).toBe("NAS: the TLS certificate expired.");
    expect(ntfy.headers).toMatchObject({ title: "Page", priority: "5", tags: "rotating_light", click: "https://nas", authorization: "Bearer tk_1" });
  });
});
