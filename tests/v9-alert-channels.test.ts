import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** A minimal SMTP server: accepts one mail per connection and keeps the commands and the message. */
function fakeSmtp() {
  const mails: { commands: string[]; data: string }[] = [];
  const server = net.createServer((sock) => {
    const mail = { commands: [] as string[], data: "" };
    let inData = false;
    let buf = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            mails.push(mail);
            sock.write("250 queued\r\n");
          } else mail.data += `${line}\n`;
          continue;
        }
        mail.commands.push(line);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") sock.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (cmd === "AUTH") sock.write("235 ok\r\n");
        else if (cmd === "DATA") {
          inData = true;
          sock.write("354 go\r\n");
        } else if (cmd === "QUIT") sock.end("221 bye\r\n");
        else sock.write("250 ok\r\n");
      }
    });
  });
  return { server, mails };
}

describe("email, Pushover and Matrix alerts", () => {
  const smtp = fakeSmtp();
  let api: http.Server;
  let base = "";
  let smtpPort = 0;
  const calls: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  let alerts: typeof import("@/lib/alerts");

  beforeAll(async () => {
    api = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
        res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => smtp.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    smtpPort = (smtp.server.address() as AddressInfo).port;
    process.env.PAGE_PUSHOVER_URL = `${base}/pushover`;
    alerts = await import("@/lib/alerts");
  });
  afterAll(() => {
    api.close();
    smtp.server.close();
  });

  it("counts the new channels as configured", () => {
    const base = { threshold: 2, certDays: 14 };
    expect(alerts.hasAlertChannel({ ...base, email: { host: "smtp", port: 587, from: "a@b.c", to: "d@e.f" } })).toBe(true);
    expect(alerts.hasAlertChannel({ ...base, pushoverToken: "t" })).toBe(false);
    expect(alerts.hasAlertChannel({ ...base, pushoverToken: "t", pushoverUser: "u" })).toBe(true);
    expect(alerts.hasAlertChannel({ ...base, matrix: "https://m", matrixToken: "t" })).toBe(false);
  });

  it("sends to all three", async () => {
    const errors = await alerts.sendNotice(
      {
        threshold: 2,
        certDays: 14,
        title: "Homelab",
        email: { host: "127.0.0.1", port: smtpPort, secure: false, user: "page", password: "pw", from: "page@example.com", to: "me@example.com" },
        pushoverToken: "apptok",
        pushoverUser: "userkey",
        matrix: `${base}/matrix/`,
        matrixToken: "mxtok",
        matrixRoom: "!room:example.org",
      },
      { kind: "cert", level: "error", message: "NAS: the TLS certificate expired.", url: "https://nas" },
    );
    expect(errors).toEqual([]);

    expect(smtp.mails).toHaveLength(1);
    const mail = smtp.mails[0];
    expect(mail.commands.some((c) => c.startsWith("AUTH"))).toBe(true);
    expect(mail.commands).toContain("RCPT TO:<me@example.com>");
    expect(mail.data).toMatch(/^Subject: \[Homelab\] NAS: the TLS certificate expired\.$/m);
    expect(mail.data).toMatch(/^From: "?Homelab"? <page@example\.com>$/m);
    expect(mail.data).toContain("https://nas");

    const push = calls.find((c) => c.url === "/pushover/1/messages.json")!;
    expect(Object.fromEntries(new URLSearchParams(push.body))).toEqual({ token: "apptok", user: "userkey", title: "Homelab", message: "NAS: the TLS certificate expired.", priority: "1", url: "https://nas" });

    const mx = calls.find((c) => c.url.startsWith("/matrix/_matrix/"))!;
    expect(mx.method).toBe("PUT");
    expect(mx.url).toMatch(/^\/matrix\/_matrix\/client\/v3\/rooms\/!room%3Aexample\.org\/send\/m\.room\.message\/page-\d+-\w+$/);
    expect(mx.headers.authorization).toBe("Bearer mxtok");
    expect(JSON.parse(mx.body)).toEqual({ msgtype: "m.text", body: "NAS: the TLS certificate expired.\nhttps://nas" });
  });

  it("reports a channel that fails, and still sends the others", async () => {
    const errors = await alerts.sendNotice(
      { threshold: 2, certDays: 14, email: { host: "127.0.0.1", port: 1, from: "a@b.c", to: "d@e.f" }, pushoverToken: "t", pushoverUser: "u" },
      { kind: "update", level: "info", message: "Page 1.0 is out" },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Email: /);
    expect(calls.filter((c) => c.url.startsWith("/pushover")).length).toBe(2);
  });
});
