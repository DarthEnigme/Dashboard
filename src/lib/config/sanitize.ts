import type { LoadedConfig } from "./load";
import { serviceIds } from "./slug";
import {
  isSecretKey,
  MASK,
  SETTINGS_SECRETS,
  type BookmarkGroup,
  type ConfigFile,
  type Settings,
  type TileSize,
  type Visibility,
} from "./schema";
import { isPlaceholder } from "./env";
import { ACTION_TYPES } from "@/integrations/fields";

export interface ClientService {
  id: string;
  name: string;
  href?: string;
  icon?: string;
  description?: string;
  ping: boolean;
  size?: TileSize;
  widget?: string; // integration type only
  /** The integration offers admin actions (shown to admins only). */
  actions?: boolean;
  /** The widget's numbers are recorded (charts on the service page). */
  metrics?: boolean;
  source?: "docker";
}

export interface ClientGroup {
  name: string;
  icon?: string;
  tab?: string;
  columns?: number;
  collapsed?: boolean;
  services: ClientService[];
}

export type ClientSettings = Omit<Settings, "alerts" | "docker" | "auth">;

export interface ClientInfoWidget {
  type: string;
  /** Position in widgets.yaml, for /api/info/[index]; stays stable when some widgets are hidden. */
  index: number;
  [k: string]: unknown;
}

export interface ClientConfig {
  settings: ClientSettings;
  services: ClientGroup[];
  bookmarks: BookmarkGroup[];
  widgets: ClientInfoWidget[];
  errors: string[];
}

const withoutSecrets = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !isSecretKey(k) && k !== "headers"));

/**
 * Who must be able to see a service: its group's audience and its own (both apply); personal finance
 * data defaults to signed-in users.
 */
export const serviceVisibility = (group: { visible?: Visibility }, s: { visible?: Visibility; widget?: { type: string } }): Visibility[] => [
  group.visible ?? "public",
  s.visible ?? (s.widget?.type === "finance" ? "users" : "public"),
];

/**
 * What the browser is allowed to see: no widget config, ping targets, alert hooks, docker hosts
 * or auth settings, and only the items `canSee` allows for this viewer.
 */
export function sanitize(cfg: LoadedConfig, canSee: (v: Visibility) => boolean = () => true): ClientConfig {
  // Ids come from the full config so they don't shift with what this viewer can see.
  const ids = serviceIds(cfg.services);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth, ...settings } = cfg.settings;
  return {
    settings,
    bookmarks: cfg.bookmarks.filter((g) => canSee(g.visible ?? "public")),
    widgets: cfg.widgets
      .map((w, index) => ({ ...withoutSecrets(w), index }) as ClientInfoWidget)
      .filter((w) => canSee((w.visible as Visibility | undefined) ?? "public")),
    // Config errors can mention file contents: admins only.
    errors: canSee("admins") ? cfg.errors : [],
    services: cfg.services
      .map((g, gi) => ({
        g,
        visible: g.services
          .map((s, si) => ({ s, id: ids[gi][si] }))
          .filter(({ s }) => serviceVisibility(g, s).every(canSee)),
      }))
      .filter(({ g, visible }) => canSee(g.visible ?? "public") && visible.length > 0)
      .map(({ g, visible }) => ({
        name: g.name,
        icon: g.icon,
        tab: g.tab,
        columns: g.columns,
        collapsed: g.collapsed,
        services: visible.map(({ s, id }) => ({
          id,
          name: s.name,
          href: s.href,
          icon: s.icon,
          description: s.description,
          ping: !!s.ping,
          size: s.size,
          widget: s.widget?.type,
          actions: s.widget ? ACTION_TYPES.has(s.widget.type) : undefined,
          metrics: s.widget && (s.widget as { record?: unknown }).record === true ? true : undefined,
          source: s.source,
        })),
      })),
  };
}

const mask = (v: unknown) => (v !== "" && v != null && !isPlaceholder(v) ? MASK : v);

/** Mask secret keys at any depth; every value under "headers" counts as secret. */
function maskDeep(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(maskDeep);
  if (!o || typeof o !== "object") return o;
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => {
      if (k === "headers" && v && typeof v === "object") {
        return [k, Object.fromEntries(Object.entries(v).map(([h, x]) => [h, mask(x)]))];
      }
      return [k, isSecretKey(k) ? mask(v) : maskDeep(v)];
    }),
  );
}

/** Raw YAML for the editor with secrets masked (env placeholders are shown as-is). */
export function maskRaw(file: ConfigFile, raw: unknown): unknown {
  switch (file) {
    case "services":
      if (!Array.isArray(raw)) return [];
      return raw.map((g) => ({
        ...g,
        services: Array.isArray(g?.services)
          ? g.services.map((s: Record<string, unknown>) => (s?.widget ? { ...s, widget: maskDeep(s.widget) } : s))
          : [],
      }));
    case "widgets":
      return Array.isArray(raw) ? raw.map(maskDeep) : [];
    case "settings": {
      let out = maskDeep(raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      for (const path of SETTINGS_SECRETS) {
        const [a, b] = path.split(".");
        const parent = out[a] as Record<string, unknown> | undefined;
        if (parent && typeof parent === "object" && b in parent) out = { ...out, [a]: { ...parent, [b]: mask(parent[b]) } };
      }
      return out;
    }
    default:
      return raw ?? [];
  }
}
