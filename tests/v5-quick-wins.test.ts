import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderTemplate, sendAlert, sendNotice } from "@/lib/alerts";
import { centsToDecimal, guessMapping, mapRows, parseCsv, safeText, toCsv } from "@/lib/finance/csv";
import { convertTxns, summarize, type Txn } from "@/lib/finance/aggregate";
import { readUpload, removeUpload, saveUpload, sniffImage } from "@/lib/uploads";
import { createUser, getUser, updateUser } from "@/lib/auth/users";

describe("alert templates", () => {
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

  it("fills variables, blanks unknown ones, and escapes for JSON", () => {
    expect(renderTemplate("{{service}} is {{ status }}{{nope}}", { service: "NAS", status: "down" })).toBe("NAS is down");
    expect(renderTemplate('{"t":"{{m}}"}', { m: 'say "hi"\nnow' }, (s) => JSON.stringify(s).slice(1, -1))).toBe('{"t":"say \\"hi\\"\\nnow"}');
  });

  it("uses the down template, the sender name and a custom webhook body", async () => {
    got.length = 0;
    const errors = await sendAlert(
      {
        threshold: 2,
        certDays: 14,
        title: "Homelab ⚡",
        messages: { down: "🔴 {{service}} down: {{reason}}" },
        webhook: `${base}/hook`,
        webhookBody: '{"text":"{{message}}","who":"{{title}}","svc":"{{service}}"}',
        ntfy: `${base}/topic`,
      },
      { service: 'NAS "main"', status: "down", httpStatus: 503 },
    );
    expect(errors).toEqual([]);
    const hook = got.find((g) => g.url === "/hook")!;
    expect(JSON.parse(hook.body)).toEqual({ text: '🔴 NAS "main" down: HTTP 503', who: "Homelab ⚡", svc: 'NAS "main"' });
    const ntfy = got.find((g) => g.url === "/topic")!;
    expect(ntfy.body).toBe('🔴 NAS "main" down: HTTP 503');
    // Non-ASCII titles travel as an RFC 2047 encoded word.
    expect(ntfy.headers.title).toBe(`=?UTF-8?B?${Buffer.from("Homelab ⚡").toString("base64")}?=`);
  });

  it("keeps the built-in text without templates, and templates notices", async () => {
    got.length = 0;
    await sendAlert({ threshold: 2, certDays: 14, webhook: `${base}/plain` }, { service: "NAS", status: "up", durationSeconds: 90 });
    expect(JSON.parse(got[0].body)).toMatchObject({ service: "NAS", status: "up", message: "NAS is back UP after 1m." });
    got.length = 0;
    await sendNotice(
      { threshold: 2, certDays: 14, ntfy: `${base}/n`, messages: { notice: "[{{kind}}/{{level}}] {{message}} ({{version}})" } },
      { kind: "update", level: "info", message: "Page 0.5.0 is available.", version: "0.5.0" },
    );
    expect(got[0].body).toBe("[update/info] Page 0.5.0 is available. (0.5.0)");
  });
});

describe("finance export", () => {
  it("writes CSV that quotes when needed and neutralises formulas", () => {
    expect(toCsv([["a", 'b "q"', "c,d"], [1, null, " x"]])).toBe('a,"b ""q""","c,d"\r\n1,," x"\r\n');
    expect(safeText("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeText("Coffee")).toBe("Coffee");
    expect([centsToDecimal(-1234), centsToDecimal(5), centsToDecimal(-5), centsToDecimal(100000)]).toEqual(["-12.34", "0.05", "-0.05", "1000.00"]);
  });

  it("round-trips through the importer", () => {
    const csv = toCsv([
      ["date", "description", "amount", "currency", "category", "account", "source"],
      ["2026-10-02", "Café, Paris", centsToDecimal(-350), "EUR", "Food", "", "manual"],
      ["2026-10-03", "Salary", centsToDecimal(250000), "EUR", "", "", "csv"],
    ]);
    const rows = parseCsv(`﻿${csv}`);
    const guess = guessMapping(rows[0]);
    expect(guess).toMatchObject({ date: 0, description: 1, amount: 2, category: 4 });
    const { transactions, errors } = mapRows(rows, { ...guess, date: 0, description: 1, dateFormat: "auto", decimal: ".", header: true });
    expect(errors).toEqual([]);
    expect(transactions.map((t) => [t.date, t.description, t.amountCents, t.category])).toEqual([
      ["2026-10-02", "Café, Paris", -350, "Food"],
      ["2026-10-03", "Salary", 250000, undefined],
    ]);
  });
});

describe("currency conversion", () => {
  const txns: Txn[] = [
    { date: "2026-10-01", amount_cents: 100000, currency: "EUR", category: "Salary" },
    { date: "2026-10-02", amount_cents: -11000, currency: "usd", category: "Food" },
    { date: "2026-10-03", amount_cents: -500, currency: "XYZ", category: null },
  ];

  it("converts with units-per-base rates and drops currencies without one", () => {
    const { txns: out, dropped } = convertTxns(txns, "EUR", { USD: 1.1 });
    expect(out.map((t) => t.amount_cents)).toEqual([100000, -10000]);
    expect(dropped.map((t) => t.currency)).toEqual(["XYZ"]);
  });

  it("summarises everything in the chosen currency", () => {
    const s = summarize(txns, [], "2026-10", "EUR", { USD: 1.1 });
    expect([s.income, s.expense, s.converted, s.skipped]).toEqual([100000, 10000, 1, 1]);
    // Without rates other currencies are left out, as before.
    const plain = summarize(txns, [], "2026-10", "EUR");
    expect([Math.abs(plain.expense), plain.converted, plain.skipped]).toEqual([0, 0, 2]);
  });
});

describe("uploads", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

  it("recognises images by their bytes and refuses the rest", () => {
    expect(sniffImage(png)).toBe("png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("\0\0\0\x1cftypavif\0\0"))).toBe("avif");
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeUndefined();
  });

  it("stores, serves and deletes, and never reads outside its folder", async () => {
    const url = await saveUpload("avatars", new Blob([png]));
    expect(url).toMatch(/^\/api\/uploads\/avatars\/[a-f0-9]{32}\.png$/);
    const [, , , kind, name] = url.split("/");
    expect(readUpload(kind, name)?.type).toBe("image/png");
    expect(readUpload(kind, "../../page.db")).toBeUndefined();
    expect(readUpload("config", name)).toBeUndefined();
    removeUpload(url);
    expect(readUpload(kind, name)).toBeUndefined();
    await expect(saveUpload("avatars", new Blob([new Uint8Array(3 * 1024 * 1024)]))).rejects.toThrow(/too large/);
    await expect(saveUpload("avatars", new Blob(["<svg/>                "]))).rejects.toThrow(/supported image/);
  });

  it("keeps the profile picture on the user", () => {
    const u = createUser({ username: "pic", role: "user" });
    expect(u.avatar).toBeNull();
    updateUser(u.id, { avatar: "/api/uploads/avatars/x.png", name: "Pic" });
    expect(getUser(u.id)).toMatchObject({ avatar: "/api/uploads/avatars/x.png", name: "Pic" });
  });
});
