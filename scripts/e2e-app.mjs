// Starts the built app for Playwright with a fresh copy of tests/e2e/config and an empty data dir,
// so editor tests can write freely. Requires `npm run build` first.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configDir = path.join(root, "tests", "e2e", ".config");
const dataDir = path.join(root, "tests", "e2e", ".data");

fs.rmSync(configDir, { recursive: true, force: true });
fs.rmSync(dataDir, { recursive: true, force: true });
fs.cpSync(path.join(root, "tests", "e2e", "config"), configDir, { recursive: true });

const port = process.env.E2E_PORT ?? "3300";
const child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    HOMEPAGE_CONFIG_DIR: configDir,
    HOMEPAGE_DATA_DIR: dataDir,
    HOMEPAGE_SECRET: "e2e-secret-e2e-secret-e2e-secret",
    // Creates the "admin" account on first start (see bootstrap in src/lib/auth).
    HOMEPAGE_ADMIN_PASSWORD: "e2e-admin-pw",
    // Update checks go to the mock GitHub API.
    PAGE_UPDATE_FEED: "http://localhost:4010/gh",
    PAGE_REPO: "test/page",
    // City search for the travel log.
    PAGE_GEOCODER_URL: "http://localhost:4010/geo",
  },
});
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
