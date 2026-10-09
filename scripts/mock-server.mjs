// Fake homelab APIs for trying Page without real services: `npm run mock`, then point widgets at
// http://localhost:4010/<service>. Serves the test fixtures and checks each API's auth the same way
// the real service does. /webhook records alerts; /flaky?up=0|1 toggles a service for alert testing.
// /oidc is a minimal OpenID provider that signs in whoever GET /oidc/_as?email=… last set.
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));
const apps = fixture("apps.json");
const pelicanData = fixture("pelican.json");
const pelicanCalls = [];
/** Home Assistant: the fixture's states plus a few controllable entities; service calls change them. */
const haStates = () => [
  ...fixture("homeassistant-states.json"),
  { entity_id: "light.desk", state: "off", attributes: { friendly_name: "Desk lamp" } },
  { entity_id: "scene.movie_night", state: "2026-10-01T20:00:00+00:00", attributes: { friendly_name: "Movie night" } },
];
let haLive;
const haCalls = [];
/** wg-easy clients, with "__RECENT__" handshakes set to a moment ago so they count as connected. */
const wgClients = () =>
  fixture("wgeasy-clients.json").map((c) => ({ ...c, latestHandshakeAt: c.latestHandshakeAt === "__RECENT__" ? new Date(Date.now() - 30_000).toISOString() : c.latestHandshakeAt }));

const webhooks = [];
const pveCalls = [];
let flakyUp = true;

// --- mock OIDC provider ---
const ISSUER = `http://localhost:${PORT}/oidc`;
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "mock", alg: "RS256", use: "sig" };
let oidcUser = { sub: "u-alice", email: "alice@example.com", email_verified: true, name: "Alice Example", groups: [] };
const codes = new Map();
const b64url = (buf) => Buffer.from(buf).toString("base64url");

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

const routes = {
  // GitHub API for the update checker (PAGE_UPDATE_FEED=http://localhost:4010/gh).
  "GET /gh/repos/test/page/releases": (_q, res) =>
    json(res, 200, [
      { tag_name: "v0.9.0-rc.1", body: "pre", html_url: "https://example.com/rc", published_at: "2026-10-04T10:00:00Z", draft: false, prerelease: true },
      {
        tag_name: "v0.9.0",
        name: "Page 0.9.0",
        body: "## What's new\n- **Faster** dashboards\n- Fixed `ping` timeouts, see [the issue](https://example.com/issues/1)\n\nThanks to everyone who tested.",
        html_url: "https://example.com/releases/v0.9.0",
        published_at: "2026-10-03T10:00:00Z",
        draft: false,
        prerelease: false,
      },
      { tag_name: "v0.2.0", body: "old", html_url: "https://example.com/releases/v0.2.0", published_at: "2026-01-01T00:00:00Z", draft: false, prerelease: false },
    ]),
  "GET /gh/repos/test/page/commits/main": (_q, res) =>
    json(res, 200, { sha: "abcdef1234567890", html_url: "https://example.com/commit/abcdef1", commit: { message: "Fix things", committer: { date: "2026-10-04T10:00:00Z" } } }),
  "GET /oidc/.well-known/openid-configuration": (_q, res) =>
    json(res, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    }),
  "GET /oidc/jwks": (_q, res) => json(res, 200, { keys: [jwk] }),
  "GET /oidc/_as": (req, res) => {
    const q = new URL(req.url, "http://x").searchParams;
    oidcUser = {
      sub: q.get("sub") ?? `u-${q.get("email")}`,
      email: q.get("email"),
      email_verified: q.get("verified") !== "0",
      name: q.get("name") ?? q.get("email"),
      groups: q.get("groups")?.split(",").filter(Boolean) ?? [],
    };
    json(res, 200, oidcUser);
  },
  "GET /oidc/authorize": (req, res) => {
    const q = new URL(req.url, "http://x").searchParams;
    const code = crypto.randomBytes(12).toString("hex");
    codes.set(code, { user: oidcUser, nonce: q.get("nonce"), clientId: q.get("client_id"), challenge: q.get("code_challenge") });
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state"));
    res.writeHead(302, { Location: back.toString() });
    res.end();
  },
  "POST /oidc/token": async (req, res) => {
    const body = new URLSearchParams(await readBody(req));
    const grant = codes.get(body.get("code"));
    codes.delete(body.get("code"));
    if (!grant) return json(res, 400, { error: "invalid_grant" });
    const verifier = body.get("code_verifier") ?? "";
    if (b64url(crypto.createHash("sha256").update(verifier).digest()) !== grant.challenge) {
      return json(res, 400, { error: "invalid_grant", error_description: "PKCE mismatch" });
    }
    const basic = req.headers.authorization?.startsWith("Basic ")
      ? Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":")
      : [body.get("client_id"), body.get("client_secret")];
    if (decodeURIComponent(basic[1] ?? "") !== "mock-secret") return json(res, 401, { error: "invalid_client" });
    const { sub, ...claims } = grant.user;
    const id_token = await new SignJWT({ ...claims, nonce: grant.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "mock" })
      .setIssuer(ISSUER)
      .setAudience(grant.clientId)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    json(res, 200, { access_token: "mock-access", token_type: "Bearer", expires_in: 300, id_token });
  },

  "GET /pve/api2/json/cluster/resources": (req, res) =>
    req.headers.authorization === "PVEAPIToken=api@pam!page=secret"
      ? json(res, 200, fixture("proxmox-resources.json"))
      : json(res, 401, { data: null }),

  // Backups: home-assistant 1 h old, pihole 5 days (stale), truenas on the shared store; win11 is
  // excluded from backup jobs; the last jellyfin backup failed.
  "GET /pve/api2/json/nodes/pve1/storage/local/content": (req, res) => {
    if (req.headers.authorization !== "PVEAPIToken=api@pam!page=secret") return json(res, 401, { data: null });
    const now = Math.floor(Date.now() / 1000);
    json(res, 200, { data: [{ vmid: 102, ctime: now - 3600, volid: "local:backup/vzdump-qemu-102.vma.zst" }, { vmid: 106, ctime: now - 5 * 86400, volid: "local:backup/vzdump-lxc-106.tar.zst" }] });
  },
  "GET /pve/api2/json/nodes/pve1/storage/nas-backup/content": (_q, res) =>
    json(res, 200, { data: [{ vmid: 104, ctime: Math.floor(Date.now() / 1000) - 7200, volid: "nas-backup:backup/vzdump-qemu-104.vma.zst" }] }),
  "GET /pve/api2/json/cluster/backup-info/not-backed-up": (_q, res) => json(res, 200, { data: [{ vmid: 103, name: "win11", type: "qemu" }] }),
  "GET /pve/api2/json/nodes/pve1/tasks": (_q, res) =>
    json(res, 200, { data: [{ type: "vzdump", id: "107", status: "job errors", starttime: Math.floor(Date.now() / 1000) - 3600, upid: "UPID:pve1:x" }] }),
  "GET /pve/api2/json/nodes/pve2/tasks": (_q, res) => json(res, 200, { data: [] }),

  // Apps tab (fixtures shared with tests/apps-integrations.test.ts)
  "GET /jellyfin/Sessions": (req, res) => (req.headers["x-emby-token"] === "jf-key" ? json(res, 200, apps["jellyfin-sessions"]) : json(res, 401, {})),
  "GET /jellyfin/Items/Counts": (req, res) => (req.headers["x-emby-token"] === "jf-key" ? json(res, 200, apps["jellyfin-counts"]) : json(res, 401, {})),
  "GET /sonarr/api/v3/health": (req, res) => (req.headers["x-api-key"] === "sonarr-key" ? json(res, 200, apps["sonarr-health"]) : json(res, 401, {})),
  "GET /sonarr/api/v3/queue": (_q, res) => json(res, 200, apps["sonarr-queue"]),
  "GET /sonarr/api/v3/wanted/missing": (_q, res) => json(res, 200, apps["sonarr-missing"]),
  "POST /qbt/api/v2/auth/login": async (req, res) => {
    const form = new URLSearchParams(await readBody(req));
    if (form.get("username") !== "admin" || form.get("password") !== "qbt-pw") return res.end("Fails.");
    res.writeHead(200, { "Set-Cookie": "SID=qbt-session; HttpOnly; path=/" });
    res.end("Ok.");
  },
  "GET /qbt/api/v2/transfer/info": (req, res) => (req.headers.cookie?.includes("SID=qbt-session") ? json(res, 200, apps["qbt-transfer"]) : json(res, 403, {})),
  "GET /qbt/api/v2/torrents/info": (req, res) => (req.headers.cookie?.includes("SID=qbt-session") ? json(res, 200, apps["qbt-torrents"]) : json(res, 403, {})),
  "GET /immich/api/server/statistics": (req, res) => (req.headers["x-api-key"] === "immich-key" ? json(res, 200, apps["immich-stats"]) : json(res, 401, {})),
  "GET /traefik/api/overview": (_q, res) => json(res, 200, apps["traefik-overview"]),
  "GET /traefik/api/http/routers": (_q, res) => json(res, 200, apps["traefik-routers"]),
  "POST /npm/api/tokens": async (req, res) => {
    const b = JSON.parse((await readBody(req)) || "{}");
    if (b.identity !== "admin@example.com" || b.secret !== "npm-pw") return json(res, 401, { error: { message: "Invalid password" } });
    json(res, 200, { token: "npm-token", expires: new Date(Date.now() + 86400000).toISOString() });
  },
  "GET /npm/api/nginx/proxy-hosts": (req, res) => (req.headers.authorization === "Bearer npm-token" ? json(res, 200, apps["npm-proxy"]) : json(res, 401, {})),
  "GET /npm/api/nginx/redirection-hosts": (_q, res) => json(res, 200, apps["npm-redirect"]),
  "GET /npm/api/nginx/certificates": (_q, res) => json(res, 200, apps["npm-certs"]),
  "GET /tailscale/api/v2/tailnet/-/devices": (req, res) => (req.headers.authorization === "Bearer ts-key" ? json(res, 200, apps["tailscale-devices"]) : json(res, 401, {})),
  "GET /scrutiny/api/summary": (_q, res) => json(res, 200, apps["scrutiny-summary"]),

  // Proxmox Backup Server
  "GET /pbs/api2/json/status/datastore-usage": (req, res) =>
    req.headers.authorization === "PBSAPIToken=page@pbs!dash:pbs-secret"
      ? json(res, 200, { data: [{ store: "main", total: 4e12, used: 3.1e12, avail: 0.9e12 }] })
      : json(res, 401, { data: null }),
  "GET /pbs/api2/json/admin/datastore/main/groups": (_q, res) => {
    const now = Math.floor(Date.now() / 1000);
    json(res, 200, {
      data: [
        { "backup-type": "vm", "backup-id": "102", "last-backup": now - 3 * 3600, "backup-count": 14, comment: "home-assistant" },
        { "backup-type": "ct", "backup-id": "106", "last-backup": now - 4 * 86400, "backup-count": 9, comment: "pihole" },
        { "backup-type": "host", "backup-id": "nas", "last-backup": now - 20 * 3600, "backup-count": 30 },
      ],
    });
  },
  "GET /pbs/api2/json/nodes/localhost/tasks": (_q, res) =>
    json(res, 200, { data: [{ worker_type: "verificationjob", worker_id: "main:v-1", starttime: Math.floor(Date.now() / 1000) - 600, status: "verification failed" }] }),

  "GET /portainer/api/endpoints/1/docker/containers/json": (req, res) =>
    req.headers["x-api-key"] === "ptr_key"
      ? json(res, 200, [{ State: "running" }, { State: "running" }, { State: "exited" }])
      : json(res, 401, { message: "Unauthorized" }),

  "GET /kuma/api/status-page/heartbeat/home": (_q, res) => json(res, 200, fixture("uptimekuma-heartbeat.json")),
  "GET /kuma/api/status-page/home": (_q, res) =>
    json(res, 200, { publicGroupList: [{ monitorList: [{ id: 1, name: "Router" }, { id: 2, name: "NAS" }, { id: 3, name: "Plex" }] }] }),

  "POST /pihole/api/auth": async (req, res) => {
    const { password } = JSON.parse((await readBody(req)) || "{}");
    if (password !== "pihole-pw") return json(res, 401, { session: { valid: false } });
    json(res, 200, { session: { valid: true, sid: "SID123", validity: 1800 } });
  },
  "GET /pihole/api/stats/summary": (req, res) =>
    req.headers["x-ftl-sid"] === "SID123" ? json(res, 200, fixture("pihole-v6-summary.json")) : json(res, 401, { error: "unauthorized" }),

  "GET /adguard/control/stats": (req, res) =>
    req.headers.authorization === `Basic ${Buffer.from("admin:adg").toString("base64")}`
      ? json(res, 200, fixture("adguard-stats.json"))
      : json(res, 401, {}),

  "POST /unifi/api/auth/login": async (req, res) => {
    const { username, password } = JSON.parse((await readBody(req)) || "{}");
    if (username !== "page" || password !== "unifi-pw") return json(res, 401, {});
    json(res, 200, {}, { "Set-Cookie": "TOKEN=abc; Path=/; HttpOnly", "X-CSRF-Token": "csrf1" });
  },
  "GET /unifi/proxy/network/api/s/default/stat/health": (req, res) =>
    req.headers.cookie?.includes("TOKEN=abc") ? json(res, 200, fixture("unifi-health.json")) : json(res, 401, {}),

  "GET /firefly/api/v1/summary/basic": (req, res) =>
    req.headers.authorization === "Bearer ff-token" ? json(res, 200, fixture("firefly-summary.json")) : json(res, 401, {}),

  "POST /ghostfolio/api/v1/auth/anonymous": async (req, res) => {
    const { accessToken } = JSON.parse((await readBody(req)) || "{}");
    if (accessToken !== "gf-token") return json(res, 403, {});
    json(res, 200, { authToken: "JWT" });
  },
  "GET /ghostfolio/api/v2/portfolio/performance": (req, res) => {
    if (req.headers.authorization !== "Bearer JWT") return json(res, 401, {});
    const max = new URL(req.url, "http://x").searchParams.get("range") === "max";
    json(res, 200, { performance: max ? { netPerformancePercentage: 0.31 } : { currentNetWorth: 84250, netPerformancePercentage: 0.0042 } });
  },

  "GET /custom/stats": (_q, res) => json(res, 200, { data: { users: 1234, storage: { used: 5_368_709_120 }, load: 37.5 }, version: "1.2.3" }),

  "HEAD /flaky": (_q, res) => {
    res.writeHead(flakyUp ? 200 : 503);
    res.end();
  },
  "GET /flaky": (req, res) => {
    const up = new URL(req.url, "http://x").searchParams.get("up");
    if (up !== null) flakyUp = up === "1";
    json(res, flakyUp ? 200 : 503, { up: flakyUp });
  },

  "POST /webhook": async (req, res) => {
    const body = JSON.parse((await readBody(req)) || "{}");
    webhooks.push({ at: new Date().toISOString(), ...body });
    console.log("webhook:", body.message ?? body);
    json(res, 200, { ok: true });
  },
  "GET /webhook": (_q, res) => json(res, 200, webhooks),
  "GET /pve/_calls": (_q, res) => json(res, 200, pveCalls),

  // Firefly III transactions for the finance sync (dates relative to now).
  "GET /firefly/api/v1/transactions": (req, res) => {
    if (req.headers.authorization !== "Bearer ff-token") return json(res, 401, {});
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const split = (id, type, n, amount, description, category) => ({
      transaction_journal_id: String(id), type, date: `${day(n)}T12:00:00+00:00`, amount, currency_code: "EUR",
      description, category_name: category, source_name: "Checking", destination_name: "Checking",
    });
    const data = [
      split(1, "deposit", 2, "3200.00", "Salary", "Salary"),
      split(2, "withdrawal", 1, "64.20", "Supermarket", "Groceries"),
      split(3, "withdrawal", 3, "950.00", "Rent October", "Housing"),
      split(4, "withdrawal", 4, "42.00", "Electricity", "Utilities"),
      split(5, "transfer", 5, "500.00", "To savings", null),
    ].map((t) => ({ attributes: { transactions: [t] } }));
    json(res, 200, { data, meta: { pagination: { current_page: 1, total_pages: 1 } } });
  },
  // Monitoring
  "GET /prom/api/v1/query": (req, res) => {
    const q = new URL(req.url, "http://x").searchParams.get("query") ?? "";
    const value = /cpu/i.test(q) ? "42.5" : /mem/i.test(q) ? "0.61" : /alert/i.test(q) ? "2" : "17";
    json(res, 200, { status: "success", data: { resultType: "vector", result: [{ metric: {}, value: [Date.now() / 1000, value] }] } });
  },
  "GET /prom/api/v1/query_range": (req, res) => {
    const p = new URL(req.url, "http://x").searchParams;
    const [start, end, step] = ["start", "end", "step"].map((k) => Number(p.get(k)));
    const values = [];
    const ratio = /mem/i.test(p.get("query") ?? ""); // ratio queries return 0–1
    for (let t = start, i = 0; t <= end; t += step, i++) {
      const v = 40 + 15 * Math.sin(i / 4) + (i % 3);
      values.push([t, String(ratio ? v / 70 : v)]);
    }
    json(res, 200, { status: "success", data: { resultType: "matrix", result: [{ metric: {}, values }] } });
  },
  "GET /prom/api/v1/targets": (_q, res) => json(res, 200, fixture("prometheus.json").targets),
  "GET /grafana/api/health": (_q, res) => json(res, 200, { database: "ok", version: "12.2.0" }),
  "GET /grafana/api/prometheus/grafana/api/v1/alerts": (req, res) =>
    req.headers.authorization === "Bearer glsa_token" ? json(res, 200, fixture("grafana-alerts.json")) : json(res, 401, {}),
  "GET /grafana/api/search": (_q, res) => json(res, 200, Array.from({ length: 14 }, (_, i) => ({ uid: `d${i}`, type: "dash-db" }))),
  "GET /glances/api/4/quicklook": (_q, res) => json(res, 200, fixture("glances.json").quicklook),
  "GET /glances/api/4/mem": (_q, res) => json(res, 200, fixture("glances.json").mem),
  "GET /glances/api/4/fs": (_q, res) => json(res, 200, fixture("glances.json").fs),
  "GET /glances/api/4/sensors": (_q, res) => json(res, 200, fixture("glances.json").sensors),
  "GET /glances/api/4/uptime": (_q, res) => json(res, 200, fixture("glances.json").uptime),
  "GET /glances/api/4/load": (_q, res) => json(res, 200, fixture("glances.json").load),
  "GET /glances/api/4/cpu/total/history/30": (_q, res) =>
    json(res, 200, { total: Array.from({ length: 30 }, (_, i) => [new Date(Date.now() - (30 - i) * 2000).toISOString(), 20 + 10 * Math.sin(i / 3)]) }),
  "GET /netdata/api/v1/data": (req, res) => {
    const chart = new URL(req.url, "http://x").searchParams.get("chart");
    const nd = fixture("netdata.json");
    json(res, 200, chart === "system.ram" ? nd.ram : chart === "system.load" ? nd.load : nd.cpu);
  },
  "GET /netdata/api/v1/alarms": (_q, res) => json(res, 200, fixture("netdata.json").alarms),
  "GET /metric/stats": (_q, res) => json(res, 200, { data: { load: [0.82, 0.7], uptime: 864000, temps: [41, 43, 47, 44, 45] } }),
  "GET /dockhand/api/containers": (req, res) =>
    req.headers.authorization === "Bearer dh_token" ? json(res, 200, fixture("dockhand-containers.json")) : json(res, 401, { error: "Unauthorized" }),
  // Pelican Panel client API (Bearer ptlc_key).
  "GET /pelican/api/client": (req, res) =>
    req.headers.authorization === "Bearer ptlc_key" ? json(res, 200, pelicanData.servers) : json(res, 401, { errors: [{ detail: "Unauthenticated." }] }),
  "GET /pelican/_calls": (_q, res) => json(res, 200, pelicanCalls),
  // WGDashboard: API key header; a wrong key answers 200 with status false, like the real one.
  "GET /wgd/api/getWireguardConfigurations": (req, res) =>
    json(res, 200, req.headers["wg-dashboard-apikey"] === "wgd-key" ? fixture("wgdashboard.json").configurations : { status: false, message: "Unauthorized access", data: null }),
  "GET /wgd/api/getWireguardConfigurationInfo": (req, res) => {
    if (req.headers["wg-dashboard-apikey"] !== "wgd-key") return json(res, 200, { status: false, message: "Unauthorized access", data: null });
    const name = new URL(req.url, "http://x").searchParams.get("configurationName");
    json(res, 200, fixture("wgdashboard.json").peers[name] ?? { status: false, message: "Configuration does not exist", data: null });
  },
  // wg-easy 14: password → session cookie → clients.
  "POST /wg/api/session": async (req, res) => {
    const body = JSON.parse((await readBody(req)) || "{}");
    if (body.password !== "wg-pass") return json(res, 401, { error: "Incorrect Password" });
    json(res, 200, { success: true }, { "Set-Cookie": "connect.sid=s%3Amock; Path=/; HttpOnly" });
  },
  "GET /wg/api/wireguard/client": (req, res) =>
    /connect\.sid=s%3Amock/.test(req.headers.cookie ?? "") ? json(res, 200, wgClients()) : json(res, 401, { error: "Not Logged In" }),
  // wg-easy 15: Basic auth.
  "GET /wg15/api/client": (req, res) =>
    req.headers.authorization === `Basic ${Buffer.from("admin:wg-pass").toString("base64")}` ? json(res, 200, wgClients()) : json(res, 401, { message: "Unauthorized" }),
  "GET /dockhand/api/stacks": (_q, res) => json(res, 200, [{ name: "immich" }, { name: "media" }]),
  "GET /arcane/api/environments/0/containers": (req, res) =>
    req.headers["x-api-key"] === "arc_key" ? json(res, 200, fixture("arcane-containers.json")) : json(res, 401, { success: false }),
  "GET /arcane/api/environments/0/projects": (_q, res) => json(res, 200, { success: true, data: [{ name: "proxy" }] }),
  "GET /ha/api/states": (req, res) => (req.headers.authorization === "Bearer ha-token" ? json(res, 200, (haLive ??= haStates())) : json(res, 401, {})),
  "GET /ha/_calls": (_q, res) => json(res, 200, haCalls),
  "GET /truenas/api/v2.0/pool": (req, res) =>
    req.headers.authorization === "Bearer tn-key" ? json(res, 200, fixture("truenas.json").pools) : json(res, 401, {}),
  "GET /truenas/api/v2.0/alert/list": (req, res) =>
    req.headers.authorization === "Bearer tn-key" ? json(res, 200, fixture("truenas.json").alerts) : json(res, 401, {}),
  "GET /truenas/api/v2.0/system/info": (_q, res) => json(res, 200, { uptime_seconds: 864000 }),
  "GET /syno/webapi/auth.cgi": (req, res) => {
    const q = new URL(req.url, "http://x").searchParams;
    q.get("account") === "page" && q.get("passwd") === "syno-pw"
      ? json(res, 200, { success: true, data: { sid: "SYNOSID" } })
      : json(res, 200, { success: false, error: { code: 400 } });
  },
  "GET /syno/webapi/entry.cgi": (req, res) => {
    const q = new URL(req.url, "http://x").searchParams;
    if (q.get("_sid") !== "SYNOSID") return json(res, 200, { success: false, error: { code: 119 } });
    const syno = fixture("synology.json");
    if (q.get("api") === "SYNO.Core.System.Utilization") return json(res, 200, { success: true, data: syno.utilization });
    json(res, 200, { success: true, data: { volumes: syno.volumes } });
  },
  // Calendar and feed with dates relative to now, so they always have upcoming items.
  "GET /calendar.ics": (_q, res) => {
    const at = (days, h) => {
      const d = new Date(Date.now() + days * 86400000);
      d.setUTCHours(h, 0, 0, 0);
      return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    };
    const ev = (uid, start, title) => ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART:${start}`, `SUMMARY:${title}`, "END:VEVENT"];
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      ...ev("a", at(0, 22), "Plex maintenance"),
      ...ev("b", at(1, 9), "Dentist"),
      ...ev("c", at(3, 18), "Football"),
      ...ev("d", at(6, 12), "Backup drive swap"),
      ...ev("e", at(9, 20), "Family dinner"),
      "END:VCALENDAR",
    ];
    res.writeHead(200, { "Content-Type": "text/calendar" });
    res.end(lines.join("\r\n") + "\r\n");
  },
  "GET /feed.xml": (_q, res) => {
    const item = (t, hoursAgo) => `<item><title>${t}</title><link>https://example.com/${encodeURIComponent(t)}</link><pubDate>${new Date(Date.now() - hoursAgo * 3600000).toUTCString()}</pubDate></item>`;
    res.writeHead(200, { "Content-Type": "application/rss+xml" });
    res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Selfhosted</title>${item("Jellyfin 10.11 released", 2)}${item("Proxmox VE 9.1 adds OCI images", 5)}${item("Self-hosting your photos with Immich", 9)}${item("Pi-hole v6 deep dive", 30)}${item("Home Assistant 2026.10 highlights", 50)}</channel></rss>`);
  },
};

// Parameterised routes: [method, regex, handler(req, res, match)].
const patterns = [
  [
    "GET",
    /^\/pve\/api2\/json\/nodes\/([^/]+)\/(qemu|lxc)\/(\d+)\/rrddata$/,
    (req, res, m) => {
      if (req.headers.authorization !== "PVEAPIToken=api@pam!page=secret") return json(res, 401, { data: null });
      const now = Math.floor(Date.now() / 60) * 60;
      const seed = Number(m[3]);
      json(res, 200, {
        data: Array.from({ length: 70 }, (_, i) => ({
          time: now - (69 - i) * 60,
          cpu: 0.15 + 0.1 * Math.sin((i + seed) / 6),
          maxcpu: 4,
          mem: 2.2e9 + 2e8 * Math.cos(i / 9),
          maxmem: 4e9,
          netin: 4e5 + 2e5 * Math.sin(i / 4),
          netout: 1.5e5 + 1e5 * Math.cos(i / 5),
          diskread: 2e6 * Math.abs(Math.sin(i / 7)),
          diskwrite: 8e5 * Math.abs(Math.cos(i / 3)),
        })),
      });
    },
  ],
  [
    "POST",
    /^\/pve\/api2\/json\/nodes\/([^/]+)\/(qemu|lxc)\/(\d+)\/snapshot$/,
    async (req, res, m) => {
      if (req.headers.authorization !== "PVEAPIToken=api@pam!page=secret") return json(res, 401, { data: null });
      const body = new URLSearchParams(await readBody(req));
      pveCalls.push({ node: m[1], type: m[2], vmid: Number(m[3]), action: "snapshot", snapname: body.get("snapname") });
      json(res, 200, { data: `UPID:${m[1]}:mock:snapshot` });
    },
  ],
  [
    "POST",
    /^\/pve\/api2\/json\/nodes\/([^/]+)\/(qemu|lxc)\/(\d+)\/status\/(start|shutdown|reboot|stop)$/,
    (req, res, m) => {
      if (req.headers.authorization !== "PVEAPIToken=api@pam!page=secret") return json(res, 401, { data: null });
      pveCalls.push({ node: m[1], type: m[2], vmid: Number(m[3]), action: m[4] });
      json(res, 200, { data: `UPID:${m[1]}:mock:${m[4]}` });
    },
  ],
  [
    "POST",
    /^\/dockhand\/api\/containers\/([a-f0-9]+)\/(start|stop|restart)$/,
    (req, res) => (req.headers.authorization === "Bearer dh_token" ? json(res, 200, { success: true }) : json(res, 401, { error: "Unauthorized" })),
  ],
  [
    "GET",
    /^\/pelican\/api\/client\/servers\/([0-9a-f]{8})\/resources$/,
    (req, res, m) =>
      req.headers.authorization !== "Bearer ptlc_key"
        ? json(res, 401, { errors: [{ detail: "Unauthenticated." }] })
        : pelicanData.resources[m[1]]
          ? json(res, 200, pelicanData.resources[m[1]])
          : json(res, 404, { errors: [{ detail: "Not found" }] }),
  ],
  [
    "POST",
    /^\/pelican\/api\/client\/servers\/([0-9a-f]{8})\/power$/,
    async (req, res, m) => {
      if (req.headers.authorization !== "Bearer ptlc_key") return json(res, 401, { errors: [{ detail: "Unauthenticated." }] });
      pelicanCalls.push({ server: m[1], ...JSON.parse((await readBody(req)) || "{}") });
      res.writeHead(204);
      res.end();
    },
  ],
  [
    "POST",
    /^\/ha\/api\/services\/(\w+)\/(\w+)$/,
    async (req, res, m) => {
      if (req.headers.authorization !== "Bearer ha-token") return json(res, 401, {});
      const { entity_id } = JSON.parse((await readBody(req)) || "{}");
      haCalls.push({ domain: m[1], service: m[2], entity_id });
      const s = (haLive ??= haStates()).find((x) => x.entity_id === entity_id);
      if (s && m[2] === "turn_on" && m[1] !== "scene") s.state = "on";
      if (s && m[2] === "turn_off") s.state = "off";
      json(res, 200, s ? [s] : []);
    },
  ],
  [
    "POST",
    /^\/arcane\/api\/environments\/0\/containers\/([a-f0-9]+)\/(start|stop|restart)$/,
    (req, res) => (req.headers["x-api-key"] === "arc_key" ? json(res, 200, { success: true }) : json(res, 401, { success: false })),
  ],
];

http
  .createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    const route = routes[`${req.method} ${pathname}`];
    if (route) return route(req, res);
    for (const [method, re, handler] of patterns) {
      const m = req.method === method && re.exec(pathname);
      if (m) return handler(req, res, m);
    }
    json(res, 404, { error: `No mock for ${req.method} ${req.url}` });
  })
  .listen(PORT, () => console.log(`Mock homelab APIs on http://localhost:${PORT}`));
