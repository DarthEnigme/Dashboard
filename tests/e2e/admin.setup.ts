import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test as setup } from "@playwright/test";

export const ADMIN_STATE = "test-results/.auth/admin.json";
const DB = path.join(__dirname, ".data", "page.db");
const HOUR = 3_600_000;

/**
 * Synthetic history for "Flaky" so the detail page has something to draw: a week of pings every
 * 10 minutes with a daily latency wave, a 40-minute outage, and 30 days of hourly rollups.
 */
function seedHistory() {
  const db = new DatabaseSync(DB);
  const id = "infra.flaky";
  const now = Date.now();
  const outageStart = now - 2 * 24 * HOUR;
  const insert = db.prepare("INSERT INTO pings (service_id, ts, up, status, latency_ms) VALUES (?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (let t = now - 7 * 24 * HOUR; t < now - 10 * 60_000; t += 10 * 60_000) {
    const down = t >= outageStart && t < outageStart + 40 * 60_000;
    const wave = 40 + 25 * Math.sin((t / (24 * HOUR)) * 2 * Math.PI) + ((t / 600_000) % 7) * 3;
    insert.run(id, t, down ? 0 : 1, down ? 503 : 200, down ? null : Math.round(wave));
  }
  const hourly = db.prepare("INSERT OR REPLACE INTO pings_hourly (service_id, hour, checks, up, avg_ms, p95_ms) VALUES (?, ?, ?, ?, ?, ?)");
  for (let h = Math.floor((now - 30 * 24 * HOUR) / HOUR) * HOUR; h < now - 7 * 24 * HOUR; h += HOUR) {
    const bad = Math.floor(h / HOUR) % 97 === 0;
    hourly.run(id, h, 6, bad ? 4 : 6, 45 + 15 * Math.sin(h / (24 * HOUR)), 80 + 20 * Math.cos(h / (12 * HOUR)));
  }
  db.prepare("INSERT INTO incidents (service_id, start, end, cause) VALUES (?, ?, ?, ?)").run(id, outageStart, outageStart + 40 * 60_000, "HTTP 503");
  db.prepare("INSERT INTO incidents (service_id, start, end, cause) VALUES (?, ?, ?, ?)").run(id, now - 12 * 24 * HOUR, now - 12 * 24 * HOUR + 15 * 60_000, "ECONNREFUSED");
  db.exec("COMMIT");
  db.close();
}

// Signs in as the bootstrap admin once; specs that need an admin reuse the saved cookies.
setup("sign in as admin and seed history", async ({ request }) => {
  const res = await request.post("/api/auth", { data: { username: "admin", password: "e2e-admin-pw" } });
  expect(res.ok()).toBe(true);
  await request.storageState({ path: ADMIN_STATE });
  seedHistory(); // the database exists now: login created the users table
});
