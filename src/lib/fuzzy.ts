/**
 * Subsequence fuzzy match for the command palette: every query character must appear in order.
 * Higher is better; null means no match. Rewards matches at word starts and runs of consecutive
 * characters, and penalises gaps, so "pxm" ranks "Proxmox" above "Plex Media" and "rst" finds
 * "Restart".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  // Exact substring beats any scattered match; earlier is better.
  const at = t.indexOf(q);
  if (at !== -1) return 1000 - at + (at === 0 || /[\s\-_./]/.test(t[at - 1]) ? 100 : 0);

  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const gap = found - ti;
    const wordStart = found === 0 || /[\s\-_./]/.test(t[found - 1]);
    run = gap === 0 ? run + 1 : 0;
    score += 10 + (wordStart ? 15 : 0) + run * 5 - Math.min(gap, 10);
    ti = found + 1;
  }
  return score;
}

/** Best score across an item's fields (title counts double). */
export function scoreItem(query: string, title: string, ...extra: (string | undefined)[]): number | null {
  let best = fuzzyScore(query, title);
  if (best !== null) best *= 2;
  for (const e of extra) {
    if (!e) continue;
    const s = fuzzyScore(query, e);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}
