import type { Integration } from "./types";
import { docker } from "./docker";
import { portainer } from "./portainer";
import { proxmox } from "./proxmox";
import { uptimekuma } from "./uptimekuma";
import { customapi } from "./customapi";
import { pihole } from "./pihole";
import { adguard } from "./adguard";
import { unifi } from "./unifi";
import { firefly } from "./firefly";
import { ghostfolio } from "./ghostfolio";
import { homeassistant } from "./homeassistant";
import { truenas } from "./truenas";
import { synology } from "./synology";
import { calendar } from "./calendar";
import { rss } from "./rss";
import { finance } from "./finance";
import { prometheus } from "./prometheus";
import { grafana } from "./grafana";
import { glances } from "./glances";
import { netdata } from "./netdata";
import { metric } from "./metric";
import { dockhand } from "./dockhand";
import { arcane } from "./arcane";
import { snmpIntegration } from "./snmp";
import { pbs } from "./pbs";
import { opnsense } from "./opnsense";
import { pfsense } from "./pfsense";
import { npm } from "./npm";
import { traefik } from "./traefik";
import { tailscale } from "./tailscale";
import { cloudflare } from "./cloudflare";
import { authentik, gitea, immich, nextcloud, paperless, speedtest } from "./apps";
import { arr, jellyfin, overseerr, plex, qbittorrent, sabnzbd, tautulli, transmission } from "./media";
import { frigate, gotify, ntfy, scrutiny } from "./homelab";
import { minecraft } from "./minecraft";
import { pelican } from "./pelican";
import { wireguard } from "./wireguard";
import { wgdashboard } from "./wgdashboard";

// To add an integration: create a file exporting an Integration, register it here,
// and describe its fields in ./fields.ts for the editor.
export const integrations: Record<string, Integration> = Object.fromEntries(
  [
    docker, portainer, proxmox, uptimekuma, customapi, pihole, adguard, unifi, firefly, ghostfolio,
    homeassistant, truenas, synology, calendar, rss, finance,
    prometheus, grafana, glances, netdata, metric, dockhand, arcane, snmpIntegration, pbs,
    opnsense, pfsense, npm, traefik, tailscale, cloudflare,
    immich, nextcloud, gitea, speedtest, paperless, authentik,
    jellyfin, plex, tautulli, arr, overseerr, qbittorrent, transmission, sabnzbd,
    frigate, scrutiny, gotify, ntfy,
    wireguard, wgdashboard, pelican, minecraft,
  ].map((i) => [i.type, i as Integration]),
);
