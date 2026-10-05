import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkForUpdate, compareSemver } from "@/lib/update/check";
import { imageRepo } from "@/lib/update/apply";
import { inWindow } from "@/lib/update/job";
// @ts-expect-error plain ESM script without types
import { planRecreate } from "../scripts/updater.mjs";

describe("semver", () => {
  it("orders versions, with pre-releases before their release", () => {
    expect(compareSemver("0.10.0", "0.9.9")).toBe(1);
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3-rc.1", "1.2.3")).toBe(-1);
    expect(compareSemver("1.2.3-rc.2", "1.2.3-rc.1")).toBe(1);
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
  });
});

describe("update check", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url?.startsWith("/repos/me/page/releases")) {
        res.end(
          JSON.stringify([
            { tag_name: "v2.0.0-beta", body: "", html_url: "u", published_at: "", draft: false, prerelease: true },
            { tag_name: "v1.4.0", body: "notes", html_url: "https://x/1.4.0", published_at: "2026-10-01", draft: false, prerelease: false },
            { tag_name: "v1.5.0", body: "draft", html_url: "u", published_at: "", draft: true, prerelease: false },
          ]),
        );
      } else if (req.url === "/repos/me/page/commits/main") {
        res.end(JSON.stringify({ sha: "1234567abcdef", html_url: "c", commit: { message: "msg" } }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.PAGE_UPDATE_FEED = base;
  });
  afterAll(() => {
    server.close();
    delete process.env.PAGE_UPDATE_FEED;
  });

  const cur = (version: string, commit = "") => ({ version, commit, repo: "me/page", image: "", buildId: "b" });
  const cfg = (channel: "stable" | "edge") => ({ check: true, channel, notify: true, auto: false, window: "04:00", repo: "me/page" });

  it("stable: newest published release, ignoring drafts and pre-releases", async () => {
    const s = await checkForUpdate(cfg("stable"), cur("1.3.0"));
    expect(s.latest).toMatchObject({ version: "1.4.0", tag: "1.4.0", notes: "notes" });
    expect(s.available).toBe(true);
    expect((await checkForUpdate(cfg("stable"), cur("1.4.0"))).available).toBe(false);
  });

  it("edge: compares the commit on main", async () => {
    expect((await checkForUpdate(cfg("edge"), cur("1.4.0", "1234567abcdef"))).available).toBe(false);
    const s = await checkForUpdate(cfg("edge"), cur("1.4.0", "fffffff"));
    expect(s).toMatchObject({ available: true, latest: { version: "main@1234567", tag: "latest" } });
    // A local build without a commit never claims an update.
    expect((await checkForUpdate(cfg("edge"), cur("1.4.0"))).available).toBe(false);
  });

  it("reports errors instead of throwing", async () => {
    const s = await checkForUpdate({ ...cfg("stable"), repo: "nobody/none" }, cur("1.0.0"));
    expect(s.available).toBe(false);
    expect(s.error).toMatch(/Update check failed/);
  });
});

describe("updater", () => {
  const oldImage = {
    Config: {
      Env: ["PATH=/usr/bin", "NODE_ENV=production", "PAGE_VERSION=0.3.0"],
      Labels: { "org.opencontainers.image.version": "0.3.0" },
      Cmd: ["node", "server.js"],
      WorkingDir: "/app",
      User: "node",
      Healthcheck: { Test: ["CMD", "true"] },
    },
  };
  const old = {
    Id: "abcdef123456" + "0".repeat(52),
    Name: "/page",
    Image: "sha256:old",
    Config: {
      Hostname: "abcdef123456",
      Image: "ghcr.io/me/page:0.3.0",
      Env: ["PATH=/usr/bin", "NODE_ENV=production", "PAGE_VERSION=0.3.0", "HOMEPAGE_ADMIN_PASSWORD=x"],
      Labels: { "org.opencontainers.image.version": "0.3.0", "com.docker.compose.project": "home", "traefik.enable": "true" },
      Cmd: ["node", "server.js"],
      WorkingDir: "/app",
      User: "node",
      Healthcheck: { Test: ["CMD", "true"] },
    },
    HostConfig: { Binds: ["/srv/page/config:/app/config"], RestartPolicy: { Name: "unless-stopped" }, PortBindings: { "3000/tcp": [{ HostPort: "3000" }] } },
    NetworkSettings: {
      Networks: {
        home_default: { Aliases: ["page", "abcdef123456"], IPAMConfig: null, Links: null },
        proxy: { Aliases: ["page"], IPAMConfig: { IPv4Address: "10.0.0.5" } },
      },
    },
  };

  it("keeps the user's settings and lets the new image supply its own defaults", () => {
    const plan = planRecreate(old, oldImage, "ghcr.io/me/page:0.3.1");
    expect(plan.name).toBe("page");
    expect(plan.body.Image).toBe("ghcr.io/me/page:0.3.1");
    expect(plan.body.Env).toEqual(["HOMEPAGE_ADMIN_PASSWORD=x"]);
    expect(plan.body.Labels).toEqual({ "com.docker.compose.project": "home", "traefik.enable": "true" });
    for (const k of ["Cmd", "WorkingDir", "User", "Healthcheck", "Hostname"]) expect(plan.body).not.toHaveProperty(k);
    expect(plan.body.HostConfig).toBe(old.HostConfig);
  });

  it("attaches the first network at create and the others after, without the old id alias", () => {
    const plan = planRecreate(old, oldImage, "img:new");
    expect(plan.body.NetworkingConfig.EndpointsConfig.home_default.Aliases).toEqual(["page"]);
    expect(plan.extraNetworks).toEqual([{ name: "proxy", endpoint: expect.objectContaining({ Aliases: ["page"], IPAMConfig: { IPv4Address: "10.0.0.5" } }) }]);
  });

  it("keeps a custom hostname and command", () => {
    const plan = planRecreate({ ...old, Config: { ...old.Config, Hostname: "dash", Cmd: ["node", "server.js", "--debug"] } }, oldImage, "img:new");
    expect(plan.body.Hostname).toBe("dash");
    expect(plan.body.Cmd).toEqual(["node", "server.js", "--debug"]);
  });

  it("finds the image repository and the install hour", () => {
    expect(imageRepo("ghcr.io/me/page:0.3.0")).toBe("ghcr.io/me/page");
    expect(imageRepo("registry.local:5000/page")).toBe("registry.local:5000/page");
    expect(imageRepo("Me/Page@sha256:abc")).toBe("me/page");
    expect(inWindow("04:00", new Date(2026, 9, 5, 4, 30))).toBe(true);
    expect(inWindow("04:00", new Date(2026, 9, 5, 5, 0))).toBe(false);
  });
});
