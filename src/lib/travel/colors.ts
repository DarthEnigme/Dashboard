/** Travel map colours from settings.travel: a colour, or "accent" (or empty) to follow the accent. */
export interface MapColors {
  visited: string;
  lived: string;
  want: string;
}

export const DEFAULT_MAP_COLORS: MapColors = { visited: "accent", lived: "accent", want: "#f59e0b" };

export const mapColor = (value: string | undefined, accent: string) => (!value || value.trim() === "accent" ? accent : value.trim());

export function resolveMapColors(c: Partial<MapColors> | undefined, accent: string): MapColors {
  return {
    visited: mapColor(c?.visited ?? DEFAULT_MAP_COLORS.visited, accent),
    lived: mapColor(c?.lived ?? DEFAULT_MAP_COLORS.lived, accent),
    want: mapColor(c?.want ?? DEFAULT_MAP_COLORS.want, accent),
  };
}
