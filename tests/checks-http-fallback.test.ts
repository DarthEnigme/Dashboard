import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCheck } from "@/lib/checks";

describe("http check GET fallback", () => {
  let web: http.Server;
  let base: string;

  beforeAll(async () => {
    web = http.createServer((req, res) => {
      if (req.method === "HEAD") {
        // A server that answers HEAD late with 405, as some do.
        setTimeout(() => {
          res.writeHead(405);
          res.end();
        }, 400);
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      }
    });
    await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => web.close(() => resolve()));
  });

  it("falls back to GET and reports only that reply's latency", async () => {
    const result = await runCheck({ type: "http", url: base, insecure: true });
    expect(result).toMatchObject({ up: true, status: 200 });
    // The HEAD round trip waited 400 ms; the reported latency must not include it.
    expect(result.latencyMs).toBeLessThan(300);
  });
});
