/**
 * Counters and last-seen values about NanoDash itself, for the Prometheus export. Kept in memory:
 * counters start again from zero with the process, which is what Prometheus expects of them.
 */
type Labels = Record<string, string>;
interface Sample {
  labels: Labels;
  value: number;
}
type Table = Map<string, Map<string, Sample>>;

const g = globalThis as typeof globalThis & { __pageStats?: { counters: Table; gauges: Table } };
const state = () => (g.__pageStats ??= { counters: new Map(), gauges: new Map() });

function cell(table: Table, name: string, labels: Labels): Sample {
  let rows = table.get(name);
  if (!rows) table.set(name, (rows = new Map()));
  const key = JSON.stringify(labels);
  let s = rows.get(key);
  if (!s) rows.set(key, (s = { labels, value: 0 }));
  return s;
}

/** Add to a counter (a total that only grows). */
export function count(name: string, labels: Labels = {}, by = 1) {
  cell(state().counters, name, labels).value += by;
}

/** Remember the latest value of something. */
export function gauge(name: string, labels: Labels, value: number) {
  cell(state().gauges, name, labels).value = value;
}

export const counters = (name: string): Sample[] => [...(state().counters.get(name)?.values() ?? [])];
export const gauges = (name: string): Sample[] => [...(state().gauges.get(name)?.values() ?? [])];

/** Forget samples about things that are gone (a service removed from the config). */
export function dropLabel(label: string, keep: Set<string>) {
  for (const table of [state().counters, state().gauges]) {
    for (const rows of table.values()) for (const [key, s] of rows) if (label in s.labels && !keep.has(s.labels[label])) rows.delete(key);
  }
}
