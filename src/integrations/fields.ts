// Client-safe description of each integration's config, used by the editor dialog.
export interface FieldSpec {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  /**
   * "list": comma-separated strings. "yaml": nested values (objects, arrays) edited as YAML.
   * "textarea": multi-line text. "image": a URL, or a file uploaded to `upload`.
   */
  kind?: "text" | "number" | "boolean" | "select" | "color" | "list" | "yaml" | "range" | "textarea" | "image" | "audience";
  /** "image" only: endpoint taking a multipart `file` and answering { url }. */
  upload?: string;
  options?: string[];
  /** "range" only. */
  min?: number;
  max?: number;
  step?: number;
  /** "range" only: words that also stand for a value (the glow's old none / subtle / strong). */
  aliases?: Record<string, number>;
  required?: boolean;
  help?: string;
  /** Value when the key is absent; a value equal to it is removed from the YAML. */
  default?: boolean;
}

/** Integration types that offer admin actions (start/stop…); kept in sync with the registry by a test. */
export const ACTION_TYPES = new Set(["docker", "proxmox", "dockhand", "arcane", "pelican"]);

const promQueriesPlaceholder =
  '- label: CPU\n  query: 100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))\n  format: percent\n  warn: 75\n  error: 90\n  chart: true\n- label: Memory\n  query: sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)\n  format: bytes';

export const integrationFields: Record<string, { label: string; fields: FieldSpec[] }> = {
  docker: {
    label: "Docker container",
    fields: [
      { key: "container", label: "Container name", placeholder: "jellyfin", required: true },
      { key: "host", label: "Docker host", placeholder: "unix:///var/run/docker.sock or tcp://10.0.0.2:2375", help: "Leave empty to use the local socket." },
    ],
  },
  portainer: {
    label: "Portainer",
    fields: [
      { key: "url", label: "URL", placeholder: "https://portainer.local:9443", required: true },
      { key: "key", label: "API key", secret: true, required: true },
      { key: "env", label: "Environment ID", kind: "number", placeholder: "1" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  proxmox: {
    label: "Proxmox VE",
    fields: [
      { key: "url", label: "URL", placeholder: "https://pve.local:8006", required: true },
      { key: "username", label: "API token ID", placeholder: "api@pam!homepage", required: true },
      { key: "password", label: "API token secret", secret: true, required: true },
      { key: "node", label: "Node (optional)", placeholder: "pve" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
      { key: "backups", label: "Show backups", kind: "boolean", default: true, help: "Needs Datastore.Audit on the backup storages." },
      { key: "backupMaxAge", label: "Flag backups older than (days)", kind: "number", placeholder: "2" },
    ],
  },
  pbs: {
    label: "Proxmox Backup Server",
    fields: [
      { key: "url", label: "URL", placeholder: "https://pbs.local:8007", required: true },
      { key: "username", label: "API token ID", placeholder: "page@pbs!dashboard", required: true, help: "Needs Datastore.Audit and Sys.Audit." },
      { key: "password", label: "API token secret", secret: true, required: true },
      { key: "maxAge", label: "Flag backups older than (days)", kind: "number", placeholder: "2" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  uptimekuma: {
    label: "Uptime Kuma",
    fields: [
      { key: "url", label: "URL", placeholder: "http://uptime.local:3001", required: true },
      { key: "slug", label: "Status page slug", placeholder: "default", required: true },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  customapi: {
    label: "Custom JSON API",
    fields: [
      { key: "url", label: "URL", placeholder: "http://service.local/api/stats", required: true },
      { key: "method", label: "Method", kind: "select", options: ["GET", "POST"] },
      { key: "headers", label: "Headers", kind: "yaml", secret: true, placeholder: "Authorization: Bearer {{HOMEPAGE_VAR_TOKEN}}", help: "Header values are kept on the server." },
      { key: "body", label: "Body (POST)", placeholder: '{"query": "..."}' },
      {
        key: "mappings",
        label: "Fields",
        kind: "yaml",
        placeholder: "- label: Users\n  field: data.users.count\n  format: number   # text | number | percent | bytes | duration",
        help: "Leave empty to show the first few values of the response.",
      },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  pihole: {
    label: "Pi-hole",
    fields: [
      { key: "url", label: "URL", placeholder: "http://pi.hole", required: true },
      { key: "key", label: "Password (v6) / API token (v5)", secret: true },
      { key: "version", label: "Version", kind: "select", options: ["6", "5"] },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  adguard: {
    label: "AdGuard Home",
    fields: [
      { key: "url", label: "URL", placeholder: "http://adguard.local:3000", required: true },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  unifi: {
    label: "UniFi Network",
    fields: [
      { key: "url", label: "URL", placeholder: "https://unifi.local", required: true },
      { key: "username", label: "Local account username", required: true },
      { key: "password", label: "Password", secret: true, required: true },
      { key: "site", label: "Site", placeholder: "default" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  firefly: {
    label: "Firefly III",
    fields: [
      { key: "url", label: "URL", placeholder: "https://firefly.local", required: true },
      { key: "token", label: "Personal access token", secret: true, required: true },
      { key: "currency", label: "Currency", placeholder: "EUR (default: first)" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  ghostfolio: {
    label: "Ghostfolio",
    fields: [
      { key: "url", label: "URL", placeholder: "https://ghostfolio.local", required: true },
      { key: "token", label: "Security token", secret: true, required: true },
      { key: "currency", label: "Base currency", placeholder: "USD" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  homeassistant: {
    label: "Home Assistant",
    fields: [
      { key: "url", label: "URL", placeholder: "http://homeassistant.local:8123", required: true },
      { key: "token", label: "Long-lived access token", secret: true, required: true, help: "Profile → Security → Long-lived access tokens." },
      {
        key: "entities",
        label: "Entities",
        kind: "yaml",
        placeholder: "- sensor.living_room_temperature\n- entity: binary_sensor.front_door\n  label: Front door",
        help: "Leave empty for a summary (lights on, unavailable entities…).",
      },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  truenas: {
    label: "TrueNAS SCALE",
    fields: [
      { key: "url", label: "URL", placeholder: "https://truenas.local", required: true },
      { key: "key", label: "API key", secret: true, required: true },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  synology: {
    label: "Synology DSM",
    fields: [
      { key: "url", label: "URL", placeholder: "https://nas.local:5001", required: true },
      { key: "username", label: "Username", required: true, help: "Use an account without 2-step verification." },
      { key: "password", label: "Password", secret: true, required: true },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  calendar: {
    label: "Calendar",
    fields: [
      {
        key: "sources",
        label: "Sources",
        kind: "yaml",
        required: true,
        placeholder:
          '- type: ical\n  url: https://calendar.example.com/family.ics\n- type: sonarr\n  url: http://sonarr:8989\n  key: "{{HOMEPAGE_VAR_SONARR_KEY}}"\n- type: radarr\n  url: http://radarr:7878\n  key: "{{HOMEPAGE_VAR_RADARR_KEY}}"',
      },
      { key: "days", label: "Days ahead", kind: "number", placeholder: "14" },
      { key: "timezone", label: "Time zone", placeholder: "Europe/Paris" },
    ],
  },
  rss: {
    label: "RSS / Atom feed",
    fields: [
      { key: "urls", label: "Feed URLs", kind: "list", required: true, placeholder: "https://example.com/feed.xml, https://…" },
      { key: "limit", label: "Max items", kind: "number", placeholder: "10" },
    ],
  },
  finance: {
    label: "Finance tracker",
    fields: [
      { key: "period", label: "Period", kind: "select", options: ["month", "year"], help: "Data comes from the Finance page (signed-in users only by default)." },
      { key: "chart", label: "Main chart", kind: "select", options: ["donut", "sankey"], help: "Wide and large tiles: spending by category, or the money flow from income to spending." },
    ],
  },
  prometheus: {
    label: "Prometheus (PromQL)",
    fields: [
      { key: "url", label: "URL", placeholder: "http://prometheus:9090", required: true, help: "Also works with Thanos, Mimir and VictoriaMetrics." },
      {
        key: "queries",
        label: "Queries",
        kind: "yaml",
        placeholder: promQueriesPlaceholder,
        help: "Each query should return one value. format: number, percent (0–100), ratio (0–1), bytes, bytesPerSec, duration. warn/error thresholds; chart: true draws a sparkline.",
      },
      { key: "targets", label: "Show scrape targets up/down", kind: "boolean" },
      { key: "range", label: "Sparkline window", placeholder: "1h" },
      { key: "username", label: "Username (basic auth)" },
      { key: "password", label: "Password", secret: true },
      { key: "token", label: "Bearer token", secret: true },
      { key: "headers", label: "Headers", kind: "yaml", secret: true, placeholder: "X-Scope-OrgID: tenant-1" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  grafana: {
    label: "Grafana",
    fields: [
      { key: "url", label: "URL", placeholder: "http://grafana:3000", required: true },
      { key: "token", label: "Service account token", secret: true, help: "Viewer role is enough. Without a token only health is shown." },
      {
        key: "panels",
        label: "Panels on the service page",
        kind: "yaml",
        placeholder: "- dashboard: rYdddlPWk   # dashboard UID\n  panel: 2\n  title: CPU\n  from: now-6h",
        help: "Needs allow_embedding = true in grafana.ini; viewers must be signed in to Grafana (or anonymous access on).",
      },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  glances: {
    label: "Glances",
    fields: [
      { key: "url", label: "URL", placeholder: "http://server:61208", required: true },
      { key: "version", label: "API version", kind: "select", options: ["4", "3"], help: "4 for Glances 4.x, 3 for 3.x." },
      { key: "disks", label: "Disks", kind: "list", placeholder: "/, /mnt/data", help: "Mount points to list (default: all)." },
      { key: "chart", label: "CPU sparkline", kind: "boolean", default: true },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  netdata: {
    label: "Netdata",
    fields: [
      { key: "url", label: "URL", placeholder: "http://server:19999", required: true },
      { key: "chart", label: "CPU sparkline", kind: "boolean", default: true },
      { key: "token", label: "Bearer token", secret: true },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  metric: {
    label: "Generic metric (JSON / InfluxDB)",
    fields: [
      { key: "source", label: "Source", kind: "select", options: ["json", "influxdb"] },
      { key: "url", label: "URL", placeholder: "http://beszel:8090/api/stats or http://influxdb:8086", required: true },
      {
        key: "metrics",
        label: "Metrics",
        kind: "yaml",
        required: true,
        placeholder:
          '# json: a path into the response\n- label: Load\n  path: data.load[0]\n  warn: 2\n# influxdb: a Flux query (last _value)\n- label: Power\n  query: from(bucket: "home") |> range(start: -1h) |> filter(fn: (r) => r._field == "watts")\n  suffix: " W"\n  chart: true',
      },
      { key: "token", label: "InfluxDB token", secret: true },
      { key: "org", label: "InfluxDB organisation" },
      { key: "headers", label: "Headers", kind: "yaml", secret: true, placeholder: "Authorization: Bearer {{HOMEPAGE_VAR_TOKEN}}" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  dockhand: {
    label: "Dockhand",
    fields: [
      { key: "url", label: "URL", placeholder: "http://dockhand:3000", required: true },
      { key: "token", label: "API token", secret: true, help: "Profile → API tokens (dh_…). Not needed when Dockhand authentication is off." },
      { key: "env", label: "Environment ID", kind: "number", placeholder: "1" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  pelican: {
    label: "Pelican Panel",
    fields: [
      { key: "url", label: "Panel URL", placeholder: "https://panel.example.com", required: true },
      { key: "key", label: "Client API key", secret: true, required: true, help: "Account → API Credentials (ptlc_… or pacc_…). Pterodactyl works too." },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  wireguard: {
    label: "WireGuard (wg-easy)",
    fields: [
      { key: "url", label: "wg-easy URL", placeholder: "http://wg-easy:51821", required: true },
      { key: "username", label: "Username", help: "wg-easy 15 and later. Leave empty for wg-easy 14 (password only)." },
      { key: "password", label: "Password", secret: true, required: true },
      { key: "onlineMinutes", label: "Connected = handshake within (minutes)", kind: "number", placeholder: "3" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  minecraft: {
    label: "Minecraft server",
    fields: [
      { key: "host", label: "Host", placeholder: "mc.example.com", required: true },
      { key: "edition", label: "Edition", kind: "select", options: ["java", "bedrock"], placeholder: "java" },
      { key: "port", label: "Port", kind: "number", placeholder: "25565 (Java) / 19132 (Bedrock)" },
    ],
  },
  arcane: {
    label: "Arcane",
    fields: [
      { key: "url", label: "URL", placeholder: "http://arcane:3552", required: true },
      { key: "key", label: "API key", secret: true, required: true, help: "Settings → API Keys." },
      { key: "env", label: "Environment ID", placeholder: "0", help: "0 is the local Docker host." },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  opnsense: {
    label: "OPNsense",
    fields: [
      { key: "url", label: "URL", placeholder: "https://opnsense.local", required: true },
      { key: "username", label: "API key", required: true, help: "System → Access → Users → API keys." },
      { key: "password", label: "API secret", secret: true, required: true },
      { key: "wan", label: "WAN interface", placeholder: "wan" },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean", default: true },
    ],
  },
  pfsense: {
    label: "pfSense (REST API package)",
    fields: [
      { key: "url", label: "URL", placeholder: "https://pfsense.local", required: true },
      { key: "key", label: "API key", secret: true, required: true, help: "System → REST API → Keys (package v2)." },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean", default: true },
    ],
  },
  npm: {
    label: "Nginx Proxy Manager",
    fields: [
      { key: "url", label: "URL", placeholder: "http://npm:81", required: true },
      { key: "username", label: "Email", required: true },
      { key: "password", label: "Password", secret: true, required: true },
      { key: "certDays", label: "Flag certificates expiring within (days)", kind: "number", placeholder: "14" },
    ],
  },
  traefik: {
    label: "Traefik",
    fields: [
      { key: "url", label: "API URL", placeholder: "http://traefik:8080", required: true },
      { key: "username", label: "Username (basic auth)" },
      { key: "password", label: "Password", secret: true },
      { key: "insecure", label: "Allow self-signed TLS", kind: "boolean" },
    ],
  },
  tailscale: {
    label: "Tailscale",
    fields: [
      { key: "key", label: "API access token", secret: true, required: true, help: "Admin console → Settings → Keys." },
      { key: "tailnet", label: "Tailnet", placeholder: "- (the token's tailnet)" },
      { key: "expiryDays", label: "Flag node keys expiring within (days)", kind: "number", placeholder: "14" },
    ],
  },
  cloudflare: {
    label: "Cloudflare Tunnels",
    fields: [
      { key: "account", label: "Account ID", required: true },
      { key: "key", label: "API token", secret: true, required: true, help: "Needs Account → Cloudflare Tunnel → Read." },
      { key: "tunnel", label: "Only this tunnel", placeholder: "all tunnels" },
    ],
  },
  immich: {
    label: "Immich",
    fields: [
      { key: "url", label: "URL", placeholder: "http://immich:2283", required: true },
      { key: "key", label: "API key (admin)", secret: true, required: true },
    ],
  },
  nextcloud: {
    label: "Nextcloud",
    fields: [
      { key: "url", label: "URL", placeholder: "https://cloud.example.com", required: true },
      { key: "token", label: "Server info token", secret: true, help: "occ config:app:set serverinfo token --value <token>. Or use an admin login below." },
      { key: "username", label: "Admin username" },
      { key: "password", label: "App password", secret: true },
    ],
  },
  gitea: {
    label: "Gitea / Forgejo",
    fields: [
      { key: "url", label: "URL", placeholder: "https://git.example.com", required: true },
      { key: "key", label: "Access token", secret: true, required: true, help: "Settings → Applications (read scopes are enough)." },
    ],
  },
  speedtest: {
    label: "Speedtest Tracker",
    fields: [
      { key: "url", label: "URL", placeholder: "http://speedtest:8080", required: true },
      { key: "key", label: "API token", secret: true, help: "Needed for v0.20+ (version 1)." },
      { key: "version", label: "API version", kind: "select", options: ["1", "0"], placeholder: "1" },
    ],
  },
  paperless: {
    label: "Paperless-ngx",
    fields: [
      { key: "url", label: "URL", placeholder: "http://paperless:8000", required: true },
      { key: "key", label: "API token", secret: true, required: true },
    ],
  },
  authentik: {
    label: "Authentik",
    fields: [
      { key: "url", label: "URL", placeholder: "https://auth.example.com", required: true },
      { key: "key", label: "API token", secret: true, required: true },
    ],
  },
  jellyfin: {
    label: "Jellyfin / Emby",
    fields: [
      { key: "url", label: "URL", placeholder: "http://jellyfin:8096", required: true },
      { key: "key", label: "API key", secret: true, required: true, help: "Dashboard → API Keys." },
    ],
  },
  plex: {
    label: "Plex",
    fields: [
      { key: "url", label: "URL", placeholder: "http://plex:32400", required: true },
      { key: "key", label: "X-Plex-Token", secret: true, required: true },
    ],
  },
  tautulli: {
    label: "Tautulli",
    fields: [
      { key: "url", label: "URL", placeholder: "http://tautulli:8181", required: true },
      { key: "key", label: "API key", secret: true, required: true },
    ],
  },
  arr: {
    label: "Sonarr / Radarr / Lidarr / Readarr / Prowlarr",
    fields: [
      { key: "app", label: "App", kind: "select", options: ["sonarr", "radarr", "lidarr", "readarr", "prowlarr"], required: true },
      { key: "url", label: "URL", placeholder: "http://sonarr:8989", required: true },
      { key: "key", label: "API key", secret: true, required: true, help: "Settings → General." },
    ],
  },
  overseerr: {
    label: "Overseerr / Jellyseerr",
    fields: [
      { key: "url", label: "URL", placeholder: "http://overseerr:5055", required: true },
      { key: "key", label: "API key", secret: true, required: true },
    ],
  },
  qbittorrent: {
    label: "qBittorrent",
    fields: [
      { key: "url", label: "URL", placeholder: "http://qbittorrent:8080", required: true },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
    ],
  },
  transmission: {
    label: "Transmission",
    fields: [
      { key: "url", label: "URL", placeholder: "http://transmission:9091", required: true },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
      { key: "rpcPath", label: "RPC path", placeholder: "/transmission/rpc" },
    ],
  },
  sabnzbd: {
    label: "SABnzbd",
    fields: [
      { key: "url", label: "URL", placeholder: "http://sabnzbd:8080", required: true },
      { key: "key", label: "API key", secret: true, required: true },
    ],
  },
  frigate: {
    label: "Frigate",
    fields: [{ key: "url", label: "URL", placeholder: "http://frigate:5000", required: true }],
  },
  scrutiny: {
    label: "Scrutiny (disk health)",
    fields: [{ key: "url", label: "URL", placeholder: "http://scrutiny:8080", required: true }],
  },
  gotify: {
    label: "Gotify",
    fields: [
      { key: "url", label: "URL", placeholder: "http://gotify", required: true },
      { key: "key", label: "Client token", secret: true, required: true, help: "A client token (not an app token): Clients → Create." },
    ],
  },
  ntfy: {
    label: "ntfy",
    fields: [{ key: "url", label: "URL", placeholder: "https://ntfy.sh", required: true }],
  },
  snmp: {
    label: "SNMP (switches, NAS, printers, UPS…)",
    fields: [
      { key: "host", label: "Host", placeholder: "10.0.0.2", required: true },
      {
        key: "preset",
        label: "Show",
        kind: "select",
        options: ["system", "interface", "storage", "printer", "custom"],
        placeholder: "system",
        help: "system: uptime and CPU. interface: traffic of one port. storage: RAM and disks. printer: toner and ink. custom: only the OIDs below.",
      },
      { key: "interface", label: "Interface", placeholder: "eth0, Port 5 or an ifIndex", help: "For the interface preset." },
      { key: "community", label: "Community", placeholder: "public", secret: true },
      { key: "version", label: "Version", kind: "select", options: ["2c", "1"], placeholder: "2c" },
      { key: "port", label: "Port", kind: "number", placeholder: "161" },
      {
        key: "oids",
        label: "Extra OIDs",
        kind: "yaml",
        placeholder:
          "- label: Temperature\n  oid: 1.3.6.1.4.1.6574.1.2.0\n  suffix: \" °C\"\n  warn: 60\n- label: WAN in\n  oid: 1.3.6.1.2.1.31.1.1.1.6.2\n  rate: true\n  format: bytesPerSec",
      },
    ],
  },
};
