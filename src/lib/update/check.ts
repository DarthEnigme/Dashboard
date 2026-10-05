import { httpJson } from "../http";
import { getAppMeta, setAppMeta } from "../db";
import type { Settings } from "../config/schema";
import { buildInfo, type BuildInfo } from "../version";

export interface Release {
  /** "0.3.1" for stable, "main@abc1234" for edge. */
  version: string;
  /** Image tag to pull: the version for stable, "latest" for edge. */
  tag: string;
  /** Release notes (Markdown) or the commit message. */
  notes: string;
  url: string;
  publishedAt: string;
}

export interface UpdateStatus {
  current: BuildInfo;
  channel: "stable" | "edge";
  repo: string;
  latest?: Release;
  available: boolean;
  checkedAt?: string;
  error?: string;
}

const STATUS_KEY = "update.status";
export const CHECK_EVERY_MS = 6 * 3_600_000;

/** -1, 0 or 1. Pre-releases ("1.2.0-rc.1") sort before their release; unknown parts compare as 0. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** GitHub API base; PAGE_UPDATE_FEED points tests (and mirrors) elsewhere. */
const apiBase = () => (process.env.PAGE_UPDATE_FEED ?? "https://api.github.com").replace(/\/+$/, "");

export const updateRepo = (cfg: Settings["updates"]) => cfg.repo || buildInfo().repo;

interface GhRelease {
  tag_name: string;
  name?: string;
  body?: string;
  html_url: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}

interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; committer?: { date?: string } };
}

const headers = { Accept: "application/vnd.github+json", "User-Agent": "page-dashboard" };

/** The newest release (stable) or commit on main (edge), and whether it is newer than this build. */
export async function checkForUpdate(cfg: Settings["updates"], current = buildInfo()): Promise<UpdateStatus> {
  const repo = updateRepo(cfg);
  const base: UpdateStatus = { current, channel: cfg.channel, repo, available: false, checkedAt: new Date().toISOString() };
  if (!repo) return { ...base, error: "Unknown repository: set updates.repo (owner/repo)" };
  try {
    if (cfg.channel === "edge") {
      const c = await httpJson<GhCommit>(`${apiBase()}/repos/${repo}/commits/main`, { headers, timeoutMs: 10_000 });
      const latest: Release = {
        version: `main@${c.sha.slice(0, 7)}`,
        tag: "latest",
        notes: c.commit.message,
        url: c.html_url,
        publishedAt: c.commit.committer?.date ?? "",
      };
      // A local build (no commit) can't tell; don't nag.
      return { ...base, latest, available: !!current.commit && !c.sha.startsWith(current.commit) };
    }
    const list = await httpJson<GhRelease[]>(`${apiBase()}/repos/${repo}/releases?per_page=15`, { headers, timeoutMs: 10_000 });
    const newest = list
      .filter((r) => !r.draft && !r.prerelease && /^v?\d+\.\d+\.\d+/.test(r.tag_name))
      .sort((a, b) => compareSemver(b.tag_name, a.tag_name))[0];
    if (!newest) return base;
    const version = newest.tag_name.replace(/^v/, "");
    const latest: Release = { version, tag: version, notes: newest.body ?? "", url: newest.html_url, publishedAt: newest.published_at };
    return { ...base, latest, available: compareSemver(version, current.version) > 0 };
  } catch (e) {
    return { ...base, error: `Update check failed: ${(e as Error).message}` };
  }
}

/** Last check result, re-evaluated against the running build (it may have changed since). */
export function savedStatus(cfg: Settings["updates"]): UpdateStatus {
  const s = getAppMeta<UpdateStatus>(STATUS_KEY);
  const current = buildInfo();
  if (!s || s.channel !== cfg.channel || s.repo !== updateRepo(cfg)) {
    return { current, channel: cfg.channel, repo: updateRepo(cfg), available: false };
  }
  const available =
    !!s.latest &&
    (cfg.channel === "edge"
      ? !!current.commit && !s.latest.version.endsWith(current.commit.slice(0, 7))
      : compareSemver(s.latest.version, current.version) > 0);
  return { ...s, current, available };
}

export async function refreshStatus(cfg: Settings["updates"]): Promise<UpdateStatus> {
  const s = await checkForUpdate(cfg);
  // Keep the last good result when a check fails (rate limit, offline).
  const prev = getAppMeta<UpdateStatus>(STATUS_KEY);
  setAppMeta(STATUS_KEY, s.error && prev?.latest && prev.repo === s.repo ? { ...prev, error: s.error, checkedAt: s.checkedAt } : s);
  return savedStatus(cfg);
}
