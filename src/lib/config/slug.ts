export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-") || "x"
  );
}

/** Stable ids "group.service" for every service, de-duplicated with a numeric suffix. */
export function serviceIds(groups: { name: string; services: { name: string }[] }[]): string[][] {
  // The loaded config keeps its arrays until a file changes, and every lookup asks for the ids.
  const known = memo.get(groups);
  if (known) return known;
  const seen = new Map<string, number>();
  const ids = groups.map((g) =>
    g.services.map((s) => {
      const base = `${slugify(g.name)}.${slugify(s.name)}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n ? `${base}-${n + 1}` : base;
    }),
  );
  memo.set(groups, ids);
  return ids;
}

const memo = new WeakMap<object, string[][]>();
