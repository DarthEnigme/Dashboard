// Page self-updater. Runs in a short-lived helper container started by the old Page container
// (from the NEW image, with the Docker socket mounted), because a container can't replace itself:
//
//   node scripts/updater.mjs <old-container-id> <new-image>
//
// It recreates the old container from the new image with the same settings (name, volumes, ports,
// networks, env, labels, restart policy), waits until it is healthy, then removes the old one.
// If anything fails, the old container is put back exactly as it was and started again.
// No dependencies: it talks to the Docker Engine API over the socket with node:http.

import http from "node:http";
import { fileURLToPath } from "node:url";

const HEALTH_TIMEOUT_MS = 120_000;

/** Values the old container only had because its image set them; dropped so the new image's apply. */
function fromImage(value, imageValue) {
  return JSON.stringify(value ?? null) === JSON.stringify(imageValue ?? null);
}

/**
 * Build the create-container body for the replacement. Pure: `old` is GET /containers/{id}/json,
 * `oldImage` and `newImage` are GET /images/{ref}/json (only .Config is read).
 */
export function planRecreate(old, oldImage, newImageRef) {
  const oc = old.Config ?? {};
  const ic = oldImage?.Config ?? {};
  const imageEnv = new Set(ic.Env ?? []);
  const imageLabels = ic.Labels ?? {};

  const config = { ...oc, Image: newImageRef };
  // Env baked into the old image (PAGE_VERSION, NODE_ENV, PATH…) comes from the new image instead.
  config.Env = (oc.Env ?? []).filter((e) => !imageEnv.has(e));
  // Same for labels (org.opencontainers.image.version…); compose and user labels stay.
  config.Labels = Object.fromEntries(Object.entries(oc.Labels ?? {}).filter(([k, v]) => imageLabels[k] !== v));
  for (const key of ["Cmd", "Entrypoint", "Healthcheck", "WorkingDir", "User", "ExposedPorts", "Volumes", "StopSignal"]) {
    if (fromImage(oc[key], ic[key])) delete config[key];
  }
  // Docker's default hostname is the short container id: let the new container get its own.
  if (oc.Hostname && old.Id?.startsWith(oc.Hostname)) delete config.Hostname;

  const shortId = (old.Id ?? "").slice(0, 12);
  const networks = Object.entries(old.NetworkSettings?.Networks ?? {}).map(([name, n]) => ({
    name,
    endpoint: {
      Aliases: (n.Aliases ?? []).filter((a) => a !== shortId && a !== old.Id),
      IPAMConfig: n.IPAMConfig ?? undefined,
      Links: n.Links ?? undefined,
      DriverOpts: n.DriverOpts ?? undefined,
    },
  }));
  // The API attaches one network at create time; the rest are connected before start.
  const [first, ...rest] = networks;
  const body = {
    ...config,
    HostConfig: old.HostConfig,
    NetworkingConfig: first ? { EndpointsConfig: { [first.name]: first.endpoint } } : undefined,
  };
  return { name: (old.Name ?? "").replace(/^\//, ""), body, extraNetworks: rest };
}

// ---------- Docker API over the socket ----------

function connection() {
  const host = process.env.DOCKER_HOST;
  if (host?.startsWith("tcp://")) {
    const u = new URL(host.replace(/^tcp:/, "http:"));
    return { host: u.hostname, port: Number(u.port || 2375) };
  }
  return { socketPath: host?.startsWith("unix://") ? host.slice(7) : "/var/run/docker.sock" };
}

export function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { ...connection(), method, path: `/v1.41${path}`, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const json = text ? safeJson(text) : null;
          if (status >= 400) reject(new Error(`${method} ${path}: HTTP ${status} ${json?.message ?? text}`.trim()));
          else resolve(json);
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error(`${method} ${path}: timeout`)));
    if (data) req.write(data);
    req.end();
  });
}

const safeJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[page-updater] ${new Date().toISOString()} ${msg}`);
const q = (s) => encodeURIComponent(s);

async function waitHealthy(id) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let runningSince = 0;
  while (Date.now() < deadline) {
    const c = await api("GET", `/containers/${id}/json`);
    const health = c.State?.Health?.Status;
    if (!c.State?.Running && c.State?.Status === "exited") throw new Error(`new container exited (code ${c.State.ExitCode})`);
    if (health === "healthy") return;
    if (health === "unhealthy") throw new Error("new container is unhealthy");
    if (!health && c.State?.Running) {
      // No healthcheck: accept 15 s of uninterrupted running.
      runningSince ||= Date.now();
      if (Date.now() - runningSince > 15_000) return;
    }
    await sleep(2000);
  }
  throw new Error("new container did not become healthy in time");
}

export async function run(oldId, newImage) {
  const old = await api("GET", `/containers/${q(oldId)}/json`);
  const oldImage = await api("GET", `/images/${q(old.Image)}/json`).catch(() => null);
  const plan = planRecreate(old, oldImage, newImage);
  const backup = `${plan.name}-old-${Date.now()}`;
  log(`replacing ${plan.name} (${old.Config?.Image}) with ${newImage}`);

  await api("POST", `/containers/${old.Id}/stop?t=20`).catch((e) => log(`stop: ${e.message}`));
  await api("POST", `/containers/${old.Id}/rename?name=${q(backup)}`);
  let created;
  try {
    created = await api("POST", `/containers/create?name=${q(plan.name)}`, plan.body);
    for (const n of plan.extraNetworks) {
      await api("POST", `/networks/${q(n.name)}/connect`, { Container: created.Id, EndpointConfig: n.endpoint });
    }
    await api("POST", `/containers/${created.Id}/start`);
    log("started, waiting until healthy");
    await waitHealthy(created.Id);
  } catch (e) {
    log(`update failed: ${e.message}; rolling back`);
    if (created) await api("DELETE", `/containers/${created.Id}?force=true`).catch((err) => log(`remove new: ${err.message}`));
    await api("POST", `/containers/${old.Id}/rename?name=${q(plan.name)}`).catch((err) => log(`rename back: ${err.message}`));
    await api("POST", `/containers/${old.Id}/start`).catch((err) => log(`start old: ${err.message}`));
    process.exitCode = 1;
    return false;
  }
  await api("DELETE", `/containers/${old.Id}?force=true`).catch((e) => log(`remove old: ${e.message}`));
  log("update complete");
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [oldId, image] = process.argv.slice(2);
  if (!oldId || !image) {
    console.error("usage: node scripts/updater.mjs <old-container-id> <new-image>");
    process.exit(2);
  }
  // Give the old container a moment to answer the HTTP request that started us.
  await sleep(1500);
  await run(oldId, image).catch((e) => {
    log(`fatal: ${e.message}`);
    process.exitCode = 1;
  });
}
