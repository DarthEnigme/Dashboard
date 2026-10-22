// Rollback drill: runs the real one-click update on Docker with a release that fails on purpose,
// and checks that NanoDash comes back as it was, with its database restored.
//
//   npm run drill:rollback                  # with a small database made for the drill
//   npm run drill:rollback -- --db data/page.db   # with a COPY of a real database (never the file itself)
//   add --keep to leave the containers, images and files behind for a look
//
// What it does:
//   1. starts a registry on localhost:5000 and a release feed (PAGE_UPDATE_FEED) announcing 0.6.1-drill.2
//   2. builds image A (this working tree, 0.6.1-drill.1) and image B (the same with an extra database
//      migration and a healthcheck that always fails), and pushes both
//   3. runs A with the Docker socket on a copy of the database, signs in, and installs B from Settings → Updates
//   4. waits for the updater to give up on B and put A back, then checks the database
// Needs Docker (Desktop) running. Takes a few minutes, most of it building the two images.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "localhost:5000";
const IMAGE = `${REGISTRY}/nanodash-drill`;
const FROM = "0.6.1-drill.1";
const TO = "0.6.1-drill.2";
const NAME = "nanodash-drill";
const PORT = 3999;
const FEED_PORT = 4011;
const USER = "drill";
const PASSWORD = "drill-password-123";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const dbArg = args.includes("--db") ? args[args.indexOf("--db") + 1] : undefined;

const log = (msg) => console.log(`[drill] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const dockerLoud = (...a) => execFileSync("docker", a, { stdio: "inherit" });
const tryDocker = (...a) => {
  try {
    return docker(...a);
  } catch {
    return undefined;
  }
};

let failures = 0;
function check(ok, what) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) failures++;
}

/** Same format as src/lib/auth/password.ts. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", 16384, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** A database as an older NanoDash left it (no schema version), or a copy of the one given. */
function prepareDb(dataDir) {
  const file = path.join(dataDir, "page.db");
  if (dbArg) {
    for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(dbArg + ext)) fs.copyFileSync(dbArg + ext, file + ext);
  } else {
    const d = new DatabaseSync(file);
    d.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT COLLATE NOCASE,
        name TEXT, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE fin_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
        category TEXT, description TEXT NOT NULL DEFAULT '', account TEXT, source TEXT NOT NULL DEFAULT 'manual', external_id TEXT UNIQUE, created_at INTEGER NOT NULL);
      CREATE TABLE pings (service_id TEXT NOT NULL, ts INTEGER NOT NULL, up INTEGER NOT NULL, status INTEGER, latency_ms INTEGER);
    `);
    const tx = d.prepare("INSERT INTO fin_transactions (date, amount_cents, currency, description, created_at) VALUES (?, ?, 'EUR', ?, 1)");
    for (let i = 0; i < 25; i++) tx.run(`2026-10-${String((i % 28) + 1).padStart(2, "0")}`, -100 * (i + 1), `Drill ${i}`);
    const ping = d.prepare("INSERT INTO pings (service_id, ts, up, status, latency_ms) VALUES ('drill', ?, 1, 200, 12)");
    for (let i = 0; i < 500; i++) ping.run(Date.now() - i * 30_000);
    d.close();
  }
  // Opening and closing folds the WAL in; then a drill admin to sign in with.
  const d = new DatabaseSync(file);
  d.prepare("DELETE FROM users WHERE username = ?").run(USER);
  d.prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)").run(USER, hashPassword(PASSWORD), Date.now());
  const counts = rowCounts(d);
  d.close();
  for (const ext of ["-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
  return counts;
}

/** Rows per table the drill compares before and after (sessions and app state are expected to change). */
function rowCounts(d) {
  const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const skip = new Set(["sessions", "app_meta", "audit", "pings", "pings_hourly", "incidents", "metrics", "config_versions"]);
  return Object.fromEntries(tables.filter((t) => !skip.has(t)).map((t) => [t, d.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
}

/** The working tree, as Docker would see it, copied to `dir` (tracked and new files, not ignored ones). */
function copyTree(dir) {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const f of files) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) continue; // deleted in the working tree
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, f));
  }
}

function buildImages(work) {
  log(`building image A (${FROM}) from the working tree…`);
  dockerLoud("build", "-t", `${IMAGE}:${FROM}`, "--build-arg", `PAGE_VERSION=${FROM}`, "--build-arg", `PAGE_IMAGE=${IMAGE}`, ROOT);

  log(`building image B (${TO}): one more migration, and a healthcheck that always fails…`);
  const tree = path.join(work, "tree-b");
  copyTree(tree);
  const dbTs = path.join(tree, "src/lib/db.ts");
  const src = fs.readFileSync(dbTs, "utf8");
  const patched = src.replace(/^( {2}baseline,\r?\n)(\];)/m, `$1  (d) => d.exec("CREATE TABLE drill_marker (x INTEGER)"),\n$2`);
  if (patched === src) throw new Error("couldn't add a migration to src/lib/db.ts (MIGRATIONS not found)");
  fs.writeFileSync(dbTs, patched);
  const dockerfile = path.join(tree, "Dockerfile");
  fs.writeFileSync(dockerfile, fs.readFileSync(dockerfile, "utf8").replace(/^HEALTHCHECK .*$/m, "HEALTHCHECK --interval=15s --timeout=2s --start-period=0s --retries=1 CMD exit 1"));
  dockerLoud("build", "-t", `${IMAGE}:${TO}`, "--build-arg", `PAGE_VERSION=${TO}`, "--build-arg", `PAGE_IMAGE=${IMAGE}`, tree);

  for (const tag of [FROM, TO]) dockerLoud("push", `${IMAGE}:${tag}`);
}

/** GitHub's releases API, as far as the update check reads it. */
function startFeed() {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/repos/drill/nanodash/releases")) {
      res.end(JSON.stringify([{ tag_name: `v${TO}`, body: "Rollback drill: this release fails its healthcheck.", html_url: "http://drill", published_at: new Date().toISOString(), draft: false, prerelease: false }]));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  return new Promise((resolve) => server.listen(FEED_PORT, "0.0.0.0", () => resolve(server)));
}

async function waitFor(what, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const base = `http://localhost:${PORT}`;
const up = () => fetch(`${base}/api/auth`).then((r) => r.ok);

async function signIn() {
  const r = await fetch(`${base}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`sign-in failed: HTTP ${r.status} ${await r.text()}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function api(cookie, method, url, body) {
  const r = await fetch(`${base}${url}`, {
    method,
    headers: { Cookie: cookie, Origin: base, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: HTTP ${r.status} ${json.error ?? ""}`);
  return json;
}

function cleanup(work, feed) {
  feed?.close();
  if (keep) {
    log(`kept everything: container ${NAME}, registry nanodash-drill-registry, files in ${work}`);
    return;
  }
  const leftovers = (tryDocker("ps", "-aq", "--filter", `name=${NAME}`) ?? "").split(/\s+/).filter(Boolean);
  for (const id of leftovers) tryDocker("rm", "-f", id);
  tryDocker("rm", "-f", "nanodash-drill-registry");
  for (const tag of [FROM, TO]) tryDocker("rmi", "-f", `${IMAGE}:${tag}`);
  fs.rmSync(work, { recursive: true, force: true });
}

async function main() {
  if (tryDocker("info", "--format", "{{.ServerVersion}}") === undefined) throw new Error("Docker isn't running. Start Docker Desktop and try again.");
  if (tryDocker("ps", "-aq", "--filter", `name=^${NAME}$`)) throw new Error(`a container named ${NAME} already exists (an earlier --keep run?): remove it first`);
  if (dbArg && !fs.existsSync(dbArg)) throw new Error(`no database at ${dbArg}`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "nanodash-drill-"));
  const dataDir = path.join(work, "data");
  const configDir = path.join(work, "config");
  fs.mkdirSync(dataDir);
  fs.mkdirSync(configDir);
  // The container runs as uid 1000; on Linux the host directories must be writable for it.
  fs.chmodSync(dataDir, 0o777);
  fs.chmodSync(configDir, 0o777);
  fs.writeFileSync(path.join(configDir, "settings.yaml"), `title: Rollback drill\nupdates:\n  check: false\n  repo: drill/nanodash\n  image: ${IMAGE}\n`);

  let feed;
  try {
    const before = prepareDb(dataDir);
    log(`database ready (${dbArg ? `copy of ${dbArg}` : "made for the drill"}): ${Object.entries(before).map(([t, n]) => `${t} ${n}`).join(", ")}`);

    if (!tryDocker("ps", "-q", "--filter", "name=^nanodash-drill-registry$")) docker("run", "-d", "--name", "nanodash-drill-registry", "-p", "5000:5000", "registry:2");
    feed = await startFeed();
    buildImages(work);

    log(`starting ${NAME} on ${base} with image A…`);
    const oldId = docker(
      "run", "-d", "--name", NAME,
      "-p", `${PORT}:3000`,
      "-v", `${configDir}:/app/config`,
      "-v", `${dataDir}:/app/data`,
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      "--group-add", "0",
      "--add-host", "host.docker.internal:host-gateway",
      "-e", `PAGE_UPDATE_FEED=http://host.docker.internal:${FEED_PORT}`,
      `${IMAGE}:${FROM}`,
    );
    await waitFor("image A to answer", up, 120_000);

    const cookie = await signIn();
    const status = await api(cookie, "POST", "/api/update/check");
    if (!status.available) throw new Error(`the update check didn't offer ${TO}: ${JSON.stringify({ latest: status.latest, error: status.error, preflight: status.preflight })}`);
    if (!status.preflight?.canApply) throw new Error(`NanoDash can't update itself here: ${status.preflight?.reason}`);
    log(`installing ${TO} from Settings → Updates (it will fail its healthcheck)…`);
    await api(cookie, "POST", "/api/update/apply", { version: TO });

    // The updater stops A, starts B, waits up to 4 minutes for a healthy B, then puts A back.
    await waitFor("the update to start", async () => tryDocker("inspect", "-f", "{{.State.Running}}", oldId) === "false", 120_000);
    log("A stopped, B starting; waiting for the updater to give up on B and put A back…");
    await waitFor("A to be back", async () => tryDocker("inspect", "-f", "{{.State.Running}} {{.Name}}", oldId) === `true /${NAME}`, 360_000);
    await waitFor("A to answer again", up, 120_000);

    log("checking the outcome:");
    const after = await api(await signIn().catch(() => cookie), "GET", "/api/update");
    check(after.current?.version === FROM, `the running version is ${FROM} again (got ${after.current?.version})`);
    const last = after.history?.[0];
    check(last?.result === "rolled back" && last?.to === TO, `the update history says the update to ${TO} was rolled back (${last?.result})`);
    check(/database as it was before the update/.test(last?.detail ?? ""), "the history entry says the database was restored");

    docker("stop", "-t", "20", oldId);
    const kept = fs.readdirSync(dataDir).filter((f) => /^page\.db\.schema-v\d+-\d+$/.test(f));
    check(kept.length === 1, `the upgraded database is kept next to it (${kept.join(", ") || "none"})`);
    if (kept[0]) {
      const k = new DatabaseSync(path.join(dataDir, kept[0]), { readOnly: true });
      check(!!k.prepare("SELECT 1 FROM sqlite_master WHERE name = 'drill_marker'").get(), "B really migrated the database before failing (drill_marker table in the kept copy)");
      k.close();
    }
    const snaps = fs.existsSync(path.join(dataDir, "snapshots")) ? fs.readdirSync(path.join(dataDir, "snapshots")) : [];
    check(snaps.some((f) => f.startsWith(`pre-update-${FROM}-to-${TO}-`)), `a pre-update snapshot exists (${snaps.join(", ")})`);
    const d = new DatabaseSync(path.join(dataDir, "page.db"), { readOnly: true });
    const version = d.prepare("PRAGMA user_version").get().user_version;
    check(version === 1, `the restored database is at schema 1 (got ${version})`);
    check(!d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'drill_marker'").get(), "B's migration is gone from the restored database");
    const counts = rowCounts(d);
    d.close();
    const changed = Object.keys(before).filter((t) => before[t] !== counts[t]);
    check(changed.length === 0, `every table kept its rows${changed.length ? ` (changed: ${changed.map((t) => `${t} ${before[t]} → ${counts[t]}`).join(", ")})` : ""}`);
  } finally {
    cleanup(work, feed);
  }
  if (failures) {
    console.error(`[drill] FAILED: ${failures} check(s) didn't hold`);
    process.exitCode = 1;
  } else {
    log("PASSED: the failed update was rolled back and the database restored");
  }
}

main().catch((e) => {
  console.error(`[drill] ${e.message}`);
  process.exitCode = 1;
});
