import geo from "./geo.json";

/** A country as the travel log knows it (from scripts/build-geo.mjs). */
export interface Country {
  code: string;
  name: string;
  nameFr: string;
  /** AF, AN, AS, EU, NA, OC, SA */
  continent: string;
  /** A UN member as the source marks it (it also counts the Vatican); with Palestine that's the usual 195. */
  un: boolean;
  lat: number;
  lon: number;
}

export const COUNTRIES = geo.countries as Country[];
/** Flat [lon×10, lat×10, country index, …] for every land dot of the globe. */
export const DOTS = geo.dots as number[];
export const UN_COUNT = 195;

const index = new Map(COUNTRIES.map((c, i) => [c.code, i]));
export const countryIndex = (code: string) => index.get(code) ?? -1;
export const countryName = (code: string, locale = "en") => {
  const c = COUNTRIES[countryIndex(code)];
  return c ? (locale === "fr" ? c.nameFr : c.name) : code;
};

/** 🇫🇷 from "FR" (regional indicator letters). */
export const flag = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : "");
