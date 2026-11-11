/**
 * How prices move together: daily returns matched by day, a symbol's beta and correlation against
 * a benchmark, and a series rebased to 100. Pure, so every figure can be checked by hand.
 */

export interface Closes {
  days: string[];
  closes: number[];
}

/** Daily returns of `a` and `b` on the days both have a close (and the day before it). */
export function pairedReturns(a: Closes, b: Closes): [number[], number[]] {
  const other = new Map(b.days.map((d, i) => [d, b.closes[i]]));
  const ra: number[] = [];
  const rb: number[] = [];
  let prev: { a: number; b: number } | undefined;
  a.days.forEach((d, i) => {
    const vb = other.get(d);
    if (vb === undefined) return;
    const va = a.closes[i];
    if (prev && prev.a > 0 && prev.b > 0) {
      ra.push(va / prev.a - 1);
      rb.push(vb / prev.b - 1);
    }
    prev = { a: va, b: vb };
  });
  return [ra, rb];
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Beta (how much `a` moves when the benchmark moves 1 %) and correlation (−1 to 1); null with fewer than 20 days in common. */
export function betaAndCorrelation(a: Closes, benchmark: Closes): { beta: number | null; correlation: number | null } {
  const [ra, rb] = pairedReturns(a, benchmark);
  if (ra.length < 20) return { beta: null, correlation: null };
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  return { beta: vb > 0 ? cov / vb : null, correlation: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null };
}

/** The series as 100 on its first day (from `from` on). */
export function rebased(s: Closes, from = ""): Closes {
  const start = Math.max(0, s.days.findIndex((d) => d >= from));
  const first = s.closes[start];
  if (!first) return { days: [], closes: [] };
  return { days: s.days.slice(start), closes: s.closes.slice(start).map((c) => (c / first) * 100) };
}

/** Yearly volatility from daily returns, in percent. */
export function volatility(s: Closes): number | null {
  const r = s.closes.slice(1).map((c, i) => c / s.closes[i] - 1);
  if (r.length < 20) return null;
  const m = mean(r);
  return Math.sqrt(r.reduce((acc, x) => acc + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100;
}
