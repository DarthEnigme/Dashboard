/** The "waits for" graph of a board's tasks. Pure: the store checks with it, the page draws steps with it. */

/** Edges as task → the tasks it waits for. */
export type Waits = ReadonlyMap<number, readonly number[]>;

/** Would making `task` wait for `blockers` close a loop (a task that ends up waiting for itself)? */
export function createsCycle(waits: Waits, task: number, blockers: readonly number[]): boolean {
  const seen = new Set<number>();
  const stack = [...blockers];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === task) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(waits.get(id) ?? []));
  }
  return false;
}

/**
 * The tasks in steps: step 0 waits for nothing, each later step waits only for earlier ones.
 * Waits on tasks outside `tasks` are ignored. A loop (which the store refuses) would land in the last step.
 */
export function steps<T extends { id: number; blocked_by: readonly number[] }>(tasks: readonly T[]): T[][] {
  const ids = new Set(tasks.map((t) => t.id));
  const depth = new Map<number, number>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visiting = new Set<number>();
  const depthOf = (t: T): number => {
    const known = depth.get(t.id);
    if (known !== undefined) return known;
    if (visiting.has(t.id)) return 0;
    visiting.add(t.id);
    const before = t.blocked_by.filter((b) => ids.has(b)).map((b) => depthOf(byId.get(b)!) + 1);
    visiting.delete(t.id);
    const d = Math.max(0, ...before);
    depth.set(t.id, d);
    return d;
  };
  const out: T[][] = [];
  for (const t of tasks) (out[depthOf(t)] ??= []).push(t);
  return out.filter(Boolean);
}
