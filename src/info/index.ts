import type { InfoProvider } from "./types";
import { weather } from "./weather";
import { resources } from "./resources";
import { markets } from "./markets";
import { currency } from "./currency";
import { glancesInfo } from "./glances";
import { prometheusInfo } from "./prometheus";

// "greeting" has no provider: it renders entirely in the browser.
export const infoProviders: Record<string, InfoProvider> = Object.fromEntries(
  [weather, resources, markets, currency, glancesInfo, prometheusInfo].map((p) => [p.type, p as InfoProvider]),
);
