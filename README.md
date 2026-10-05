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
  - Pi-hole, AdGuard Home, UniFi, OPNsense, pfSense, Traefik, Nginx Proxy Manager, Tailscale, Cloudflare Tunnels, SNMP
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
- **Alerts:** Discord or a webhook when a service goes down or comes back
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
- **Automatically:** set `updates.auto: true` to install new versions at `updates.window` (one attempt per version).

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

The `:ro` flag on the socket mount doesn't limit what the Docker API allows, so the default mount is enough. Without the socket, Page shows the manual steps instead. To publish a release, bump `version` in `package.json`, then push a matching tag (`v0.3.1`). The Release workflow creates the GitHub release with generated notes, and the Docker workflow pushes the image.

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
theme: dark            # dark | light | system | oled (pure black) | sepia (warm paper)
style: glass           # glass | liquid | aero | neon | brutal | soft | retro | minimal | solid
accent: "#8b5cf6"      # or "auto" to take it from the wallpaper
glow: subtle           # none | subtle | strong: edge light and accent glow on hovered cards
background:
  gradient: aurora     # aurora | sunset | ocean | midnight | forest | aero | dawn | lagoon | graphite | nebula | synthwave
  image: https://...   # optional; overrides the gradient
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
  threshold: 2         # failed checks in a row before alerting
  certDays: 14         # warn this many days before an HTTPS certificate expires (0 = off)
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
| `docker` | `container`, `host` (optional: `unix:///var/run/docker.sock`, `tcp://host:2375`) | Status and health, uptime, CPU, RAM |
| `uptimekuma` | `url`, `slug` (status page slug), `insecure` | Monitors up/down, 24h uptime; monitor list on large tiles |
| `pihole` | `url`, `key` (v6 password or v5 API token), `version` (6 or 5) | Queries, blocked, % blocked, clients |
| `adguard` | `url`, `username`, `password` | Queries, blocked, % blocked, latency |
| `unifi` | `url`, `username`, `password` (local account), `site` (default `default`) | Clients, devices online, WAN, latency |
| `firefly` | `url`, `token` (personal access token), `currency` | This month's balance, spent, earned, net worth |
| `ghostfolio` | `url`, `token` (security token), `currency` | Net worth, today, total return |
| `customapi` | `url`, `method`, `headers`, `body`, `mappings` | Any JSON values you map |
| `homeassistant` | `url`, `token` (long-lived access token), `entities` (list of ids, or `{entity, label}`) | Those entities' states; without entities: lights/switches on, unavailable |
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
| `cloudflare` | `account`, `key` (API token with Tunnel read), `tunnel` (optional) | Healthy tunnels, connections, edge locations |
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
- Use **Send test alert** in the editor's Settings to check your setup.

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
ping: { type: icmp, host: 10.0.0.1 }                                              # ping (needs ping permission in the container)
ping: { type: dns, host: nas.home.arpa, server: 10.0.0.53, record: A, expect: 10.0.0.20 }
ping: { type: snmp, host: 10.0.0.2, community: public, oid: 1.3.6.1.2.1.1.3.0 }   # any value back = up
```

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

## Actions

Admins get a ⋯ menu on Docker and Proxmox tiles:
- **Docker:** start, stop, restart.
- **Proxmox:** shut down, reboot, force stop and start, per VM or container.

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

## Settings page

Admins open `/settings` from the gear next to the search box, or from the account menu. The page has:
- **Sections:** General, Appearance, Background, Layout, Refresh, Monitoring & alerts, Accounts & sign-in, Docker, Finance, and Backup & history. Each section has its own URL, e.g. `/settings#appearance`, and a search box finds any setting across all of them.
- **Looks:** one click sets a card style, background, accent and glow that belong together, and sometimes the theme: Frutiger Aero, Liquid Glass, Synthwave, Nebula, Brutalist, Paper, Retro 98, Classic. Like everything else on the page, it's only kept once you save.
- **Live preview:** theme, card style, accent colour and background change on screen as you edit. Nothing is written until you **Save**, and **Discard** puts everything back.
- **Checks before saving:** values are validated as you type and problems are shown next to the field. Sections with unsaved changes or problems are marked in the sidebar.
- **Backup:** **Download config** saves all YAML files as a zip. They're exactly as on disk, so secrets that aren't in env vars are included. The page also has the version history and **Import from Homepage**.

Saving keeps the comments in `settings.yaml`, like the editor does.

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
- **user**: can see items marked `users` and use the finance tracker.

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

**Visibility:** add `visible: users` or `visible: admins` to a group, service, bookmark group or info widget to hide it from people below that role. The page and every API enforce this. Finance tiles default to `users`.

## Finance tracker

Signed-in users get **Finance** in the account menu:
- **Overview:** totals for the month or year, the money flow, budgets, a category donut, 12 months of income and spending, and the running balance.
- **Flow:** a Sankey chart of where the money came from (income by category) and where it went (spending by category), with what was saved, or taken from savings when spending was higher. Categories under 2% are grouped as "Other". Hover a band for its amount and share.
- **Transactions:** quick entry at the top, search and filter, edit and delete.
- **Categories:** pick each category's chart colour. There are eight; categories without one are grouped as "Other". Renaming to an existing name merges the two. Each category can have a **monthly budget**: the Overview shows how much of it is used (×12 in the year view), and an alert is sent when it runs out.
- **Import:**
  - Upload a bank CSV export and match its columns. Page guesses them from English and French headers and handles decimal commas, day-first dates and debit/credit columns.
  - The mapping is remembered.
  - Importing the same file again adds nothing.

```yaml
finance:
  currency: EUR                 # totals and charts use this currency
  fireflyService: money.firefly # optional: sync daily from this Firefly III widget's service
  budgetAlerts: over            # over: alert when a budget is used up; warn: also at 80%; off
```

Budget alerts go to the same Discord/webhook channels as service alerts, at most once per category, threshold and month. The webhook receives `{ kind: "budget", level, message, category, spentCents, budgetCents }`.

Add a `finance` widget to a tile to see it on the dashboard; bigger tiles show more charts.

## Keyboard

- `Ctrl/⌘ K`: command palette, on every page. Fuzzy-search services, bookmarks, tabs, Finance and every settings section; `Enter` opens, `⇧ Enter` opens a service's details page.
  - Admins can also run container and VM actions (type the service name, pick "Actions for…", confirm with `Enter`), switch the theme, card style and glow, or open the editor.
  - Recently used entries are listed first.
- `/`: focus the filter
- `Enter` in the filter: open the first match
- `Esc`: clear the filter
