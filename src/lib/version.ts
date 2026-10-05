import fs from "node:fs";
import path from "node:path";
import pkg from "../../package.json";

export interface BuildInfo {
  /** Semver without a leading "v", e.g. "0.3.0". */
  version: string;
  /** Git commit the image was built from ("" for local builds). */
  commit: string;
  /** GitHub "owner/repo" the image was built from, for update checks. */
  repo: string;
  /** Image repository without a tag, e.g. "ghcr.io/owner/page". */
  image: string;
  /** Changes with every build: open pages compare it to notice an update. */
  buildId: string;
}

let cached: BuildInfo | undefined;

/** Build facts, baked into the Docker image as env vars by CI (see Dockerfile build args). */
export function buildInfo(): BuildInfo {
  if (cached) return cached;
  let nextBuild = "";
  try {
    nextBuild = fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    // dev server: no BUILD_ID
  }
  const version = (process.env.PAGE_VERSION || pkg.version).replace(/^v/, "");
  const commit = process.env.PAGE_COMMIT ?? "";
  cached = {
    version,
    commit,
    repo: process.env.PAGE_REPO ?? "",
    image: (process.env.PAGE_IMAGE ?? "").toLowerCase(),
    buildId: nextBuild || `${version}-${commit.slice(0, 7) || "dev"}`,
  };
  return cached;
}
