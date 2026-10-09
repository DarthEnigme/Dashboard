# Page

A self-hosted homelab dashboard with a frosted-glass look, in the spirit of [Homepage](https://gethomepage.dev).

- **Service tiles:**
  - status pings with a 24-hour uptime history
  - bento tile sizes
  - collapsible groups and tabs
- **Service pages:** 24h–90d availability, response-time charts, incidents
- **Actions:** start, stop and restart Docker containers and Proxmox VMs (admins only)
- **Info bar:** greeting and clock, weather, host resources, stock/crypto prices, exchange rates
- **Integrations:**
  - Proxmox VE (nodes, storage, backups, per-guest charts), Proxmox Backup Server, Portainer, Docker, Uptime Kuma
  - Pi-hole, AdGuard Home, UniFi, OPNsense, pfSense, Traefik, Nginx Proxy Manager, Tailscale, Cloudflare Tunnels, WireGuard (wg-easy, WGDashboard), SNMP
  - Home Assistant, TrueNAS, Synology, Scrutiny, Frigate
  - Jellyfin/Emby, Plex, Tautulli, Sonarr/Radarr/Lidarr/Readarr/Prowlarr, Overseerr/Jellyseerr, qBittorrent, Transmission, SABnzbd
  - Immich, Nextcloud, Gitea/Forgejo, Paperless-ngx, Authentik, Speedtest Tracker, Gotify, ntfy
  - Firefly III, Ghostfolio
  - Prometheus, Grafana, Glances, Netdata, Dockhand, Arcane
  - calendars (iCal, Sonarr, Radarr), RSS, and any JSON API
- **Status checks:** HTTP (status codes, keywords, JSON values), TCP, ICMP, DNS and SNMP, with TLS certificate expiry warnings
- **Widget history:** record any widget's numbers, chart them, and alert when they cross a threshold
- **Finance tracker:** spending, income and balance charts; a money-flow (Sankey) chart; budgets per category with alerts; CSV bank import; Firefly III sync
- **Accounts:**
  - local users, LDAP, OpenID Connect (Authentik, Authelia, Keycloak…), Google, GitHub, or your reverse proxy
  - signups off by default
  - admin/user roles and per-item visibility
- **Alerts:** Discord, Slack, Telegram, Gotify, ntfy, Pushover, Matrix, email or a webhook when a service goes down or comes back
- **Docker auto-discovery** from container labels
- **Installable** as an app (PWA) that shows the last loaded dashboard when offline
- **Config:**
  - YAML files, plus an in-browser editor that writes back to the same files (comments are kept)
  - full change history with one-click undo
  - import from gethomepage.dev
- **Security:** API keys and webhook URLs stay on the server; the browser only ever sees service ids

## Run with Docker

```sh
docker compose up -d
```

Open http://localhost:3000 and choose **Set up** to create the admin account (or set `HOMEPAGE_ADMIN_PASSWORD` to create user `admin` automatically). On first start, example config files are written to `./config`. History, users and finance data are stored in `./data`.

`docker-compose.yml` runs the image CI publishes to `ghcr.io/darthenigme/dashboard` (amd64 and arm64): `:latest` follows `main`, and every release also gets its version tag (`:0.4.0`). To build from source instead, swap `image:` for `build: .` and run `docker compose up -d --build`.

## Updating

**Settings → Updates** shows the running version, the latest one, and what changed. Admins also see a dot on the settings button when a new version is out, and the alert channels get one message per new version.

- **One click:** with the image from GHCR and the Docker socket mounted (as in `docker-compose.yml`), **Update to x.y.z** does the rest:
  1. downloads the new image (progress is shown)
  2. starts a short-lived helper container from it
  3. the helper replaces the Page container with the same name, volumes, ports, networks, env and labels, and waits until it is healthy
  4. if the new version doesn't come up within two minutes, the old container is put back and started again

  Open pages notice the new version and offer a reload. Each attempt is listed under **History**.
- **By hand:** `docker compose pull && docker compose up -d`, or for a source install `git pull && npm ci && npm run build`.
- **Automatically:** set `updates.auto: true` to install new versions at `updates.window`. There is one attempt per version. If the release's image isn't in the registry yet, the attempt doesn't count, and Page tries again at the next window.

```yaml
updates:
  check: true            # look for new versions every 6 hours
  channel: stable        # stable: GitHub releases; edge: every commit on main (the :latest image)
  notify: true           # tell the alert channels once per new version
  auto: false            # install automatically…
  window: "04:00"        # …at this hour (server time)
  repo: owner/page       # optional: defaults to the repo the image was built from
  image: ghcr.io/owner/page  # optional: defaults to the image the container runs
```

The `:ro` flag on the socket mount doesn't limit what the Docker API allows, so the default mount is enough. Without the socket, Page shows the manual steps instead. To publish a release, bump `version` in `package.json`, then push a matching tag (`v0.3.1`). The Docker workflow builds amd64 and arm64 on native runners, pushes the multi-arch image, and only then creates the GitHub release with generated notes. Running Pages never see a version whose image can't be pulled.

## Run locally

Requires Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests
npm run build && npm run e2e   # end-to-end tests in Chromium against mock services (screenshots in test-results/shots)
npm run mock     # fake homelab APIs on http://localhost:4010 for trying integrations
```

The end-to-end tests need the browser once: `npx playwright install chromium`.

## Configuration

Config lives in `./config` (override with `HOMEPAGE_CONFIG_DIR`); history lives in `./data` (`HOMEPAGE_DATA_DIR`). Changes to the files show up in every open dashboard within a second, without a reload (set `liveReload: false` to turn this off). Page watches the folder and also re-checks it every 5 seconds, for bind mounts and network shares that don't report changes. If you have the editor open when a file changes, you're asked before your view is reloaded. A broken file is reported on the page instead of crashing it.

### settings.yaml

```yaml
title: Homelab
description: Optional subtitle
language: auto         # auto (each visitor's browser) | en | fr
theme: dark            # dark | light | system | oled (pure black) | sepia (warm paper)
                       # or a palette: nord | dracula | catppuccin-mocha | catppuccin-latte | solarized | gruvbox | tokyo-night
                       # or one of your own: custom:<id> (see "Custom themes")
style: glass           # glass | liquid | aero | neon | brutal | soft | retro | minimal | solid
logo: /api/uploads/logos/…png   # optional: next to the title, on the sign-in page, and the app icon
accent: "#8b5cf6"      # or "auto" to take it from the wallpaper
glow: 50               # 0–100 (or none | subtle | strong): edge light and accent glow on hovered cards
background:
  gradient: aurora     # aurora | sunset | ocean | midnight | forest | aero | dawn | lagoon | graphite | nebula | synthwave
                       # ember | arctic | rose | mint | dusk | cyberpunk | sand | deep-sea, or custom:<id>
  image: https://...   # optional; overrides the gradient. Or upload a file in Settings → Background
  blur: 0              # px, image only
  brightness: 0.7      # 0-1, image only
columns: 4             # optional max tiles per row (fluid if omitted)
target: _blank         # _blank | _self
editing: true          # set false to disable the browser editor
refreshInterval: 20    # seconds between integration refreshes
pingInterval: 30       # seconds between status checks
liveReload: true       # refresh open dashboards when a config file changes
tabs: [Home, Media]    # optional tab order (see "Tabs")
history:
  retentionDays: 7     # how long status history is kept
alerts:
  discord: "{{HOMEPAGE_VAR_DISCORD_WEBHOOK}}"
  webhook: https://example.com/hook   # receives JSON: service, status, url, since, durationSeconds, message
  gotify: https://gotify.example.com  # with gotifyToken (an app token)
  gotifyToken: "{{HOMEPAGE_VAR_GOTIFY_TOKEN}}"
  ntfy: https://ntfy.sh/my-homelab    # a topic URL; ntfyToken for protected topics
  slack: "{{HOMEPAGE_VAR_SLACK_WEBHOOK}}"     # Slack incoming-webhook URL
  telegramToken: "{{HOMEPAGE_VAR_TELEGRAM_TOKEN}}"   # bot token from @BotFather
  telegramChat: "123456789"           # your user/group id, or @channel (the bot must be allowed to post there)
  email:                              # SMTP
    host: smtp.example.com
    port: 587                         # 587 STARTTLS, or 465 TLS
    user: page@example.com
    password: "{{HOMEPAGE_VAR_SMTP_PASSWORD}}"
    from: page@example.com
    to: me@example.com, you@example.com
  pushoverToken: "{{HOMEPAGE_VAR_PUSHOVER_TOKEN}}"   # an application's API token
  pushoverUser: "{{HOMEPAGE_VAR_PUSHOVER_USER}}"     # your user (or group) key
  matrix: https://matrix.org          # homeserver
  matrixToken: "{{HOMEPAGE_VAR_MATRIX_TOKEN}}"       # access token of the posting account (it must have joined the room)
  matrixRoom: "!abcdefg:matrix.org"   # room id
  threshold: 2         # failed checks in a row before alerting
  certDays: 14         # warn this many days before an HTTPS certificate expires (0 = off)
  title: Homelab       # sender name (Discord username, Gotify/ntfy title); default "Page"
  messages:            # optional templates (see "Alert messages")
    down: "🔴 {{service}} is DOWN ({{reason}})"
    up: "🟢 {{service}} is back after {{duration}}"
    notice: "[{{kind}}] {{message}}"
  webhookBody: '{"text": "{{message}}", "service": "{{service}}"}'   # optional custom JSON for the webhook
docker:
  discovery: false     # build services from container labels
  hosts:
    - name: local      # local socket / DOCKER_HOST
    - name: nas
      host: tcp://192.168.1.10:2375
```

### services.yaml

```yaml
- name: Infrastructure
  tab: Infra                       # optional (see "Tabs")
  columns: 3                       # optional, per group
  collapsed: false                 # default state; each browser remembers its own toggle
  services:
    - name: Proxmox
      href: https://pve.local:8006
      icon: proxmox                # see "Icons"
      description: Hypervisor
      ping: true                   # true = check href, or a URL to check instead
      alert: true                  # set false to never alert for this service
      size: large                  # small | wide (2×1) | tall (1×2) | large (2×2)
      widget:
        type: proxmox
        url: https://pve.local:8006
        username: api@pam!homepage
        password: "{{HOMEPAGE_VAR_PROXMOX_SECRET}}"
        insecure: true             # accept a self-signed certificate
```

The YAML differs from Homepage's: groups and services use an explicit `name:` key. That makes them easier to edit and reorder.

**Tile sizes:**
- `wide` tiles show every integration field.
- `tall` and `large` tiles add a latency chart.
- `large` tiles also show a detail list, e.g. every Proxmox guest or every Uptime Kuma monitor.

### bookmarks.yaml

```yaml
- name: Developer
  tab: Home
  links:
    - name: GitHub
      href: https://github.com
      icon: github
      description: optional
```

### widgets.yaml (info bar)

```yaml
- type: greeting
  name: Alex            # "Good morning, Alex"
  hour12: false
  timezone: Europe/Paris
- type: weather          # Open-Meteo, no key needed
  label: Paris
  latitude: 48.85
  longitude: 2.35
  units: metric          # metric | imperial
- type: resources        # the machine running Page
  disks: ["/", "/mnt/data"]
- type: markets
  symbols: [AAPL, ^GSPC]   # Yahoo Finance symbols (unofficial API, may be delayed or rate-limited)
  crypto: [bitcoin]        # CoinGecko ids
  currency: usd
- type: currency         # ECB reference rates via Frankfurter, no key needed
  base: EUR
  symbols: [USD, GBP]
- type: glances          # same meters as resources, for another machine running `glances -w`
  url: http://nas:61208
  label: NAS
- type: prometheus       # a few PromQL numbers
  url: http://prometheus:9090
  label: Cluster
  queries:
    - { label: Pods, query: 'sum(kube_pod_status_phase{phase="Running"})' }
    - { label: Alerts, query: 'count(ALERTS{alertstate="firing"}) or vector(0)', warn: 1 }
```

In Docker, `resources` reports the host's CPU and memory. To show host disks, mount them read-only (see `docker-compose.yml`) and list the mount points.

### Tabs

Give groups a `tab:` and a tab bar appears; each tab has its own URL (`/media`). The first tab is `/`.
- Groups without a tab go to the first tab, which is called "Home" unless you set `tabs:` in settings.
- The filter searches every tab.

### Secrets

Any value can reference an environment variable as `{{HOMEPAGE_VAR_NAME}}`, or the contents of a file as `{{HOMEPAGE_FILE_NAME}}` (where the env var `HOMEPAGE_FILE_NAME` holds the file path).

These are never sent to the browser:
- the widget fields `key`, `password`, `token` and `secret`
- all request `headers`
- alert webhook URLs
- all `auth` settings, including SSO client secrets, the LDAP bind password and the proxy secret

In the editor they show as masked and keep their stored value unless you type a new one.

### Icons

| Value | Source |
| --- | --- |
| `proxmox` | [Dashboard Icons](https://dashboardicons.com) (svg, png, then webp) |
| `mdi-server` | [Material Design Icons](https://pictogrammers.com/library/mdi/) |
| `si-github` | [Simple Icons](https://simpleicons.org) |
| `https://…` or `/icons/x.png` | A URL, or a file in `public/icons` |

When no icon is set or it fails to load, the tile shows the service's initials.

## Integrations

| type | Fields | Shows |
| --- | --- | --- |
| `proxmox` | `url`, `username` (API token ID, e.g. `api@pam!homepage`), `password` (token secret), `node`, `insecure`, `backups` (default true), `backupMaxAge` (days, default 2) | VMs and LXCs running, CPU, RAM, backups OK; guest list on large tiles. The service page adds each node (CPU, RAM, disk, uptime), storage pools, the newest backup per guest (stale, missing and failed ones flagged), and CPU/memory/network/disk charts per guest (click a guest). Actions: start, shut down, reboot, force stop, take snapshot |
| `pbs` | `url` (`https://pbs:8007`), `username` (API token ID, e.g. `page@pbs!dashboard`), `password` (token secret), `maxAge` (days, default 2), `insecure` | Proxmox Backup Server: fullest datastore, backup groups up to date, newest backup, failed tasks in the last day; every group's age on large tiles; datastores and failures on the service page |
| `portainer` | `url`, `key` (access token), `env` (default 1), `insecure` | Running / stopped / total containers |
| `docker` | `container`, `host` (optional: `unix:///var/run/docker.sock`, `tcp://host:2375`), `updates` (default true) | Status and health, uptime, CPU, RAM; **Image: update available** when the registry has a newer image for the container's tag (checked every 6 hours through the Docker daemon, so private registries use its logins; images pinned by digest or built locally are skipped) |
| `uptimekuma` | `url`, `slug` (status page slug), `insecure` | Monitors up/down, 24h uptime; monitor list on large tiles |
| `pihole` | `url`, `key` (v6 password or v5 API token), `version` (6 or 5) | Queries, blocked, % blocked, clients |
| `adguard` | `url`, `username`, `password` | Queries, blocked, % blocked, latency |
| `unifi` | `url`, `username`, `password` (local account), `site` (default `default`) | Clients, devices online, WAN, latency |
| `firefly` | `url`, `token` (personal access token), `currency` | This month's balance, spent, earned, net worth |
| `ghostfolio` | `url`, `token` (security token), `currency` | Net worth, today, total return |
| `customapi` | `url`, `method`, `headers`, `body`, `mappings` | Any JSON values you map |
| `homeassistant` | `url`, `token` (long-lived access token), `entities` (list of ids, or `{entity, label}`), `controls` (default true) | Those entities' states; without entities: lights/switches on, unavailable. Listed lights, switches, fans, input booleans and covers get a switch on the tile, scenes and scripts a run button (see "Actions") |
| `truenas` | `url`, `key` (API key) | Pool health and usage, alerts, uptime; pool list on large tiles |
| `synology` | `url`, `username`, `password` | CPU, RAM, storage, volume status |
| `calendar` | `sources` (`{type: ical, url}`, `{type: sonarr\|radarr, url, key}`), `days`, `timezone` | Upcoming events; more rows on bigger tiles |
| `rss` | `urls`, `limit` | Latest headlines (links) |
| `finance` | `period` (`month` or `year`), `chart` (`donut` or `sankey`) | Page's own finance tracker: totals, category donut or money flow, monthly bars, balance (by tile size) |
| `prometheus` | `url`, `queries`, `targets`, `range`, `username`/`password` or `token`, `headers` | Your PromQL queries as values with thresholds and sparklines; scrape targets up/down |
| `grafana` | `url`, `token` (service account), `panels` | Firing and pending alerts, dashboards, health; panels embedded on the service page |
| `glances` | `url`, `version` (4 or 3), `disks`, `chart`, `username`, `password` | CPU, RAM, fullest disk, temperature, load, uptime; CPU sparkline; disk list |
| `netdata` | `url`, `chart`, `token` | CPU, RAM, load, active alarms; CPU sparkline; alarm list |
| `metric` | `source` (`json` or `influxdb`), `url`, `metrics`, `headers`, `token`, `org` | Any number from a JSON API (Beszel, Zabbix, scripts) or InfluxDB Flux queries |
| `dockhand` | `url`, `token` (`dh_…`), `env` (default 1) | Running / stopped / unhealthy containers, stacks; start/stop/restart per container |
| `arcane` | `url`, `key` (API key), `env` (default 0) | Running / stopped / unhealthy containers, projects, image updates; start/stop/restart per container |
| `opnsense` | `url`, `username` (API key), `password` (API secret), `wan` (interface, default `wan`) | CPU, WAN traffic totals, pending firmware updates |
| `pfsense` | `url`, `key` (REST API package v2) | CPU, RAM, disk, temperature, gateways up; gateway list on large tiles |
| `npm` | `url`, `username` (email), `password`, `certDays` (default 14) | Nginx Proxy Manager: proxy hosts enabled, redirects, certificates and how many expire soon; certificates by expiry on large tiles |
| `traefik` | `url` (API), `username`/`password` (basic auth, optional) | Routers, services, middlewares, warnings/errors; routers with problems on large tiles |
| `tailscale` | `key` (API access token), `tailnet` (default `-`), `expiryDays` | Devices online, node keys about to expire, client updates; device list on large tiles |
| `cloudflare` | `key` (API token), `account` + `tunnel` (optional) for tunnels, `zone` for a website, `tunnels: false` for the website only | Tunnels: healthy tunnels, connections, edge locations (token: Account → Cloudflare Tunnel → Read). Website (zone ID): requests, cached share, threats, bandwidth and visitors over the last 24 hours, and the zone's status when it isn't active (token: Zone → Analytics → Read) |
| `immich` | `url`, `key` (admin API key) | Photos, videos, storage, users |
| `nextcloud` | `url`, `token` (serverinfo token) or `username`/`password` | Active users (24h), users, files, free space |
| `gitea` | `url`, `key` (access token) | Repositories, open issues and PRs, unread notifications, version (Gitea and Forgejo) |
| `speedtest` | `url`, `key` (v0.20+ API token), `version` (`1` or `0`) | Speedtest Tracker: latest download, upload, ping and when |
| `paperless` | `url`, `key` (API token) | Documents, inbox |
| `authentik` | `url`, `key` (API token) | Active users, logins and failed logins in the last 24 hours |
| `jellyfin` | `url`, `key` (API key) | Jellyfin or Emby: streams, movies, shows, episodes; who is watching what |
| `plex` | `url`, `key` (X-Plex-Token) | Streams, transcodes, libraries; now playing |
| `tautulli` | `url`, `key` | Streams, transcodes, bandwidth; now playing |
| `arr` | `app` (`sonarr`, `radarr`, `lidarr`, `readarr`, `prowlarr`), `url`, `key` | Queue, missing, health issues (Prowlarr: indexers up); issues listed on large tiles |
| `overseerr` | `url`, `key` | Overseerr or Jellyseerr: pending, processing, available and total requests |
| `qbittorrent` | `url`, `username`, `password` | Download/upload speed, downloading, seeding, errors |
| `transmission` | `url`, `username`, `password`, `rpcPath` | Download/upload speed, active and total torrents |
| `sabnzbd` | `url`, `key` | Speed, queue, size left, time left (or paused) |
| `frigate` | `url` | Cameras streaming, detector inference time, events today, uptime; per-camera fps |
| `scrutiny` | `url` | Disks, failing disks, hottest disk; every disk on large tiles |
| `gotify` | `url`, `key` (client token) | Apps, clients, recent messages |
| `ntfy` | `url` | Messages sent and rate (from `/v1/stats`) |
| `wireguard` | `url` (wg-easy), `password`, `username` (wg-easy 15+; empty for 14), `onlineMinutes` (default 3) | Connected peers (handshake within the last few minutes), enabled/total, traffic; each peer with when it was last seen |
| `wgdashboard` | `url` (with WGDashboard's path prefix, if any), `key` (Settings → API Keys), `config` (one interface, e.g. `wg0`; default all), `insecure` | Connected peers, peers, interfaces up, traffic; every peer with its interface and when it was last seen on large tiles. Peer keys never leave the server |
| `pelican` | `url` (panel), `key` (client API key, `ptlc_…`) | Game servers running/offline, CPU and memory; each server's state. Start, stop, restart and kill buttons (also works with Pterodactyl) |
| `minecraft` | `host`, `edition` (`java`/`bedrock`), `port` | Players online/max, version, ping, the MOTD and who is online (Java). Talks the game's own status protocol: no plugin or query port needed |
| `snmp` | `host`, `preset` (`system`, `interface`, `storage`, `printer`, `custom`), `interface`, `community`, `version` (`2c`/`1`), `oids` | Switches, routers, NAS, UPS and printers. system: uptime, CPU, name. interface: link state, in/out rate with sparklines, speed. storage: RAM and the fullest disk, every volume on large tiles. printer: supply levels. `oids` adds any value (`scale`, `rate: true` for counters, `format`, `warn`/`error`) |

**Prometheus:** each query should return a single value (wrap it in `sum()`, `avg()` or `max()`). It also works with Thanos, Mimir and VictoriaMetrics.

```yaml
widget:
  type: prometheus
  url: http://prometheus:9090
  targets: true                # scrape targets up/down, failing ones listed on large tiles
  range: 1h                    # sparkline window
  queries:
    - label: CPU
      query: 100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))
      format: percent          # number | percent (0–100) | ratio (0–1) | bytes | bytesPerSec | duration | text
      warn: 75                 # amber at or above; add lowerIsWorse: true to flip
      error: 90
      chart: true              # sparkline on tiles bigger than small
    - label: Free disk
      query: min(node_filesystem_avail_bytes{mountpoint="/"})
      format: bytes
```

**Grafana:**
- Create a service account with the Viewer role and give its token as `token`.
- Without a token only the health check is shown.
- Panels listed under `panels` (`dashboard` UID, `panel` id, optional `title` and `from`) are embedded on the service page. For that, Grafana needs `allow_embedding = true`, and viewers must be signed in to Grafana or anonymous access must be on.

**Generic metric:**

```yaml
widget:
  type: metric
  url: http://beszel:8090/api/stats
  metrics:
    - { label: Load, path: "data.load[0]", decimals: 2, warn: 2 }
    - { label: Temp, path: "data.temps[0]", suffix: "°C", chart: data.temps }   # chart: path to an array
---
widget:
  type: metric
  source: influxdb
  url: http://influxdb:8086
  org: home
  token: "{{HOMEPAGE_VAR_INFLUX_TOKEN}}"
  metrics:
    - label: Power
      query: from(bucket: "home") |> range(start: -1h) |> filter(fn: (r) => r._field == "watts")
      suffix: " W"
      chart: true              # every returned value becomes a sparkline point
```

**Dockhand:** create a token under Profile → API tokens. `env` is the environment id from Settings → Environments.

**Arcane:** create an API key under Settings → API Keys. `env` is `0` for the local Docker host.

**Proxmox token:** create an API token under Datacenter → Permissions → API Tokens and give it the `PVEAuditor` role on `/`. For the start/stop actions it also needs `VM.PowerMgmt`.

**TrueNAS:** uses the REST API v2.0, which TrueNAS 25.x still serves but has deprecated.

**Synology:** use an account without 2-step verification (DSM's API can't complete it).

**Uptime Kuma:** the monitors must be on a public status page; `slug` is its URL slug.

**UniFi:** use a local (non-SSO) account. Both UniFi OS consoles and classic controllers work.

**Custom API:**

```yaml
widget:
  type: customapi
  url: http://service.local/api/stats
  headers:
    Authorization: "Bearer {{HOMEPAGE_VAR_TOKEN}}"
  mappings:
    - label: Users
      field: data.users[0].count        # dots and [index]
      format: number                    # text | number | percent | bytes | duration
    - label: Temp
      field: sensors.cpu
      suffix: "°C"
```

Without `mappings`, the widget shows the first few top-level values of the response.

### Adding an integration

1. Create `src/integrations/<name>.ts` exporting an `Integration`: a zod `schema` plus `fetch(config)` that returns `{ fields, list? }`. Optionally add `actions` (`list` and `run`) for admin buttons; also add the type to `ACTION_TYPES`.
2. Register it in `src/integrations/index.ts`.
3. Describe its fields in `src/integrations/fields.ts` so it appears in the editor.
4. Add a fixture and a parser test, and a route in `scripts/mock-server.mjs` for the end-to-end tests.

## Status history and alerts

A background job checks every service that has `ping` set, every `pingInterval` seconds, even when nobody has the page open. Results go into a SQLite database in the data folder. Each tile shows the last 24 hours as bars; `tall` and `large` tiles add a latency chart.

**Alerts:**
- After `alerts.threshold` failed checks in a row, Page sends a DOWN alert to Discord and/or your webhook.
- When the service comes back, it sends a RECOVERED alert with the outage length.
- Use **Send** under Monitoring & alerts in Settings to check your setup. Pick **Sample: service down** or **back up** to see your templates.

### Alert messages

`alerts.messages.down`, `.up` and `.notice` replace Page's built-in text on every channel. Empty ones keep the built-in text. `{{name}}` is replaced by a variable, and unknown names become empty:
- **Service alerts:** `service`, `status` (down, up), `reason` (e.g. HTTP 503), `duration` (outage length, e.g. 12m), `since`, `url`, `error`, `httpStatus`.
- **Notices:** budgets, updates, certificates and thresholds pass their own fields (`service`, `version`, `category`, `value`…). `kind` is budget, update, cert or threshold.
- **Everywhere:** `message` (Page's own text), `level` (info, warn, error), `time` and `title`.

`alerts.webhookBody` sends your own JSON to the generic webhook instead of Page's, e.g. for Slack, Mattermost or Home Assistant. Values are escaped for JSON strings, so keep the quotes around `"{{…}}"`. There, `message` is the text after templating.

Template placeholders don't clash with secrets: only `{{HOMEPAGE_VAR_…}}` and `{{HOMEPAGE_FILE_…}}` are read from the environment.

History is stored per service id (group name + service name), so renaming a service starts a fresh history.

**Service pages:** click a tile's status dot or uptime bars to open `/service/<id>`. It shows:
- uptime, average and 95th-percentile response time for 24h, 7d, 30d or 90d, with charts
- every outage, with its length and cause
- the integration's full data

Raw checks are kept 7 days; hourly summaries are kept `history.retentionDays` (default 90). Outages are recorded whether or not alerts are configured.

### Check types

`ping: true` (the link) and `ping: <url>` check over HTTP: up when the answer is below 500. For anything else, give `ping` a type. The editor has a form for each.

```yaml
ping: { type: http, url: https://app/health, expect: [200], keyword: "OK" }      # status codes, text in the body
ping: { type: http, jsonPath: "$.status", equals: ok }                            # a JSON value (url defaults to the link)
ping: { type: tcp, host: 10.0.0.5, port: 22 }                                     # a port accepts connections
ping: { type: udp, host: 10.0.0.5, port: 51820, payload: "0x00", expect: "" }      # something answers on a UDP port
ping: { type: minecraft, host: mc.example.com, edition: java }                    # a Minecraft server answers its status ping (bedrock: UDP 19132)
ping: { type: icmp, host: 10.0.0.1 }                                              # ping (needs ping permission in the container)
ping: { type: dns, host: nas.home.arpa, server: 10.0.0.53, record: A, expect: 10.0.0.20 }
ping: { type: snmp, host: 10.0.0.2, community: public, oid: 1.3.6.1.2.1.1.3.0 }   # any value back = up
```

**UDP:** there is no handshake, so a UDP check sends `payload` (text, or bytes as `0x…` hex; default one zero byte) and is up when anything answers (and the answer contains `expect`, if set). A closed port usually reports `ECONNREFUSED`. Many services only answer their own protocol: WireGuard, for one, stays silent to strangers, so watch it through the `wireguard` widget or a TCP check on its web UI instead.

**Certificates:** HTTPS checks also read the server's certificate (at most every 6 hours). When it gets within `alerts.certDays` days of expiry (default 14, `0` turns this off), the tile shows a `cert 9d` badge and the alert channels get one message a day.

### Widget history and thresholds

Any widget can keep its numbers over time and alert on them:

```yaml
- name: NAS
  widget:
    type: glances
    url: http://nas:61208
    record: true                       # store the values every metricsInterval seconds (default 60)
    thresholds:
      CPU: { above: 90, for: 5 }       # minutes past the limit before alerting
      "Disk /": { above: 85 }
      Battery: { below: 20 }
```

- **record:** the service page gets a **History** section with a chart per value (24h, 7d, 30d). Tiles get sparklines from it when the integration has none of its own. Raw values are kept 7 days, hourly averages as long as `history.retentionDays`.
- **thresholds:** keyed by field label (as shown on the tile). A value past its limit turns red right away. The alert channels hear about it once it has stayed there `for` minutes, and again when it's back.

Labels are read from formatted values too (`49%`, `5.0 GB`, `21.5 °C`). Both settings are also in the service editor.

Vaultwarden and other apps without a stats API can still be watched with an HTTP check, e.g. `ping: { type: http, url: https://vault/alive, expect: [200] }`.

### Prometheus export

Page can be scraped by Prometheus (or Grafana Agent, VictoriaMetrics…) at `/api/export/metrics`:
- `page_service_up`, `page_service_latency_ms`, `page_service_uptime_ratio` (last 24 hours) and `page_service_last_check_timestamp_seconds` for every service with a status check, labelled `service`, `name` and `group`
- `page_widget_value{service, field}`: the latest value of every recorded widget field (`record: true` or thresholds)
- `page_build_info{version}`

It needs an API token: create one under **Settings → Monitoring & alerts → API tokens** (admins). The token is shown once, with a ready-made `scrape_configs` block; only its hash is stored, it stops working if its admin is disabled or demoted, and it can be revoked any time.

```yaml
scrape_configs:
  - job_name: page
    metrics_path: /api/export/metrics
    authorization:
      credentials: page_…
    static_configs:
      - targets: ["page.example.com"]
```

## Actions

Admins get a ⋯ menu on Docker and Proxmox tiles:
- **Docker:** start, stop, restart.
- **Proxmox:** shut down, reboot, force stop and start, per VM or container.
- **Home Assistant:** for the entities listed in the widget, the tile itself has a switch for each light, switch, fan, input boolean and cover, and a run button for scenes and scripts. They act at once, without the confirm step. Only these services are ever called (turn on/off, open/close, run), and only on listed entities. Set `controls: false` to show states only.

Every action is confirmed first and recorded in the audit log. Only actions that make sense for the current state are offered, and the server checks that again.

## Docker auto-discovery

With `docker.discovery: true`, containers with `page.*` labels appear as services:

```yaml
labels:
  page.group: Media
  page.name: Jellyfin            # default: the container name
  page.href: https://jellyfin.local
  page.icon: jellyfin
  page.description: Movies & TV
  page.ping: "true"              # or a URL
  page.size: wide
  page.tab: Media
  page.alert: "false"
  # Any widget; without page.widget.type you get a docker widget for this container.
  page.widget.type: customapi
  page.widget.url: http://jellyfin:8096/System/Info/Public
```

Discovered services join a YAML group with the same name, or get a new group. They're shown read-only in the editor.

## Install as an app

Open the page in Chrome, Edge or Safari and choose **Install** / **Add to Home Screen**. Browsers only allow this over **HTTPS** (or on `localhost`), so put Page behind your reverse proxy. Offline, the app shows the last loaded dashboard with an "Offline" badge.

## Language

Page speaks English and French. `language: auto` (the default) follows each visitor's browser and falls back to English; `en` or `fr` sets one language for everyone. It's also under **Settings → General**. Dates, numbers and amounts follow the language too (`1 234,56 €` in French).

Your own words stay as you wrote them (service, group and category names), and so do the values integrations report on tiles ("running", "CPU"…): thresholds and history use those labels as keys. To add a language, translate `src/i18n/fr.ts` into a new file; `npm test` checks that every text the UI shows has a translation (`node scripts/i18n-keys.mjs --missing` lists what's left).

## Settings page

Admins open `/settings` from the gear next to the search box, or from the account menu. The page has:
- **Sections:** General, Appearance (with the background), Layout, Refresh, Monitoring & alerts, Accounts & sign-in, Docker, Finance, and Backup & history. Each section has its own URL, e.g. `/settings#appearance`, and a search box finds any setting across all of them.
- **Logo:** under General, upload an image or give a URL. It is shown next to the title and on the sign-in page, and becomes the browser and installed-app icon (PNG or JPEG for the icon; other formats keep the letter icon).
- **Liquid Glass:** in Chrome and Edge, raised panes (search, menus, dialogs, the panel) and the hovered tile bend what is behind them at the rim, like the edge of a thick lens, with a faint colour fringe. Each pane gets a lens made for its own size and corner radius, so a small button and a wide card both bend the same few pixels at the edge and stay clear in the middle. Other browsers get the frosted version.
- **Looks:** one click sets a card style, background, accent and glow that belong together, and sometimes the theme: Frutiger Aero, Liquid Glass, Synthwave, Nebula, Brutalist, Paper, Retro 98, Classic, Nord, Dracula, Catppuccin Mocha and Latte, Solarized, Gruvbox, Tokyo Night, plus your own themes. Like everything else on the page, it's only kept once you save.
- **Custom themes:** under Appearance, **New theme** starts from any built-in theme. Pick the background, card, text, accent and status colours, how see-through the cards are, and optionally a gradient of your own; borders, hovers and chart lines are derived from them. The text contrast is checked as you go (a warning below 4.5:1). Themes can be duplicated, and exported or imported as JSON to share them. They're stored in `settings.yaml`:

  ```yaml
  theme: custom:mint-paper
  customThemes:
    - id: mint-paper
      label: Mint paper
      base: light                # light or dark: which built-in look it builds on
      colors: { page: "#e8f5ee", surface: "#ffffff", fg: "#1f3b2d", accent: "#10b981", surfaceOpacity: 0.6 }
      gradient: { base: "#e8f5ee", blobs: ["#10b981", "#a7f3d0", "#0ea5e9"] }   # optional; use with background.gradient: custom:mint-paper
  ```
- **Dropdowns** follow the theme: the open list uses the theme's colours and marks the chosen item with the accent (Chrome and Edge 135+ draw the whole list; other browsers colour the options).
- **Live preview:** theme, card style, accent colour and background change on screen as you edit. Nothing is written until you **Save**, and **Discard** puts everything back.
- **Checks before saving:** values are validated as you type and problems are shown next to the field. Sections with unsaved changes or problems are marked in the sidebar.
- **Backup:** **Download config** saves all YAML files as a zip. They're exactly as on disk, so secrets that aren't in env vars are included. The page also has the version history and **Import from Homepage**.

Saving keeps the comments in `settings.yaml`, like the editor does.

## Backups

Every night (03:00 by default) Page writes one zip to `data/backups/` and keeps the newest 7. Each zip holds:
- the config files, exactly as on disk
- a consistent copy of the database (history, users, finance), taken safely while Page runs
- uploaded wallpapers, logos and profile pictures
- `secret.key`, which signs sessions and encrypts two-factor secrets

Under **Settings → Backup & history** you can turn them off, change the hour, how many to keep and the folder, run **Back up now**, and download or delete backups. A failed backup is reported on the alert channels. Downloads and deletions are in the audit log.

A backup on the same disk as the data doesn't survive that disk: point `backup.dir` at another disk or share, e.g. mount one in `docker-compose.yml` (`- /mnt/nas/page-backups:/backups`) and set `dir: /backups`.

```yaml
backup:
  enabled: true
  time: "03:00"     # server time
  keep: 7
  dir: /backups     # optional; default data/backups
```

**Restore:** stop Page, unzip the backup, copy `config/` over your config folder and `data/` over your data folder (delete `page.db-wal` and `page.db-shm` there first), and start Page again. The zip holds secrets: keep it somewhere safe.

## Editing in the browser

Click the pencil next to the search box. You can:
- add, edit, delete and drag-reorder info widgets, groups, services and bookmarks
- set tabs, tile sizes and alerts
- open the settings page

Each change is validated and written straight to the YAML file; comments on untouched entries are preserved. The editor is only downloaded when you open it. Only admins can edit; set `editing: false` to turn the editor off entirely.

**History and undo:**
- Every save keeps a copy of the file as it was just before, including edits you made by hand.
- After a save, the toast offers **Undo**.
- The **History** tab lists every version with who changed it and when, shows a diff, and can restore any of them. A restore can itself be undone.

**Import from Homepage:**
- In the editor, choose **Import**, pick your gethomepage.dev `services.yaml`, `bookmarks.yaml`, `settings.yaml`, `widgets.yaml` and `docker.yaml`, check the preview, then **Merge** (keep your groups, add new ones) or **Replace**.
- From a terminal: `npm run import:homepage -- /path/to/homepage/config` previews; add `--write` to save. Existing files are backed up first.
- Anything that can't be carried over exactly is listed, for example ICMP pings (Page checks over HTTP), unsupported widgets and custom formats.

## Accounts and sign-in

On first start, create the admin account at **Set up**. Add more people under **Edit → Users**. Roles:
- **admin**: can edit, run actions, manage users and history.
- **user**: can see items marked `users`, and do what `auth.userPermissions` allows (by default: use the finance tracker).
- **groups** add to that: see items shown to the group, and extra permissions (see "Groups and permissions").

```yaml
auth:
  publicView: true            # false: everything requires signing in
  baseUrl: https://home.example.com   # public URL, needed for SSO behind a proxy
  local: { enabled: true }    # username/password accounts stored in Page
  providers:                  # single sign-on (callback: <baseUrl>/api/auth/oauth/<id>/callback)
    - id: authentik
      type: oidc              # oidc | google | github
      name: Authentik
      issuer: https://auth.example.com/application/o/page/
      clientId: page
      clientSecret: "{{HOMEPAGE_VAR_OIDC_SECRET}}"
      signup: false           # only people who already have a Page account may sign in
      adminGroup: admins      # members become admins
    - { id: google, type: google, clientId: "…", clientSecret: "{{HOMEPAGE_VAR_GOOGLE_SECRET}}" }
    - { id: github, type: github, clientId: "…", clientSecret: "{{HOMEPAGE_VAR_GITHUB_SECRET}}" }
  ldap:
    enabled: true
    url: ldap://lldap:3890
    bindDN: uid=admin,ou=people,dc=example,dc=com
    bindPassword: "{{HOMEPAGE_VAR_LDAP_PASSWORD}}"
    baseDN: ou=people,dc=example,dc=com
    userFilter: (uid={{username}})
    adminGroup: cn=admins,ou=groups,dc=example,dc=com
  proxy:                      # forward auth (Authelia, Authentik, Traefik…)
    enabled: true
    secret: "{{HOMEPAGE_VAR_PROXY_SECRET}}"   # the proxy must send it as X-Page-Proxy-Secret
```

**Who can sign in through SSO:** with `signup: false` (the default for Google, GitHub and OIDC), a person can sign in only if:
- they have signed in before, or
- the provider confirms their email and it matches an existing Page user. Add the user with that email under **Users** first.

Everyone else is refused. Unverified emails are never used to match. LDAP and proxy logins create accounts automatically unless you set `signup: false` on them.

**Proxy sign-in** trusts the `Remote-User`, `Remote-Email`, `Remote-Name` and `Remote-Groups` headers. It only does so when the request also carries the shared secret, so make sure only your proxy can reach Page, and configure the proxy to add the header.

**Profile:** everyone can open **Profile** from the account menu. There you can set a display name, upload a profile picture (PNG, JPEG, WebP, GIF or AVIF, up to 2 MB) and change your password if you have one. Email, role and SSO links stay with admins, because the email is what links SSO sign-ins to accounts.

**Uploads:** profile pictures and uploaded wallpapers are kept in `data/uploads/`. Back up the data folder to keep them. They are served at unguessable URLs without signing in, because the wallpaper also shows to anonymous viewers.

**Visibility:** add `visible: users` or `visible: admins` to a group, service, bookmark group or info widget to hide it from people below that role. Or name groups, `visible: [family, media]`, to show it only to their members (and admins). A service inside a group needs to pass both the group's and its own. The page and every API enforce this. Finance tiles default to `users`.

### Groups and permissions

Create groups under **Settings → Accounts & sign-in → Groups**:
- **Members** are added by hand (the people icon on a user), or automatically. A group's *sign-in groups* are names as your SSO provider (the `groupsClaim`), LDAP (`memberOf`) or proxy (`Remote-Groups`) reports them. Members join at each sign-in and leave when the provider no longer lists them. Hand-made memberships are never touched.
- **Permissions** are on top of `auth.userPermissions`:
  - `finance`: the finance tracker, its tile and its API.
  - `actions`: start, stop and restart buttons on services the person can see.
- Admins have every permission and see everything.

```yaml
auth:
  userPermissions: [finance]   # what every signed-in user may do; [] for nothing
```

### Security

From the account menu, **Security**:
- **Two-factor sign-in (TOTP):** scan the QR code with an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password…) and confirm a code. Signing in with a password (local or LDAP) then asks for a code too, or one of ten one-time recovery codes. SSO sign-ins rely on the provider's own second factor. The secret is stored encrypted with the session key (`HOMEPAGE_SECRET` or `data/secret.key`), so keep that key with your backups.
- **Signed in:** every device with a session, its address and when it was last used. Sign out one, or all the others. Changing your password or turning on 2FA signs out the other devices.
- **Keep me signed in:** on the sign-in page. Unticked, the session ends when the browser closes, or after 12 idle hours.

Admins, on each user:
- **Link to set a password:** a one-time link, valid 48 hours. Use it to invite someone, or when they forgot their password. Using it signs them out everywhere.
- **Turn off two-factor sign-in:** for a lost phone.
- **Sign out everywhere.** Disabling an account or setting its password does this too.
- **Audit log:** the full history below the accounts list (sign-ins, failed attempts, account and config changes, actions). Search it by user, action or detail.

Sessions are rows in the database now, so they can be revoked. Signing in again once after upgrading to this version is expected.

## Finance tracker

Signed-in users get **Finance** in the header (the wallet button) and the account menu:
- **Overview:** totals for the month or year, the money flow, budgets, a category donut, 12 months of income and spending, and the running balance.
- **Flow:** a Sankey chart of where the money came from (income by category) and where it went (spending by category), with what was saved, or taken from savings when spending was higher. Categories under 2% are grouped as "Other". Hover a band for its amount and share.
- **Export:** the **Export** button on the money flow (Overview and Flow) saves just the chart, cropped and on a transparent background, as a PNG image or an SVG you can edit; or a CSV of every band (source, target, amount, share). **Report (PDF)** opens a one-page summary of the period (totals, the flow, spending by category, budgets) and the print dialog: choose **Save as PDF**. The report always prints dark on white, whatever the theme. Open it any time at `/finance/report?period=2026-09` (or a year, `?period=2026`).
- **Quick entry:** at the top of every tab. **Repeat** makes it a recurring transaction from that date. ☆ saves it as a **shortcut**: a one-tap button above the form that adds it again today, in the currency it was saved in. Remove a shortcut with its ×.
- **Transactions:** quick entry at the top, search and filter, edit and delete. **Export CSV** downloads the period with the current filters. **All** downloads every transaction, and **JSON** gives the same data as JSON. The CSV opens in Excel and imports back into Page as is. Text starting with `=`, `+`, `-` or `@` gets a leading `'`, so spreadsheets don't run it as a formula.
- **Accounts:** bank accounts, cash, cards and savings, each with its balance (opening balance plus its transactions) and a 12-month balance line. Accounts named by Firefly III or a CSV import appear by themselves. **Transfer** moves money between two of your accounts (asking for the amount received when their currencies differ): it changes both balances but is never income or spending, and deleting one side deletes both. The **account picker** in the header shows one account's totals, charts and transactions; quick entry adds to the account you're viewing (or the last one used), and a CSV import can go into an account. Renaming an account renames it on its transactions; accounts with transactions can be archived, empty ones deleted.
- **Currency:** the picker in the header shows everything in another currency, remembered per browser. Transactions in other currencies are converted at the latest ECB reference rates (via Frankfurter, no key, cached 6 hours and kept for offline use). Budgets are converted too. New transactions and imports use the currency being shown. A currency without an ECB rate is listed but left out of the totals, and the page says how many transactions that affects.
- **Plan:**
  - Your balance today, what to expect at the end of the month and in 12 months, and a chart of the last 6 months with the next 12 projected (dashed).
  - The projection adds the recurring transactions to the average of everything else over the last three full months. It's a trend, not a promise.
  - **Recurring transactions** (rent, salary, subscriptions, every n weeks, months or years, with an optional end date) are added as real transactions on their date, checked hourly.
  - A start date in the past fills in the occurrences since then. Months keep their day: the 31st becomes the 28th in February and the 31st again in March.
  - Pausing stops new ones; resuming adds what came due meanwhile. Deleting a rule keeps what it already added, and a deleted occurrence never comes back.
- **Savings:**
  - Goals with a target and an optional deadline. Each shows what is put aside, the share reached, and how much a month it takes to make the deadline.
  - **Put aside** and **Take out**, or the **Savings** button in the header, record moves between your own pots. They are not spending, so they stay out of the totals and charts.
- **Categories:** pick each category's chart colour. The eight palette colours are checked to stay apart, also for colour-blind people. Beyond that, **Custom** lets a category take any colour and keep its own band in the charts, at the cost of that guarantee. Categories with no colour are grouped as "Other". Renaming to an existing name merges the two. Each category can have a **monthly budget**: the Overview shows how much of it is used (×12 in the year view), and an alert is sent when it runs out.
- **Import:**
  - Upload a bank CSV or Excel (.xlsx) export and match its columns. For Excel, the first sheet with data is read, and dates and amounts are taken as Excel stores them. Old .xls and .ods files need saving as .xlsx or .csv first. Page guesses them from English and French headers and handles decimal commas, day-first dates and debit/credit columns.
  - The mapping is remembered.
  - Importing the same file again adds nothing.

```yaml
finance:
  currency: EUR                 # default currency for totals, charts and budgets (others are converted)
  fireflyService: money.firefly # optional: sync daily from this Firefly III widget's service
  budgetAlerts: over            # over: alert when a budget is used up; warn: also at 80%; off
```

Budget alerts go to the same Discord/webhook channels as service alerts, at most once per category, threshold and month. The webhook receives `{ kind: "budget", level, message, category, spentCents, budgetCents }`.

Add a `finance` widget to a tile to see it on the dashboard; bigger tiles show more charts.

## Travel log

**Travel** (in the Apps menu) keeps track of where you've been:
- **Map:** a dotted globe that slowly turns (drag it, or pick a country) with the countries you've visited in your accent colour, the ones you want to visit outlined, and the cities you've been to glowing. **Flat map** shows the same as a world map. Pick a country to mark it as visited, lived there or want to go, and see your trips there.
- **Stats:** countries out of 195 (UN members and the two observers) and the share of the world, continents, cities, trips, days away this year, and your longest trip.
- **Trips:** a name, dates, the stops in order (search a city, or add a whole country), a rating, notes, and who came along. Companions (other Page users) see the trip on their own map and in their stats; only you can change it, and they can remove it from their list.
- **Places:** every country and city you've marked, with search to add more.

Each person has their own log. It needs the `travel` permission, which signed-in users have by default (see `auth.userPermissions`). City search uses Open-Meteo's free place search through Page; everything else (the map included) works offline. Country flags use the Twemoji Country Flags font (Twemoji graphics by Twitter, CC-BY 4.0) so they also show on Windows.

## Watchlist and reading list

**Watchlist** (in the Apps menu) keeps the books, movies, shows and games you want to get to:
- **Add:** pick the kind and type a title. For books, Page searches Open Library as you type: pick one to get its cover, author, year and page count. Everything else you type yourself.
- **Statuses:** in progress, planned, finished and dropped, each with its own tab, and a filter by kind. Starting something records the date; finishing it records that too and fills in the progress.
- **Each item:** progress (pages, episodes, minutes or hours, shown on the cover while in progress), a rating out of 5, and notes.
- **Stats:** what you're on, what's planned, what you finished this year by kind, and the pages read.

Each person's list is private. It needs the `watchlist` permission, which signed-in users have by default.

## Inventory

**Inventory** (in the Apps menu) lists the devices on your network, for everyone with the `inventory` permission (admins, or a group that grants it):
- name, kind, IP or host name, MAC, location, vendor, model, serial, purchase date and price, warranty end, tags and notes, and the dashboard service it runs (linked to its page)
- **live status:** each device with an address is checked every 30 seconds, with a ping, or a TCP port if you give one (ping needs `NET_RAW` in Docker; a port works everywhere)
- **Wake-on-LAN:** the power button sends the magic packet (to the device's broadcast address, default `255.255.255.255:9`). It needs the `actions` permission too, and is in the audit log.
- **warranty reminders:** the alert channels hear about a warranty ending `inventory.warrantyDays` days before (30 by default, `0` turns it off), once per device
- **CSV:** **Export CSV** downloads every device; **Import CSV** reads a file whose first row names the columns (any order, as in the export). Devices are matched by MAC (or name), so importing an export again updates instead of duplicating.

Services can be woken too: give one `wol: { mac: AA:BB:CC:DD:EE:FF, broadcast: 192.168.1.255 }` (or just `wol: AA:BB:…`) and its ⋯ menu gets **Wake**.

In Docker, a broadcast only reaches your LAN with `network_mode: host`; on a bridge network, give the subnet's broadcast address of a network the container can route to.

## Keyboard

- `Ctrl/⌘ K`: command palette, on every page. Fuzzy-search services, bookmarks, tabs, Finance and every settings section; `Enter` opens, `⇧ Enter` opens a service's details page.
  - Admins can also run container and VM actions (type the service name, pick "Actions for…", confirm with `Enter`), switch the theme, card style and glow, or open the editor.
  - Recently used entries are listed first.
- `m`: open or close the monitoring panel. The pulse button in the header does the same. It shows every checked service, down ones first, with latency, 24-hour uptime, how long an outage has lasted and why, and certificates about to expire. Filter by down/up or by name; click one for its details page.
- `/`: focus the filter
- `Enter` in the filter: open the first match
- `Esc`: clear the filter
