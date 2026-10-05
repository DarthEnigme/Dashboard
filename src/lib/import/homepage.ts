// Converts a gethomepage.dev config into Page's format. Self-contained (only depends on "yaml")
// so scripts/import-homepage.mjs can run it directly with Node's TypeScript support.
import YAML from "yaml";

export interface HomepageFiles {
  services?: string;
  bookmarks?: string;
  settings?: string;
  widgets?: string;
  docker?: string;
}

type Obj = Record<string, unknown>;

export interface Converted {
  settings: Obj;
  services: Obj[];
  bookmarks: Obj[];
  widgets: Obj[];
  warnings: string[];
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
/** Homepage lists are lists of single-key maps: [{ "Name": value }, …]. */
const entries = (v: unknown): [string, unknown][] => (Array.isArray(v) ? v.flatMap((x) => (isObj(x) ? Object.entries(x) : [])) : []);
const clean = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// Tailwind 500 shades for Homepage's `color` setting.
const COLORS: Record<string, string> = {
  slate: "#64748b", gray: "#6b7280", zinc: "#71717a", neutral: "#737373", stone: "#78716c", amber: "#f59e0b",
  yellow: "#eab308", lime: "#84cc16", green: "#22c55e", emerald: "#10b981", teal: "#14b8a6", cyan: "#06b6d4",
  sky: "#0ea5e9", blue: "#3b82f6", indigo: "#6366f1", violet: "#8b5cf6", purple: "#a855f7", fuchsia: "#d946ef",
  pink: "#ec4899", rose: "#f43f5e", red: "#ef4444", white: "#e5e7eb",
};
const BLUR: Record<string, number> = { none: 0, sm: 4, "": 8, md: 12, lg: 16, xl: 24, "2xl": 40, "3xl": 40 };

/** "sh-name" (selfh.st icons) has no Page shorthand: point at the CDN. Everything else carries over. */
function icon(v: unknown): string | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const sh = /^sh-(.+?)(?:\.(png|svg|webp))?$/.exec(v);
  return sh ? `https://cdn.jsdelivr.net/gh/selfhst/icons/${sh[2] ?? "png"}/${sh[1]}.${sh[2] ?? "png"}` : v;
}

/** customapi `field` may be "a.b" or a nested object { a: { b: c } }. */
function fieldPath(f: unknown): string {
  if (typeof f === "string") return f;
  const parts: string[] = [];
  let cur: unknown = f;
  while (isObj(cur)) {
    const [k, v] = Object.entries(cur)[0] ?? [];
    if (k === undefined) break;
    parts.push(k);
    cur = v;
  }
  if (typeof cur === "string" || typeof cur === "number") parts.push(String(cur));
  return parts.join(".");
}

interface Ctx {
  warn: (m: string) => void;
  dockerHosts: Record<string, string>;
  /** Raw Homepage services by "group/name", for widgets that reference other services. */
  byName: Map<string, Obj>;
}

function convertWidget(w: Obj, where: string, ctx: Ctx): Obj | undefined {
  const t = String(w.type ?? "");
  const pick = (...keys: string[]) => clean(Object.fromEntries(keys.map((k) => [k, w[k]])));
  switch (t) {
    case "proxmox":
      return { type: t, ...pick("url", "username", "password", "node") };
    case "portainer":
      return { type: t, ...pick("url", "key", "env") };
    case "uptimekuma":
      return { type: t, ...pick("url", "slug") };
    case "pihole":
      return { type: t, ...pick("url", "key", "version") };
    case "adguard":
      return { type: t, ...pick("url", "username", "password") };
    case "unifi":
      if (!w.username) ctx.warn(`${where}: UniFi API-key login isn't supported; set a local username/password.`);
      return { type: t, ...pick("url", "username", "password", "site") };
    case "firefly":
    case "ghostfolio":
      return clean({ type: t, url: w.url, token: w.key });
    case "diskstation":
      return { type: "synology", ...pick("url", "username", "password") };
    case "truenas":
      if (!w.key) ctx.warn(`${where}: TrueNAS needs an API key in Page (username/password login isn't supported).`);
      return { type: t, ...pick("url", "key") };
    case "homeassistant": {
      const custom = Array.isArray(w.custom) ? (w.custom as Obj[]) : [];
      const entities = custom.filter((c) => typeof c.state === "string").map((c) => clean({ entity: c.state, label: c.label }));
      if (custom.some((c) => c.template)) ctx.warn(`${where}: Home Assistant templates aren't supported; only "state" entries were kept.`);
      return clean({ type: t, url: w.url, token: w.key, entities: entities.length ? entities : undefined });
    }
    case "customapi": {
      const formats = new Set(["text", "number", "percent", "bytes", "duration"]);
      const mappings = (Array.isArray(w.mappings) ? (w.mappings as Obj[]) : []).map((m) => {
        let format = String(m.format ?? "text");
        if (!formats.has(format)) {
          ctx.warn(`${where}: customapi format "${format}" became "text".`);
          format = "text";
        }
        return clean({ label: m.label, field: fieldPath(m.field), format, suffix: m.suffix });
      });
      return clean({ type: t, url: w.url, method: w.method, headers: w.headers, mappings: mappings.length ? mappings : undefined });
    }
    case "calendar": {
      const sources = (Array.isArray(w.integrations) ? (w.integrations as Obj[]) : []).flatMap((i) => {
        if (i.type === "ical" && typeof i.url === "string") return [clean({ type: "ical", url: i.url, name: i.name })];
        if (i.type === "sonarr" || i.type === "radarr") {
          const ref = ctx.byName.get(`${i.service_group}/${i.service_name}`);
          const rw = isObj(ref?.widget) ? ref!.widget : undefined;
          if (rw?.url && rw?.key) return [{ type: i.type, url: rw.url, key: rw.key }];
          ctx.warn(`${where}: calendar source ${i.service_group}/${i.service_name} not found; skipped.`);
          return [];
        }
        ctx.warn(`${where}: calendar source type "${String(i.type)}" isn't supported; skipped.`);
        return [];
      });
      return sources.length ? { type: t, sources } : undefined;
    }
    default:
      ctx.warn(`${where}: widget "${t}" isn't supported by Page yet; the service was kept without it.`);
      return undefined;
  }
}

function convertService(name: string, raw: unknown, group: string, ctx: Ctx): Obj {
  const s = isObj(raw) ? raw : {};
  const where = `${group} › ${name}`;
  let ping: string | boolean | undefined;
  if (typeof s.siteMonitor === "string") ping = s.siteMonitor;
  else if (typeof s.ping === "string") {
    // Homepage pings a host with ICMP; Page checks over HTTP.
    ping = /^https?:\/\//.test(s.ping) ? s.ping : `http://${s.ping}`;
    ctx.warn(`${where}: ICMP ping isn't available; checking ${ping} over HTTP instead.`);
  }
  let widget = isObj(s.widget) ? convertWidget(s.widget, where, ctx) : undefined;
  if (Array.isArray(s.widgets)) {
    const first = (s.widgets as unknown[]).find(isObj);
    if (first) widget = convertWidget(first, where, ctx);
    if ((s.widgets as unknown[]).length > 1) ctx.warn(`${where}: only the first of several widgets was kept.`);
  }
  if (typeof s.container === "string") {
    if (widget) ctx.warn(`${where}: has both a widget and a container; the container stats were dropped.`);
    else {
      const host = typeof s.server === "string" ? ctx.dockerHosts[s.server] : undefined;
      if (typeof s.server === "string" && host === undefined) ctx.warn(`${where}: docker server "${s.server}" isn't in docker.yaml; using the local socket.`);
      widget = clean({ type: "docker", container: s.container, host });
    }
  }
  return clean({ name, href: s.href, icon: icon(s.icon), description: s.description, ping, widget });
}

/** Homepage groups may nest groups; Page groups are flat, so nested ones become "Parent / Child". */
function convertGroups(list: unknown, ctx: Ctx, prefix = ""): Obj[] {
  const out: Obj[] = [];
  for (const [gname, items] of entries(list)) {
    const name = prefix ? `${prefix} / ${gname}` : gname;
    const services: Obj[] = [];
    const nested: Obj[] = [];
    for (const [sname, value] of entries(items)) {
      // A service's value is a map; a list under a name is a nested group.
      if (Array.isArray(value)) {
        nested.push(...convertGroups([{ [sname]: value }], ctx, name));
        ctx.warn(`Group "${name} / ${sname}" was nested; it is now a separate group.`);
      } else services.push(convertService(sname, value, name, ctx));
    }
    if (services.length || !nested.length) out.push({ name, services });
    out.push(...nested);
  }
  return out;
}

function convertBookmarks(list: unknown, ctx: Ctx): Obj[] {
  return entries(list).map(([group, items]) => ({
    name: group,
    links: entries(items)
      .map(([name, value]) => {
        const b = Array.isArray(value) ? (value.find(isObj) as Obj | undefined) : isObj(value) ? value : undefined;
        if (!b?.href) {
          ctx.warn(`Bookmark "${group} › ${name}" has no href; skipped.`);
          return undefined;
        }
        return clean({ name, href: b.href, icon: icon(b.icon), description: b.description });
      })
      .filter((x): x is Obj => !!x),
  }));
}

function convertSettings(s: Obj, ctx: Ctx): { settings: Obj; layout: Record<string, Obj> } {
  const out: Obj = {};
  if (typeof s.title === "string") out.title = s.title;
  if (typeof s.description === "string") out.description = s.description;
  if (s.theme === "light" || s.theme === "dark") out.theme = s.theme;
  if (typeof s.color === "string") out.accent = COLORS[s.color] ?? "#8b5cf6";
  if (s.target === "_self" || s.target === "_blank") out.target = s.target;
  const bg = s.background;
  if (typeof bg === "string") out.background = { image: bg };
  else if (isObj(bg) && typeof bg.image === "string") {
    out.background = clean({
      image: bg.image,
      blur: bg.blur === undefined ? undefined : (BLUR[String(bg.blur)] ?? 8),
      brightness: typeof bg.brightness === "number" ? Math.min(1, bg.brightness / 100) : undefined,
    });
  }
  const layout = isObj(s.layout) ? (s.layout as Record<string, Obj>) : {};
  const tabs = [...new Set(Object.values(layout).map((l) => l?.tab).filter((t): t is string => typeof t === "string"))];
  if (tabs.length) out.tabs = tabs;
  for (const k of ["providers", "quicklaunch", "statusStyle", "hideVersion", "language"]) {
    if (s[k] !== undefined) ctx.warn(`settings.${k} has no equivalent in Page; ignored.`);
  }
  return { settings: out, layout };
}

function convertInfoWidgets(list: unknown, ctx: Ctx): Obj[] {
  const out: Obj[] = [];
  for (const [type, raw] of entries(list)) {
    const w = isObj(raw) ? raw : {};
    switch (type) {
      case "openmeteo":
      case "openweathermap":
      case "weatherapi":
        if (w.latitude === undefined || w.longitude === undefined) {
          ctx.warn(`Info widget ${type}: needs latitude/longitude; skipped.`);
          break;
        }
        if (type !== "openmeteo") ctx.warn(`Info widget ${type} became Open-Meteo (no API key needed).`);
        out.push(clean({ type: "weather", label: w.label, latitude: w.latitude, longitude: w.longitude, units: w.units === "imperial" ? "imperial" : "metric" }));
        break;
      case "resources":
        out.push(clean({ type: "resources", label: w.label, disks: w.disk === undefined ? undefined : Array.isArray(w.disk) ? w.disk : [w.disk] }));
        break;
      case "datetime":
      case "greeting":
        if (!out.some((x) => x.type === "greeting")) out.push(clean({ type: "greeting", name: type === "greeting" && typeof w.text === "string" ? w.text : undefined }));
        break;
      default:
        ctx.warn(`Info widget "${type}" isn't supported; skipped.`);
    }
  }
  return out;
}

/** docker.yaml: { name: { socket } | { host, port } } → Page docker host strings. */
function dockerHosts(text: string | undefined): Record<string, string> {
  const d = text ? YAML.parse(text) : undefined;
  if (!isObj(d)) return {};
  return Object.fromEntries(
    Object.entries(d).flatMap(([name, v]) => {
      if (!isObj(v)) return [];
      if (typeof v.socket === "string") return [[name, `unix://${v.socket}`]];
      if (typeof v.host === "string") return [[name, `tcp://${v.host}:${v.port ?? 2375}`]];
      return [];
    }),
  );
}

export function convertHomepage(files: HomepageFiles): Converted {
  const warnings: string[] = [];
  const parse = (name: string, text: string | undefined) => {
    if (!text?.trim()) return undefined;
    try {
      return YAML.parse(text);
    } catch (e) {
      warnings.push(`${name}.yaml could not be read: ${(e as Error).message.split("\n")[0]}`);
      return undefined;
    }
  };
  const rawServices = parse("services", files.services);
  const byName = new Map<string, Obj>();
  for (const [g, items] of entries(rawServices)) for (const [n, v] of entries(items)) if (isObj(v)) byName.set(`${g}/${n}`, v);
  const ctx: Ctx = { warn: (m) => warnings.push(m), dockerHosts: dockerHosts(files.docker), byName };

  const rawSettings = parse("settings", files.settings);
  const { settings, layout } = convertSettings(isObj(rawSettings) ? rawSettings : {}, ctx);
  const applyLayout = (g: Obj) => {
    const l = layout[g.name as string];
    if (!isObj(l)) return g;
    return clean({ ...g, tab: l.tab, columns: typeof l.columns === "number" ? Math.min(8, l.columns) : undefined, collapsed: l.initiallyCollapsed === true ? true : undefined });
  };
  const services = convertGroups(rawServices, ctx).map(applyLayout);
  const bookmarks = convertBookmarks(parse("bookmarks", files.bookmarks), ctx).map(applyLayout);
  if (Object.keys(ctx.dockerHosts).length) {
    settings.docker = { hosts: Object.entries(ctx.dockerHosts).map(([name, host]) => ({ name, host })) };
  }
  return { settings, services, bookmarks, widgets: convertInfoWidgets(parse("widgets", files.widgets), ctx), warnings };
}

/** The converted config as YAML file contents. */
export function toYaml(c: Converted): Record<"settings" | "services" | "bookmarks" | "widgets", string> {
  const header = "# Imported from gethomepage.dev\n";
  return {
    settings: header + YAML.stringify(c.settings),
    services: header + YAML.stringify(c.services),
    bookmarks: header + YAML.stringify(c.bookmarks),
    widgets: header + YAML.stringify(c.widgets),
  };
}
