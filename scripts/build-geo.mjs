// Builds src/lib/travel/geo.json for the travel globe: every country (code, names, continent,
// centre) and an even lattice of land dots, each tagged with its country. Run once after changing
// the sources: node scripts/build-geo.mjs. The output is committed; nothing here runs in Page.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { geoBounds, geoContains } from "d3-geo";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const atlas = require("world-atlas/countries-110m.json");
const countries = require("world-countries");
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");

const DOTS = 30_000;

/** Seven continents: the source groups North and South America together. */
function continent(c) {
  if (c.region === "Americas") return c.subregion === "South America" ? "SA" : "NA";
  return { Africa: "AF", Asia: "AS", Europe: "EU", Oceania: "OC", Antarctic: "AN" }[c.region] ?? "AN";
}

const list = countries
  .filter((c) => c.cca2)
  .map((c) => ({
    code: c.cca2,
    num: c.ccn3,
    name: c.name.common,
    nameFr: c.translations?.fra?.common ?? c.name.common,
    continent: continent(c),
    un: !!c.unMember,
    lat: Math.round(c.latlng[0] * 10) / 10,
    lon: Math.round(c.latlng[1] * 10) / 10,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const byNum = new Map(list.map((c, i) => [c.num, i]));

const shapes = feature(atlas, atlas.objects.countries).features.map((f) => ({ f, index: byNum.get(String(f.id)), bounds: geoBounds(f) }));
const inBounds = ([lon, lat], [[w, s], [e, n]]) => lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e);

// Fibonacci sphere: points spread evenly, so the globe looks the same density everywhere.
const dots = [];
const golden = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < DOTS; i++) {
  const y = 1 - (i / (DOTS - 1)) * 2;
  const lat = (Math.asin(y) * 180) / Math.PI;
  const lon = ((((i * golden * 180) / Math.PI) % 360) + 540) % 360 - 180;
  const p = [lon, lat];
  const hit = shapes.find((s) => s.index !== undefined && inBounds(p, s.bounds) && geoContains(s.f, p));
  if (hit) dots.push(Math.round(lon * 10), Math.round(lat * 10), hit.index);
}

const out = { countries: list.map(({ num, ...c }) => c), dots };
fs.writeFileSync(path.join(root, "src", "lib", "travel", "geo.json"), JSON.stringify(out));
console.log(`${list.length} countries, ${dots.length / 3} land dots, ${shapes.filter((s) => s.index === undefined).length} shapes without a country`);
