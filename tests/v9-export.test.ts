import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db, insertPing, setAppMeta } from "@/lib/db";
import { CONFIG_DIR } from "@/lib/config/load";
import { createToken, listTokens, revokeToken, verifyToken } from "@/lib/auth/tokens";
import { collectMetrics, renderMetrics } from "@/lib/export/prometheus";
import { insertMetrics } from "@/lib/metrics";

const user = (name: string, role = "admin") => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, ?, ?)").run(name, role, Date.now()).lastInsertRowid);

describe("API tokens", () => {
  beforeEach(() => {
    db().exec("DELETE FROM users;");
  });

  it("stores only a hash, works for active admins, and can be revoked", () => {
    const admin = user("root");
    const { token, list } = createToken(admin, "Prometheus");
    expect(token).toMatch(/^page_[\w-]{32}$/);
    expect(list[0]).toMatchObject({ name: "Prometheus", prefix: token.slice(0, 10), owner: "root", last_used: null });
    expect(JSON.stringify(db().prepare("SELECT * FROM api_tokens").all())).not.toContain(token);

    expect(verifyToken(`Bearer ${token}`)).toMatchObject({ username: "root" });
    expect(listTokens()[0].last_used).not.toBeNull();
    expect(verifyToken(`Bearer ${token}x`)).toBeUndefined();
    expect(verifyToken(token)).toBeUndefined();
    expect(verifyToken(null)).toBeUndefined();

    db().prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(admin);
    expect(verifyToken(`Bearer ${token}`)).toBeUndefined();
    db().prepare("UPDATE users SET disabled = 0, role = 'user' WHERE id = ?").run(admin);
    expect(verifyToken(`Bearer ${token}`)).toBeUndefined();
    db().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin);
    revokeToken(listTokens()[0].id);
    expect(verifyToken(`Bearer ${token}`)).toBeUndefined();
    expect(() => createToken(admin, " ")).toThrow(/name/);
  });
});

describe("Prometheus export", () => {
  it("renders the text format with escaped labels", () => {
    const out = renderMetrics([
      { name: "page_x", help: "An x.", type: "gauge", samples: [{ labels: { name: 'My "NAS"\\1' }, value: 1 }] },
      { name: "page_empty", help: "Nothing.", type: "gauge", samples: [] },
    ]);
    expect(out).toBe('# HELP page_x An x.\n# TYPE page_x gauge\npage_x{name="My \\"NAS\\"\\\\1"} 1\n');
  });

  it("exports checked services, recorded widget values and the version", async () => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CONFIG_DIR, "services.yaml"),
      "- name: Infra\n  services:\n    - name: NAS\n      href: http://nas.local\n      ping: true\n    - name: Docs\n      href: http://docs.local\n",
    );
    const now = Date.now();
    db().exec("DELETE FROM pings;");
    insertPing({ service_id: "infra.nas", ts: now - 120_000, up: 0, status: 503, latency_ms: null });
    insertPing({ service_id: "infra.nas", ts: now - 60_000, up: 1, status: 200, latency_ms: 12 });
    insertMetrics("infra.nas", now - 30_000, [{ key: "CPU", value: 12.5 }]);
    insertMetrics("infra.nas", now - 10_000, [{ key: "CPU", value: 40 }]);
    const out = await collectMetrics(now);
    expect(out).toContain('page_service_up{service="infra.nas",name="NAS",group="Infra"} 1');
    expect(out).toContain('page_service_latency_ms{service="infra.nas",name="NAS",group="Infra"} 12');
    expect(out).toContain('page_service_uptime_ratio{service="infra.nas",name="NAS",group="Infra"} 0.5');
    expect(out).toContain('page_widget_value{service="infra.nas",field="CPU"} 40');
    expect(out).toMatch(/^page_build_info\{version="[^"]+"\} 1$/m);
    expect(out).not.toContain("infra.docs"); // no status check
  });

  it("exports outages, the instance and the last backup", async () => {
    const now = Date.now();
    db().exec("DELETE FROM incidents; DELETE FROM users;");
    db().prepare("INSERT INTO incidents (service_id, start, end, cause) VALUES (?, ?, ?, ?)").run("infra.nas", now - 7_200_000, now - 7_000_000, "HTTP 503");
    db().prepare("INSERT INTO incidents (service_id, start, cause) VALUES (?, ?, ?)").run("infra.nas", now - 600_000, "no response");
    user("root");
    setAppMeta("backup.last", { at: new Date(now - 3_600_000).toISOString(), ok: true, name: "page-backup-x.zip", size: 2048, by: "nightly" });
    const out = await collectMetrics(now);
    const l = '{service="infra.nas",name="NAS",group="Infra"}';
    expect(out).toContain(`page_service_incident_open${l} 1`);
    expect(out).toContain(`page_service_incident_started_timestamp_seconds${l} ${Math.round((now - 600_000) / 1000)}`);
    expect(out).toContain(`page_service_incidents_24h${l} 2`);
    expect(out).toContain("\npage_users 1\n");
    expect(out).toContain("\npage_sessions_active 0\n");
    expect(out).toContain("\npage_backup_last_ok 1\n");
    expect(out).toContain("\npage_backup_last_size_bytes 2048\n");
    expect(out).toContain("\npage_update_available 0\n");
    expect(out).toMatch(/^page_database_size_bytes \d+$/m);
    expect(out).toMatch(/^page_process_uptime_seconds \d+$/m);
    expect(out).toMatch(/^page_process_resident_memory_bytes \d+$/m);
  });
});
