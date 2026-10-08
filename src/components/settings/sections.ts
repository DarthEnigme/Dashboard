import { Activity, Archive, ArrowUpCircle, Container, LayoutGrid, Palette, PiggyBank, RefreshCw, Settings2, Users, Wallpaper, type LucideIcon } from "lucide-react";
import { glowLevels, gradientPresets, stylePresets, themes } from "@/lib/config/schema";
import type { FieldSpec } from "@/integrations/fields";

const ALERT_VARS = "{{service}}, {{status}}, {{reason}}, {{duration}}, {{since}}, {{url}}, {{message}}, {{level}}, {{time}}";

/** Panels with their own UI next to (or instead of) the fields. */
export type SectionExtra = "testAlert" | "users" | "backup" | "looks" | "updates";

export interface Section {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  fields: FieldSpec[];
  extra?: SectionExtra;
}

export const sections: Section[] = [
  {
    id: "general",
    label: "General",
    icon: Settings2,
    description: "Name of the dashboard and how links open.",
    fields: [
      { key: "title", label: "Title", required: true },
      { key: "description", label: "Subtitle" },
      { key: "target", label: "Open links in", kind: "select", options: ["_blank", "_self"], help: "_blank opens a new tab." },
      { key: "tabs", label: "Tab order", kind: "list", placeholder: "Home, Media, Infra", help: "Groups pick their tab in the group settings." },
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Theme, card style and accent colour. Changes preview immediately; save to keep them.",
    fields: [
      { key: "theme", label: "Theme", kind: "select", options: [...themes], required: true, help: "oled: pure black. sepia: warm paper." },
      { key: "style", label: "Card style", kind: "select", options: [...stylePresets] },
      { key: "accent", label: "Accent colour", kind: "color", help: "Type “auto” to take it from the wallpaper." },
      { key: "glow", label: "Hover glow", kind: "select", options: [...glowLevels], placeholder: "subtle", help: "Edge light that follows the pointer, and an accent glow on hovered cards." },
    ],
    extra: "looks",
  },
  {
    id: "background",
    label: "Background",
    icon: Wallpaper,
    description: "A gradient, or an image of your own.",
    fields: [
      { key: "background.gradient", label: "Gradient", kind: "select", options: [...gradientPresets] },
      {
        key: "background.image",
        label: "Image",
        kind: "image",
        upload: "/api/uploads/backgrounds",
        placeholder: "https://… or upload a file",
        help: "Overrides the gradient. PNG, JPEG, WebP, GIF or AVIF up to 15 MB.",
      },
      { key: "background.brightness", label: "Image brightness", kind: "range", min: 0, max: 1, step: 0.05, placeholder: "0.7" },
      { key: "background.blur", label: "Image blur (px)", kind: "range", min: 0, max: 40, step: 1, placeholder: "0" },
    ],
  },
  {
    id: "layout",
    label: "Layout",
    icon: LayoutGrid,
    description: "Grid and editing.",
    fields: [
      { key: "columns", label: "Max columns per group", kind: "number", help: "Empty means fluid. Groups can override it." },
      { key: "editing", label: "Allow editing in the browser", kind: "boolean", default: true, help: "Turning this off also closes this page; turn it back on in settings.yaml." },
    ],
  },
  {
    id: "refresh",
    label: "Refresh",
    icon: RefreshCw,
    description: "How often data is fetched, and live reloading of the config files.",
    fields: [
      { key: "refreshInterval", label: "Widget refresh (seconds)", kind: "number", placeholder: "20", help: "At least 5." },
      { key: "pingInterval", label: "Status check interval (seconds)", kind: "number", placeholder: "30", help: "At least 5. Also how often the background monitor checks." },
      {
        key: "metricsInterval",
        label: "History recording interval (seconds)",
        kind: "number",
        placeholder: "60",
        help: "For widgets with “Record history” or thresholds. At least 10, and never more often than the status checks.",
      },
      { key: "liveReload", label: "Refresh open dashboards when a config file changes", kind: "boolean", default: true },
    ],
  },
  {
    id: "monitoring",
    label: "Monitoring & alerts",
    icon: Activity,
    description: "Status history and where to send alerts when a service goes down.",
    fields: [
      { key: "history.retentionDays", label: "Keep status history (days)", kind: "number", placeholder: "90" },
      { key: "alerts.discord", label: "Discord webhook URL", secret: true, placeholder: "https://discord.com/api/webhooks/…" },
      { key: "alerts.webhook", label: "Generic webhook URL", secret: true, placeholder: "Home Assistant, n8n…" },
      { key: "alerts.gotify", label: "Gotify server URL", placeholder: "https://gotify.example.com" },
      { key: "alerts.gotifyToken", label: "Gotify app token", secret: true, help: "Apps → Create application." },
      { key: "alerts.ntfy", label: "ntfy topic URL", secret: true, placeholder: "https://ntfy.sh/my-homelab-alerts" },
      { key: "alerts.ntfyToken", label: "ntfy access token", secret: true, help: "Only for protected topics." },
      { key: "alerts.slack", label: "Slack webhook URL", secret: true, placeholder: "https://hooks.slack.com/services/…", help: "Slack app → Incoming Webhooks." },
      { key: "alerts.telegramToken", label: "Telegram bot token", secret: true, help: "From @BotFather. Send your bot a message first so it may write to you." },
      { key: "alerts.telegramChat", label: "Telegram chat", placeholder: "123456789 or @mychannel", help: "Your user or group id (ask @userinfobot), or a channel the bot is admin of." },
      { key: "alerts.certDays", label: "Warn about expiring TLS certificates (days before)", kind: "number", placeholder: "14", help: "For services with an HTTPS status check. 0 turns it off." },
      { key: "alerts.threshold", label: "Alert after N failed checks", kind: "number", placeholder: "2" },
      { key: "alerts.title", label: "Sender name", placeholder: "Page", help: "Discord username, Gotify and ntfy title." },
      {
        key: "alerts.messages.down",
        label: "Message when a service goes down",
        kind: "textarea",
        placeholder: "🔴 {{service}} is DOWN ({{reason}})\n{{url}}",
        help: `Empty keeps the built-in text. Variables: ${ALERT_VARS}.`,
      },
      { key: "alerts.messages.up", label: "Message when a service is back up", kind: "textarea", placeholder: "🟢 {{service}} is back UP after {{duration}}" },
      {
        key: "alerts.messages.notice",
        label: "Message for other notices",
        kind: "textarea",
        placeholder: "[{{level}}] {{message}}",
        help: "Budgets, updates, certificates and thresholds. {{message}} is Page's own text, {{kind}} is budget, update, cert or threshold.",
      },
      {
        key: "alerts.webhookBody",
        label: "Generic webhook body (JSON)",
        kind: "textarea",
        placeholder: '{\n  "text": "{{message}}",\n  "service": "{{service}}",\n  "level": "{{level}}"\n}',
        help: "Empty sends Page's own JSON. Values are escaped for JSON strings, so keep the quotes around them.",
      },
    ],
    extra: "testAlert",
  },
  {
    id: "accounts",
    label: "Accounts & sign-in",
    icon: Users,
    description: "Who can see the dashboard and how people sign in.",
    fields: [
      { key: "auth.publicView", label: "Anyone can view the dashboard without signing in", kind: "boolean", default: true },
      { key: "auth.local.enabled", label: "Allow username/password sign-in", kind: "boolean", default: true },
      { key: "auth.defaultRole", label: "Role for new accounts", kind: "select", options: ["user", "admin"] },
      {
        key: "auth.userPermissions",
        label: "Every signed-in user may",
        kind: "list",
        placeholder: "finance",
        help: "Comma-separated: finance (the finance tracker), actions (start/stop buttons). Empty field = finance. Groups below can add more.",
      },
      { key: "auth.baseUrl", label: "Public URL (for SSO redirects)", placeholder: "https://home.example.com" },
      {
        key: "auth.providers",
        label: "Single sign-on providers",
        kind: "yaml",
        placeholder:
          "- id: authentik\n  type: oidc          # oidc | google | github\n  name: Authentik\n  issuer: https://auth.example.com/application/o/page/\n  clientId: page\n  clientSecret: \"{{HOMEPAGE_VAR_OIDC_SECRET}}\"\n  signup: false       # only existing accounts may sign in\n  adminGroup: admins",
        help: "Callback URL: <public URL>/api/auth/oauth/<id>/callback",
      },
      {
        key: "auth.ldap",
        label: "LDAP",
        kind: "yaml",
        placeholder:
          "enabled: true\nurl: ldap://lldap:3890\nbindDN: uid=admin,ou=people,dc=example,dc=com\nbindPassword: \"{{HOMEPAGE_VAR_LDAP_PASSWORD}}\"\nbaseDN: ou=people,dc=example,dc=com\nuserFilter: (uid={{username}})\nadminGroup: cn=admins,ou=groups,dc=example,dc=com",
      },
      {
        key: "auth.proxy",
        label: "Reverse-proxy sign-in (forward auth)",
        kind: "yaml",
        placeholder: "enabled: true\nsecret: \"{{HOMEPAGE_VAR_PROXY_SECRET}}\"   # sent by the proxy as X-Page-Proxy-Secret\nadminGroup: admins",
      },
    ],
    extra: "users",
  },
  {
    id: "docker",
    label: "Docker",
    icon: Container,
    description: "Build services from container labels.",
    fields: [
      { key: "docker.discovery", label: "Discover services from Docker labels", kind: "boolean" },
      { key: "docker.hosts", label: "Docker hosts", kind: "yaml", placeholder: "- name: local\n- name: nas\n  host: tcp://192.168.1.10:2375" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: PiggyBank,
    description: "The built-in finance tracker.",
    fields: [
      { key: "finance.currency", label: "Currency", placeholder: "EUR", help: "Three-letter code used for totals and charts." },
      { key: "finance.fireflyService", label: "Sync from Firefly III service", placeholder: "money.firefly", help: "Id of a service with a firefly widget; synced daily." },
      {
        key: "finance.budgetAlerts",
        label: "Budget alerts",
        kind: "select",
        options: ["over", "warn", "off"],
        placeholder: "over",
        help: "Sent to the alert channels once a month per category: when a budget is used up (over), or also at 80% (warn).",
      },
    ],
  },
  {
    id: "updates",
    label: "Updates",
    icon: ArrowUpCircle,
    description: "New versions of Page: check, read what changed, and install with one click (Docker).",
    fields: [
      { key: "updates.check", label: "Check for new versions every 6 hours", kind: "boolean", default: true },
      { key: "updates.channel", label: "Channel", kind: "select", options: ["stable", "edge"], placeholder: "stable", help: "stable: releases only. edge: every change on main (the :latest image)." },
      { key: "updates.notify", label: "Send an alert when a new version is out", kind: "boolean", default: true, help: "Uses the channels from Monitoring & alerts." },
      { key: "updates.auto", label: "Install new versions automatically", kind: "boolean", default: false },
      { key: "updates.window", label: "Automatic install time", placeholder: "04:00", help: "Server time, HH:MM. Checked hourly." },
      { key: "updates.repo", label: "GitHub repository", placeholder: "owner/page", help: "Defaults to the repository the image was built from." },
      { key: "updates.image", label: "Image", placeholder: "ghcr.io/owner/page", help: "Defaults to the image this container runs." },
    ],
    extra: "updates",
  },
  {
    id: "backup",
    label: "Backup & history",
    icon: Archive,
    description: "Every save keeps the previous version. Download all config files, or import from Homepage.",
    fields: [],
    extra: "backup",
  },
];

