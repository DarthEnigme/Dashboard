import { z } from "zod";

export const gradientPresets = ["aurora", "sunset", "ocean", "midnight", "forest", "aero", "dawn", "lagoon", "graphite", "nebula", "synthwave"] as const;
export const stylePresets = ["glass", "liquid", "aero", "neon", "brutal", "soft", "retro", "minimal", "solid"] as const;
/** oled and sepia are tones of dark and light (see themeAttrs in lib/theme.ts). */
export const themes = ["dark", "light", "system", "oled", "sepia"] as const;
export const glowLevels = ["none", "subtle", "strong"] as const;
export const tileSizes = ["small", "wide", "tall", "large"] as const;
export const visibilities = ["public", "users", "admins"] as const;
/** public, users or admins; or a list of group names: their members (and admins). */
export type Visibility = (typeof visibilities)[number] | string[];
const visible = z.union([z.enum(visibilities), z.array(z.string().min(1)).min(1)]).optional();

/** What a signed-in user may do beyond seeing things; admins may do everything. */
export const PERMISSIONS = ["finance", "actions"] as const;
export type Permission = (typeof PERMISSIONS)[number];

const providerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
  type: z.enum(["oidc", "google", "github"]),
  name: z.string().optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  issuer: z.string().url().optional(), // required for type oidc
  scopes: z.string().optional(),
  /** Allow people without an existing account to sign in (creates one). */
  signup: z.boolean().default(false),
  /** Members of this group (from the "groups" claim) become admins. */
  adminGroup: z.string().optional(),
  groupsClaim: z.string().default("groups"),
  /** Treat the email as verified even without an email_verified claim (only for an IdP you control). */
  trustEmail: z.boolean().default(false),
});
export type ProviderConfig = z.infer<typeof providerSchema>;

export const authSchema = z
  .object({
    /** Anyone can view the dashboard (items marked users/admins still need a login). */
    publicView: z.boolean().default(true),
    /** Public URL of Page, used for OAuth redirects when behind a proxy. */
    baseUrl: z.string().url().optional(),
    defaultRole: z.enum(["user", "admin"]).default("user"),
    /** What every signed-in user may do; groups add more (Settings → Accounts → Groups). */
    userPermissions: z.array(z.enum(PERMISSIONS)).default(["finance"]),
    local: z.object({ enabled: z.boolean().default(true) }).default({}),
    proxy: z
      .object({
        enabled: z.boolean().default(false),
        userHeader: z.string().default("Remote-User"),
        emailHeader: z.string().default("Remote-Email"),
        nameHeader: z.string().default("Remote-Name"),
        groupsHeader: z.string().default("Remote-Groups"),
        /** The proxy must send this header with this value; proves the request came through it. */
        secretHeader: z.string().default("X-Page-Proxy-Secret"),
        secret: z.string().optional(),
        adminGroup: z.string().optional(),
        signup: z.boolean().default(true),
      })
      .default({}),
    ldap: z
      .object({
        enabled: z.boolean().default(false),
        url: z.string().optional(),
        bindDN: z.string().optional(),
        bindPassword: z.string().optional(),
        baseDN: z.string().optional(),
        userFilter: z.string().default("(uid={{username}})"),
        emailAttribute: z.string().default("mail"),
        nameAttribute: z.string().default("cn"),
        /** DN of a group; members (memberOf) become admins. */
        adminGroup: z.string().optional(),
        insecure: z.boolean().optional(),
        signup: z.boolean().default(true),
      })
      .default({}),
    providers: z.array(providerSchema).default([]),
  })
  .default({});
export type AuthConfig = z.infer<typeof authSchema>;

export const settingsSchema = z
  .object({
    title: z.string().default("Page"),
    description: z.string().optional(),
    /** Image shown next to the title, on the sign-in page and as the app icon (URL or an upload). */
    logo: z.string().optional(),
    theme: z.enum(themes).default("dark"),
    style: z.enum(stylePresets).default("glass"),
    accent: z.string().default("#8b5cf6"), // a colour, or "auto" to take it from the wallpaper
    /** Edge light and accent glow on hovered cards. */
    glow: z.enum(glowLevels).default("subtle"),
    background: z
      .object({
        image: z.string().optional(),
        gradient: z.enum(gradientPresets).default("aurora"),
        blur: z.number().min(0).max(40).default(0),
        brightness: z.number().min(0).max(1).default(0.7),
      })
      .default({}),
    target: z.enum(["_blank", "_self"]).default("_blank"),
    columns: z.number().int().min(1).max(8).optional(),
    editing: z.boolean().default(true),
    refreshInterval: z.number().min(5).default(20),
    pingInterval: z.number().min(5).default(30),
    /** Seconds between readings of widgets with `record: true` or thresholds. */
    metricsInterval: z.number().min(10).default(60),
    /** Refresh open dashboards when a config file changes on disk. */
    liveReload: z.boolean().default(true),
    tabs: z.array(z.string()).optional(),
    history: z.object({ retentionDays: z.number().min(1).max(400).default(90) }).default({}),
    alerts: z
      .object({
        discord: z.string().optional(),
        webhook: z.string().optional(),
        /** Gotify server URL and an app token. */
        gotify: z.string().optional(),
        gotifyToken: z.string().optional(),
        /** ntfy topic URL (e.g. https://ntfy.sh/my-homelab) and an optional access token. */
        ntfy: z.string().optional(),
        ntfyToken: z.string().optional(),
        /** Slack incoming-webhook URL. */
        slack: z.string().optional(),
        /** Telegram bot token (from @BotFather) and the chat to post in (an id like 123456789 or -100…, or @channel). */
        telegramToken: z.string().optional(),
        telegramChat: z.string().optional(),
        threshold: z.number().int().min(1).default(2),
        /** Warn this many days before an HTTPS certificate of a checked service expires (0 = never). */
        certDays: z.number().int().min(0).default(14),
        /** Sender name: Discord username, Gotify and ntfy title (default "Page"). */
        title: z.string().optional(),
        /** Message templates with {{variables}} (see renderTemplate in lib/alerts.ts); empty keeps the built-in text. */
        messages: z.object({ down: z.string().optional(), up: z.string().optional(), notice: z.string().optional() }).optional(),
        /** JSON body for the generic webhook, with {{variables}}; empty sends Page's own JSON. */
        webhookBody: z.string().optional(),
      })
      .default({}),
    auth: authSchema,
    finance: z
      .object({
        /** Currency for summaries and charts (transactions in other currencies are listed, not summed). */
        currency: z.string().length(3).default("EUR"),
        /** Sync transactions daily from the Firefly III widget of this service id (e.g. money.firefly). */
        fireflyService: z.string().optional(),
        /** Alert when a category's monthly budget is used up ("over"), also at 80% ("warn"), or never. */
        budgetAlerts: z.enum(["off", "over", "warn"]).default("over"),
      })
      .default({}),
    updates: z
      .object({
        /** Look for a new version every 6 hours. */
        check: z.boolean().default(true),
        /** stable: GitHub releases; edge: every commit on main (the :latest image). */
        channel: z.enum(["stable", "edge"]).default("stable"),
        /** Tell the alert channels once per new version. */
        notify: z.boolean().default(true),
        /** Install new versions automatically during `window`. */
        auto: z.boolean().default(false),
        /** Hour (HH:MM, server time) to auto-install; checked hourly. */
        window: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM")
          .default("04:00"),
        /** GitHub owner/repo to check; defaults to the repo the image was built from. */
        repo: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/, "owner/repo")
          .optional(),
        /** Image repository to pull (without tag); defaults to the one this container runs. */
        image: z.string().optional(),
      })
      .default({}),
    docker: z
      .object({
        discovery: z.boolean().default(false),
        hosts: z.array(z.object({ name: z.string(), host: z.string().optional() })).default([{ name: "local" }]),
      })
      .default({}),
  })
  .default({});

export const widgetSchema = z.object({ type: z.string().min(1) }).passthrough();

export const checkTypes = ["http", "tcp", "udp", "icmp", "dns", "snmp", "minecraft"] as const;

/** `ping:` as an object: a typed status check (true / a URL stay the HTTP shorthand). */
export const checkSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    /** Defaults to the service link. */
    url: z.string().optional(),
    method: z.enum(["HEAD", "GET"]).optional(),
    /** Status codes that count as up (default: anything below 500). */
    expect: z.array(z.coerce.number().int()).optional(),
    /** The body must contain this text. */
    keyword: z.string().optional(),
    /** A JSON value that must match `equals`, e.g. "$.status" or "checks[0].ok". */
    jsonPath: z.string().optional(),
    equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    /** Accept self-signed certificates (default true: checks are about reachability). */
    insecure: z.boolean().default(true),
  }),
  z.object({ type: z.literal("tcp"), host: z.string().min(1), port: z.coerce.number().int().min(1).max(65535) }),
  z.object({
    type: z.literal("udp"),
    host: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    /** What to send: text, or bytes as hex ("0x…"). Default: one zero byte. Up = any reply. */
    payload: z.string().optional(),
    /** The reply must contain this text. */
    expect: z.string().optional(),
  }),
  z.object({ type: z.literal("icmp"), host: z.string().min(1) }),
  z.object({
    type: z.literal("minecraft"),
    host: z.string().min(1),
    /** Default 25565 (Java) or 19132 (Bedrock). */
    port: z.coerce.number().int().min(1).max(65535).optional(),
    edition: z.enum(["java", "bedrock"]).default("java"),
  }),
  z.object({
    type: z.literal("dns"),
    /** Name to resolve. */
    host: z.string().min(1),
    /** DNS server to ask (default: the system resolver), e.g. 10.0.0.53 or 10.0.0.53:5353. */
    server: z.string().optional(),
    record: z.enum(["A", "AAAA", "CNAME", "MX", "TXT"]).default("A"),
    /** One of the answers must equal this. */
    expect: z.string().optional(),
  }),
  z.object({
    type: z.literal("snmp"),
    host: z.string().min(1),
    port: z.coerce.number().int().default(161),
    community: z.string().default("public"),
    version: z.enum(["1", "2c"]).default("2c"),
    /** Default: sysUpTime. */
    oid: z.string().default("1.3.6.1.2.1.1.3.0"),
  }),
]);
export type CheckSpec = z.infer<typeof checkSchema>;

export const serviceSchema = z.object({
  name: z.string().min(1),
  href: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  ping: z.union([z.boolean(), z.string(), checkSchema]).optional(),
  size: z.enum(tileSizes).optional(),
  alert: z.boolean().optional(),
  visible,
  widget: widgetSchema.optional(),
  source: z.literal("docker").optional(), // set on services found through Docker labels
});

export const serviceGroupSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional(),
  tab: z.string().optional(),
  visible,
  columns: z.number().int().min(1).max(8).optional(),
  collapsed: z.boolean().optional(),
  services: z.array(serviceSchema).default([]),
});

export const bookmarkSchema = z.object({
  name: z.string().min(1),
  href: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
});

export const bookmarkGroupSchema = z.object({
  name: z.string().min(1),
  tab: z.string().optional(),
  visible,
  links: z.array(bookmarkSchema).default([]),
});

export const servicesFileSchema = z.array(serviceGroupSchema).default([]);
export const bookmarksFileSchema = z.array(bookmarkGroupSchema).default([]);
export const infoWidgetSchema = z.object({ type: z.string().min(1), visible }).passthrough();
export const widgetsFileSchema = z.array(infoWidgetSchema).default([]);

export type Settings = z.infer<typeof settingsSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type ServiceGroup = z.infer<typeof serviceGroupSchema>;
export type Bookmark = z.infer<typeof bookmarkSchema>;
export type BookmarkGroup = z.infer<typeof bookmarkGroupSchema>;
export type InfoWidget = z.infer<typeof infoWidgetSchema>;
export type TileSize = (typeof tileSizes)[number];

export const configFiles = {
  settings: settingsSchema,
  services: servicesFileSchema,
  bookmarks: bookmarksFileSchema,
  widgets: widgetsFileSchema,
} as const;
export type ConfigFile = keyof typeof configFiles;

/** Widget keys whose values never leave the server. */
export const SECRET_KEYS = ["key", "apikey", "password", "token", "secret", "clientsecret", "bindpassword", "community"];
export const isSecretKey = (k: string) => SECRET_KEYS.includes(k.toLowerCase());
/** Settings values that never leave the server (webhook URLs embed tokens). */
export const SETTINGS_SECRETS = ["alerts.discord", "alerts.webhook", "alerts.gotifyToken", "alerts.ntfy", "alerts.ntfyToken", "alerts.slack", "alerts.telegramToken"];
/** Placeholder shown to the editor in place of a secret value. */
export const MASK = "••••••••";
