import type { FieldSpec } from "@/integrations/fields";

// Client-safe description of each info widget's config, used by the editor.
export const infoFields: Record<string, { label: string; fields: FieldSpec[] }> = {
  greeting: {
    label: "Greeting & clock",
    fields: [
      { key: "name", label: "Your name", placeholder: "Shown as “Good morning, …”" },
      { key: "hour12", label: "12-hour clock", kind: "boolean" },
      { key: "timezone", label: "Time zone", placeholder: "Europe/Paris (default: browser)" },
    ],
  },
  clock: {
    label: "Clock & world clocks",
    fields: [
      { key: "timezone", label: "Time zone", placeholder: "Europe/Paris (default: browser)" },
      { key: "zones", label: "Other time zones", kind: "list", placeholder: "Tokyo=Asia/Tokyo, America/New_York", help: "Label=Zone, or just the zone. Comma separated." },
      { key: "hour12", label: "12-hour clock", kind: "boolean" },
      { key: "seconds", label: "Show seconds", kind: "boolean" },
    ],
  },
  trip: {
    label: "Next trip",
    fields: [{ key: "label", label: "Label", placeholder: "Next trip" }],
  },
  status: {
    label: "Services up / down",
    fields: [],
  },
  finance: {
    label: "Finance this month",
    fields: [
      { key: "show", label: "Show", kind: "list", placeholder: "spent, income, budgets", help: "Any of: spent, income, net, balance, budgets." },
      { key: "currency", label: "Currency", placeholder: "EUR (default: the finance currency)" },
    ],
  },
  weather: {
    label: "Weather",
    fields: [
      { key: "label", label: "Place name", placeholder: "Paris" },
      { key: "latitude", label: "Latitude", kind: "number", required: true },
      { key: "longitude", label: "Longitude", kind: "number", required: true },
      { key: "units", label: "Units", kind: "select", options: ["metric", "imperial"] },
    ],
  },
  resources: {
    label: "Host resources",
    fields: [
      { key: "label", label: "Label", placeholder: "Server" },
      { key: "disks", label: "Disks", kind: "list", placeholder: "/, /mnt/data", help: "Mount points, comma separated." },
    ],
  },
  glances: {
    label: "Remote host (Glances)",
    fields: [
      { key: "url", label: "Glances URL", placeholder: "http://nas:61208", required: true },
      { key: "label", label: "Label", placeholder: "NAS" },
      { key: "version", label: "API version", kind: "select", options: ["4", "3"] },
      { key: "disks", label: "Disks", kind: "list", placeholder: "/, /mnt/data", help: "Mount points, comma separated." },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
    ],
  },
  prometheus: {
    label: "Prometheus stats",
    fields: [
      { key: "url", label: "URL", placeholder: "http://prometheus:9090", required: true },
      { key: "label", label: "Label", placeholder: "Cluster" },
      {
        key: "queries",
        label: "Queries",
        kind: "yaml",
        required: true,
        placeholder: '- label: Pods\n  query: sum(kube_pod_status_phase{phase="Running"})\n- label: Alerts\n  query: count(ALERTS{alertstate="firing"}) or vector(0)\n  warn: 1',
        help: "format, decimals, suffix, warn and error work as in the Prometheus service widget.",
      },
      { key: "username", label: "Username (basic auth)" },
      { key: "password", label: "Password", secret: true },
      { key: "token", label: "Bearer token", secret: true },
    ],
  },
  markets: {
    label: "Markets",
    fields: [
      { key: "symbols", label: "Stocks / indices", kind: "list", placeholder: "AAPL, ^GSPC, MC.PA", help: "Yahoo Finance symbols." },
      { key: "crypto", label: "Crypto", kind: "list", placeholder: "bitcoin, ethereum", help: "CoinGecko coin ids." },
      { key: "currency", label: "Crypto currency", placeholder: "usd" },
    ],
  },
  currency: {
    label: "Exchange rates",
    fields: [
      { key: "base", label: "Base currency", placeholder: "EUR", required: true },
      { key: "symbols", label: "Currencies", kind: "list", placeholder: "USD, GBP, CHF", required: true },
    ],
  },
};
