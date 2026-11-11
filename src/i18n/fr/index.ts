import { core } from "./core";
import { finance } from "./finance";
import { travel } from "./travel";
import { watchlist } from "./watchlist";
import { inventory } from "./inventory";
import { notes } from "./notes";
import { tasks } from "./tasks";
import { stocks } from "./stocks";

/**
 * French, one dictionary per app (core holds what they share): an app's texts live next to each
 * other, and a key is in one file only (a test checks).
 */
export const FR_PARTS: Record<string, Record<string, string>> = { core, finance, travel, watchlist, inventory, notes, tasks, stocks };
export const fr: Record<string, string> = Object.assign({}, ...Object.values(FR_PARTS));
