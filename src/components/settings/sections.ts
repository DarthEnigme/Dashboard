import { Activity, Archive, ArrowUpCircle, Container, LayoutGrid, Palette, PiggyBank, RefreshCw, Settings2, Users, type LucideIcon } from "lucide-react";
import { gradientPresets, stylePresets, themes } from "@/lib/config/schema";
import { GLOW_ALIASES } from "@/lib/theme";
import type { FieldSpec } from "@/integrations/fields";
import { msg } from "@/i18n";

const ALERT_VARS = "{{service}}, {{status}}, {{reason}}, {{duration}}, {{since}}, {{url}}, {{message}}, {{level}}, {{time}}";

/** Panels with their own UI next to (or instead of) the fields. */
export type SectionExtra = "testAlert" | "users" | "backup" | "looks" | "updates";

export interface Section {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  fields: FieldSpec[];
  /** Sub-headings shown before a field (by key); `id` is also a deep link (/settings#background). */
  headings?: Record<string, { id: string; label: string }>;
  /** Settings edited by the section's own panel (not a field), counted for unsaved changes and problems. */
  extraKeys?: string[];
  extra?: SectionExtra;
}

export const sections: Section[] = [
  {
    id: "general",
    label: msg("General"),
    icon: Settings2,
    description: msg("Name of the dashboard and how links open."),
    fields: [
      { key: "title", label: msg("Title"), required: true },
      { key: "language", label: msg("Language"), kind: "select", options: ["auto", "en", "fr"], placeholder: "auto", help: msg("auto follows each visitor's browser. en: English, fr: Français.") },
      { key: "description", label: msg("Subtitle") },
      {
        key: "logo",
        label: msg("Logo"),
        kind: "image",
        upload: "/api/uploads/logos",
        placeholder: "https://… or upload a file",
        help: msg("Next to the title, on the sign-in page, and as the browser and app icon (PNG or JPEG for the icon; square works best). Up to 2 MB."),
      },
      { key: "target", label: msg("Open links in"), kind: "select", options: ["_blank", "_self"], help: msg("_blank opens a new tab.") },
      { key: "tabs", label: msg("Tab order"), kind: "list", placeholder: msg("Home, Media, Infra"), help: msg("Groups pick their tab in the group settings.") },
    ],
  },
  {
    id: "appearance",
    label: msg("Appearance"),
    icon: Palette,
    description: msg("Theme, card style, accent colour and background. Changes preview immediately; save to keep them."),
    fields: [
      { key: "theme", label: msg("Theme"), kind: "select", options: [...themes], required: true, help: msg("oled: pure black. sepia: warm paper.") },
      { key: "style", label: msg("Card style"), kind: "select", options: [...stylePresets] },
      { key: "accent", label: msg("Accent colour"), kind: "color", help: msg("Type “auto” to take it from the wallpaper.") },
      {
        key: "glow",
        label: msg("Hover glow"),
        kind: "range",
        min: 0,
        max: 100,
        step: 5,
        placeholder: "50",
        aliases: GLOW_ALIASES,
        help: msg("Edge light that follows the pointer, and an accent glow on hovered cards. 0 turns it off."),
      },
      { key: "background.gradient", label: msg("Gradient"), kind: "select", options: [...gradientPresets] },
      {
        key: "background.image",
        label: msg("Image"),
        kind: "image",
        upload: "/api/uploads/backgrounds",
        placeholder: "https://… or upload a file",
        help: msg("Overrides the gradient. PNG, JPEG, WebP, GIF or AVIF up to 15 MB."),
      },
      { key: "background.brightness", label: msg("Image brightness"), kind: "range", min: 0, max: 1, step: 0.05, placeholder: "0.7" },
      { key: "background.blur", label: msg("Image blur (px)"), kind: "range", min: 0, max: 40, step: 1, placeholder: "0" },
    ],
    headings: { "background.gradient": { id: "background", label: msg("Background") } },
    extraKeys: ["customThemes"],
    extra: "looks",
  },
  {
    id: "layout",
    label: msg("Layout"),
    icon: LayoutGrid,
    description: msg("Grid and editing."),
    fields: [
      { key: "columns", label: msg("Max columns per group"), kind: "number", help: msg("Empty means fluid. Groups can override it.") },
      { key: "editing", label: msg("Allow editing in the browser"), kind: "boolean", default: true, help: msg("Turning this off also closes this page; turn it back on in settings.yaml.") },
    ],
  },
  {
    id: "refresh",
    label: msg("Refresh"),
    icon: RefreshCw,
    description: msg("How often data is fetched, and live reloading of the config files."),
    fields: [
      { key: "refreshInterval", label: msg("Widget refresh (seconds)"), kind: "number", placeholder: "20", help: msg("At least 5.") },
      { key: "pingInterval", label: msg("Status check interval (seconds)"), kind: "number", placeholder: "30", help: msg("At least 5. Also how often the background monitor checks.") },
      {
        key: "metricsInterval",
        label: msg("History recording interval (seconds)"),
        kind: "number",
        placeholder: "60",
        help: msg("For widgets with “Record history” or thresholds. At least 10, and never more often than the status checks."),
      },
      { key: "liveReload", label: msg("Refresh open dashboards when a config file changes"), kind: "boolean", default: true },
    ],
  },
  {
    id: "monitoring",
    label: msg("Monitoring & alerts"),
    icon: Activity,
    description: msg("Status history and where to send alerts when a service goes down."),
    fields: [
      { key: "history.retentionDays", label: msg("Keep status history (days)"), kind: "number", placeholder: "90" },
      { key: "alerts.discord", label: msg("Discord webhook URL"), secret: true, placeholder: "https://discord.com/api/webhooks/…" },
      { key: "alerts.webhook", label: msg("Generic webhook URL"), secret: true, placeholder: msg("Home Assistant, n8n…") },
      { key: "alerts.gotify", label: msg("Gotify server URL"), placeholder: "https://gotify.example.com" },
      { key: "alerts.gotifyToken", label: msg("Gotify app token"), secret: true, help: msg("Apps → Create application.") },
      { key: "alerts.ntfy", label: msg("ntfy topic URL"), secret: true, placeholder: "https://ntfy.sh/my-homelab-alerts" },
      { key: "alerts.ntfyToken", label: msg("ntfy access token"), secret: true, help: msg("Only for protected topics.") },
      { key: "alerts.slack", label: msg("Slack webhook URL"), secret: true, placeholder: "https://hooks.slack.com/services/…", help: msg("Slack app → Incoming Webhooks.") },
      { key: "alerts.telegramToken", label: msg("Telegram bot token"), secret: true, help: msg("From @BotFather. Send your bot a message first so it may write to you.") },
      { key: "alerts.telegramChat", label: msg("Telegram chat"), placeholder: msg("123456789 or @mychannel"), help: msg("Your user or group id (ask @userinfobot), or a channel the bot is admin of.") },
      { key: "alerts.certDays", label: msg("Warn about expiring TLS certificates (days before)"), kind: "number", placeholder: "14", help: msg("For services with an HTTPS status check. 0 turns it off.") },
      { key: "inventory.warrantyDays", label: msg("Warn about ending device warranties (days before)"), kind: "number", placeholder: "30", help: msg("For devices in the inventory. 0 turns it off.") },
      { key: "alerts.threshold", label: msg("Alert after N failed checks"), kind: "number", placeholder: "2" },
      { key: "alerts.title", label: msg("Sender name"), placeholder: msg("Page"), help: msg("Discord username, Gotify and ntfy title.") },
      {
        key: "alerts.messages.down",
        label: msg("Message when a service goes down"),
        kind: "textarea",
        placeholder: msg("🔴 {{service}} is DOWN ({{reason}})\n{{url}}"),
        help: `Empty keeps the built-in text. Variables: ${ALERT_VARS}.`,
      },
      { key: "alerts.messages.up", label: msg("Message when a service is back up"), kind: "textarea", placeholder: msg("🟢 {{service}} is back UP after {{duration}}") },
      {
        key: "alerts.messages.notice",
        label: msg("Message for other notices"),
        kind: "textarea",
        placeholder: msg("[{{level}}] {{message}}"),
        help: msg("Budgets, updates, certificates and thresholds. {{message}} is Page's own text, {{kind}} is budget, update, cert or threshold."),
      },
      {
        key: "alerts.webhookBody",
        label: msg("Generic webhook body (JSON)"),
        kind: "textarea",
        placeholder: msg("{\n  \"text\": \"{{message}}\",\n  \"service\": \"{{service}}\",\n  \"level\": \"{{level}}\"\n}"),
        help: msg("Empty sends Page's own JSON. Values are escaped for JSON strings, so keep the quotes around them."),
      },
    ],
    extra: "testAlert",
  },
  {
    id: "accounts",
    label: msg("Accounts & sign-in"),
    icon: Users,
    description: msg("Who can see the dashboard and how people sign in."),
    fields: [
      { key: "auth.publicView", label: msg("Anyone can view the dashboard without signing in"), kind: "boolean", default: true },
      { key: "auth.local.enabled", label: msg("Allow username/password sign-in"), kind: "boolean", default: true },
      { key: "auth.defaultRole", label: msg("Role for new accounts"), kind: "select", options: ["user", "admin"] },
      {
        key: "auth.userPermissions",
        label: msg("Every signed-in user may"),
        kind: "list",
        placeholder: msg("finance, travel, watchlist"),
        help: msg("Comma-separated: finance, travel, watchlist (those sections), inventory (the device list), actions (start/stop buttons and switches). Empty field = finance, travel, watchlist. Groups below can add more."),
      },
      { key: "auth.baseUrl", label: msg("Public URL (for SSO redirects)"), placeholder: "https://home.example.com" },
      {
        key: "auth.providers",
        label: msg("Single sign-on providers"),
        kind: "yaml",
        placeholder:
          msg("- id: authentik\n  type: oidc          # oidc | google | github\n  name: Authentik\n  issuer: https://auth.example.com/application/o/page/\n  clientId: page\n  clientSecret: \"{{HOMEPAGE_VAR_OIDC_SECRET}}\"\n  signup: false       # only existing accounts may sign in\n  adminGroup: admins"),
        help: msg("Callback URL: <public URL>/api/auth/oauth/<id>/callback"),
      },
      {
        key: "auth.ldap",
        label: "LDAP",
        kind: "yaml",
        placeholder:
          msg("enabled: true\nurl: ldap://lldap:3890\nbindDN: uid=admin,ou=people,dc=example,dc=com\nbindPassword: \"{{HOMEPAGE_VAR_LDAP_PASSWORD}}\"\nbaseDN: ou=people,dc=example,dc=com\nuserFilter: (uid={{username}})\nadminGroup: cn=admins,ou=groups,dc=example,dc=com"),
      },
      {
        key: "auth.proxy",
        label: msg("Reverse-proxy sign-in (forward auth)"),
        kind: "yaml",
        placeholder: msg("enabled: true\nsecret: \"{{HOMEPAGE_VAR_PROXY_SECRET}}\"   # sent by the proxy as X-Page-Proxy-Secret\nadminGroup: admins"),
      },
    ],
    extra: "users",
  },
  {
    id: "docker",
    label: msg("Docker"),
    icon: Container,
    description: msg("Build services from container labels."),
    fields: [
      { key: "docker.discovery", label: msg("Discover services from Docker labels"), kind: "boolean" },
      { key: "docker.hosts", label: msg("Docker hosts"), kind: "yaml", placeholder: msg("- name: local\n- name: nas\n  host: tcp://192.168.1.10:2375") },
    ],
  },
  {
    id: "finance",
    label: msg("Finance"),
    icon: PiggyBank,
    description: msg("The built-in finance tracker."),
    fields: [
      { key: "finance.currency", label: msg("Currency"), placeholder: "EUR", help: msg("Three-letter code used for totals and charts.") },
      { key: "finance.fireflyService", label: msg("Sync from Firefly III service"), placeholder: "money.firefly", help: msg("Id of a service with a firefly widget; synced daily.") },
      {
        key: "finance.budgetAlerts",
        label: msg("Budget alerts"),
        kind: "select",
        options: ["over", "warn", "off"],
        placeholder: "over",
        help: msg("Sent to the alert channels once a month per category: when a budget is used up (over), or also at 80% (warn)."),
      },
    ],
  },
  {
    id: "updates",
    label: msg("Updates"),
    icon: ArrowUpCircle,
    description: msg("New versions of Page: check, read what changed, and install with one click (Docker)."),
    fields: [
      { key: "updates.check", label: msg("Check for new versions every 6 hours"), kind: "boolean", default: true },
      { key: "updates.channel", label: msg("Channel"), kind: "select", options: ["stable", "edge"], placeholder: "stable", help: msg("stable: releases only. edge: every change on main (the :latest image).") },
      { key: "updates.notify", label: msg("Send an alert when a new version is out"), kind: "boolean", default: true, help: msg("Uses the channels from Monitoring & alerts.") },
      { key: "updates.auto", label: msg("Install new versions automatically"), kind: "boolean", default: false },
      { key: "updates.window", label: msg("Automatic install time"), placeholder: "04:00", help: msg("Server time, HH:MM. Checked hourly.") },
      { key: "updates.repo", label: msg("GitHub repository"), placeholder: "owner/page", help: msg("Defaults to the repository the image was built from.") },
      { key: "updates.image", label: msg("Image"), placeholder: "ghcr.io/owner/page", help: msg("Defaults to the image this container runs.") },
    ],
    extra: "updates",
  },
  {
    id: "backup",
    label: msg("Backup & history"),
    icon: Archive,
    description: msg("Nightly backups of everything, every config change kept with undo, and import from Homepage."),
    fields: [
      { key: "backup.enabled", label: msg("Nightly backups"), kind: "boolean", default: true, help: msg("Config files, the database, uploads and the secret key, in one zip.") },
      { key: "backup.time", label: msg("Backup time"), placeholder: "03:00", help: msg("HH:MM, server time.") },
      { key: "backup.keep", label: msg("Backups to keep"), kind: "number", placeholder: "7" },
      { key: "backup.dir", label: msg("Backup folder"), placeholder: "data/backups", help: msg("Another disk or a mounted share protects against losing the data disk.") },
    ],
    extra: "backup",
  },
];

