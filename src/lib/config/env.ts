import fs from "node:fs";

const PLACEHOLDER = /\{\{\s*(HOMEPAGE_(?:VAR|FILE)_[A-Z0-9_]+)\s*\}\}/g;

export const isPlaceholder = (v: unknown): boolean =>
  typeof v === "string" && /^\{\{\s*HOMEPAGE_(VAR|FILE)_[A-Z0-9_]+\s*\}\}$/.test(v.trim());

/** Replace {{HOMEPAGE_VAR_X}} with process.env.HOMEPAGE_VAR_X and {{HOMEPAGE_FILE_X}} with the contents of the file at that path. */
export function substituteEnv<T>(value: T, env: Record<string, string | undefined> = process.env): T {
  if (typeof value === "string") {
    return value.replace(PLACEHOLDER, (_, name: string) => {
      const v = env[name];
      if (v === undefined) return "";
      if (name.startsWith("HOMEPAGE_FILE_")) {
        try {
          return fs.readFileSync(v, "utf8").trim();
        } catch {
          return "";
        }
      }
      return v;
    }) as T;
  }
  if (Array.isArray(value)) return value.map((v) => substituteEnv(v, env)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substituteEnv(v, env)]),
    ) as T;
  }
  return value;
}
