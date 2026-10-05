// Written to the config directory on first run if a file is missing.
export const defaultFiles: Record<string, string> = {
  "settings.yaml": `# Page settings
title: Homelab
theme: dark          # dark | light | system
accent: "#8b5cf6"
background:
  gradient: aurora   # aurora | sunset | ocean | midnight | forest
  # image: https://images.unsplash.com/photo-1506744038136-46273834b3fb
  blur: 0
  brightness: 0.7
target: _blank
style: glass         # glass | liquid | minimal | solid
editing: true        # allow editing from the browser
refreshInterval: 20  # seconds between widget refreshes
pingInterval: 30     # seconds between status pings
liveReload: true     # refresh open dashboards when these files change
`,
  "services.yaml": `# Service groups. Secrets can reference env vars: "{{HOMEPAGE_VAR_PROXMOX_SECRET}}"
- name: Infrastructure
  services:
    - name: Proxmox
      href: https://proxmox.local:8006
      icon: proxmox
      description: Hypervisor
      ping: true
      # widget:
      #   type: proxmox
      #   url: https://proxmox.local:8006
      #   username: api@pam!homepage
      #   password: "{{HOMEPAGE_VAR_PROXMOX_SECRET}}"
      #   insecure: true
    - name: Portainer
      href: https://portainer.local:9443
      icon: portainer
      description: Container management
      ping: true
    - name: Uptime Kuma
      href: http://uptime.local:3001
      icon: uptime-kuma
      description: Monitoring
      ping: true

- name: Web
  services:
    - name: GitHub
      href: https://github.com
      icon: github
      description: Code hosting
      ping: true
`,
  "bookmarks.yaml": `- name: Developer
  links:
    - name: GitHub
      href: https://github.com
      icon: github
    - name: MDN
      href: https://developer.mozilla.org
      icon: si-mdnwebdocs
- name: Homelab
  links:
    - name: r/selfhosted
      href: https://reddit.com/r/selfhosted
      icon: reddit
    - name: Dashboard Icons
      href: https://dashboardicons.com
      icon: mdi-image-multiple
`,
  "widgets.yaml": `# Info bar shown above your services
- type: greeting
- type: weather
  label: Paris
  latitude: 48.85
  longitude: 2.35
  units: metric        # metric | imperial
- type: resources
  disks: ["/"]
# - type: markets
#   symbols: [AAPL, MSFT]
#   crypto: [bitcoin, ethereum]
#   currency: usd
# - type: currency
#   base: EUR
#   symbols: [USD, GBP]
`,
};
