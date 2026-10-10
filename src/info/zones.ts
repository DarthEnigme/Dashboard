// Client-safe: used by the clock info widget.

/** "Tokyo=Asia/Tokyo" or "Asia/Tokyo" (labelled Tokyo); unknown zones are dropped. */
export function parseZones(zones: unknown): { label: string; zone: string }[] {
  const list = Array.isArray(zones) ? zones : typeof zones === "string" ? zones.split(",") : [];
  return list.flatMap((z) => {
    const [a, b] = String(z).split("=").map((s) => s.trim());
    const zone = b ?? a;
    if (!zone) return [];
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
    } catch {
      return [];
    }
    return [{ label: b ? a : zone.split("/").pop()!.replaceAll("_", " "), zone }];
  });
}
