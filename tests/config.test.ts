import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { substituteEnv, isPlaceholder } from "@/lib/config/env";
import { sanitize, maskRaw } from "@/lib/config/sanitize";
import { patchYaml } from "@/lib/config/write";
import { serviceIds } from "@/lib/config/slug";
import { MASK, servicesFileSchema, settingsSchema } from "@/lib/config/schema";

describe("substituteEnv", () => {
  it("replaces HOMEPAGE_VAR placeholders recursively", () => {
    const out = substituteEnv(
      { a: "{{HOMEPAGE_VAR_KEY}}", b: ["x-{{ HOMEPAGE_VAR_KEY }}"], c: 3, d: "{{HOMEPAGE_VAR_MISSING}}" },
      { HOMEPAGE_VAR_KEY: "s3cret" },
    );
    expect(out).toEqual({ a: "s3cret", b: ["x-s3cret"], c: 3, d: "" });
  });

  it("detects whole-value placeholders only", () => {
    expect(isPlaceholder("{{HOMEPAGE_VAR_X}}")).toBe(true);
    expect(isPlaceholder("abc{{HOMEPAGE_VAR_X}}")).toBe(false);
  });
});

describe("schema", () => {
  it("fills settings defaults", () => {
    const s = settingsSchema.parse(undefined);
    expect(s.theme).toBe("dark");
    expect(s.background.gradient).toBe("aurora");
  });

  it("rejects services without a name", () => {
    expect(servicesFileSchema.safeParse([{ name: "G", services: [{ href: "x" }] }]).success).toBe(false);
  });
});

const services = servicesFileSchema.parse([
  {
    name: "Infra",
    services: [
      {
        name: "Proxmox",
        href: "https://pve:8006",
        ping: "http://10.0.0.2:8006",
        widget: { type: "proxmox", url: "https://pve:8006", username: "api@pam!x", password: "TOPSECRET" },
      },
      { name: "Proxmox", widget: { type: "portainer", url: "https://p", key: "{{HOMEPAGE_VAR_P}}" } },
    ],
  },
]);

describe("sanitize", () => {
  it("never exposes widget config or ping targets", () => {
    const out = sanitize({ settings: settingsSchema.parse({}), services, bookmarks: [], widgets: [], errors: [] });
    const json = JSON.stringify(out);
    expect(json).not.toContain("TOPSECRET");
    expect(json).not.toContain("api@pam");
    expect(json).not.toContain("10.0.0.2");
    expect(out.services[0].services[0]).toMatchObject({ id: "infra.proxmox", ping: true, widget: "proxmox" });
  });

  it("de-duplicates ids", () => {
    expect(serviceIds(services)).toEqual([["infra.proxmox", "infra.proxmox-2"]]);
  });

  it("masks secrets for the editor but shows env placeholders", () => {
    const [g] = maskRaw("services", services) as typeof services;
    expect(g.services[0].widget?.password).toBe(MASK);
    expect(g.services[0].widget?.username).toBe("api@pam!x");
    expect(g.services[1].widget?.key).toBe("{{HOMEPAGE_VAR_P}}");
  });
});

describe("patchYaml", () => {
  const text = `# My services
- name: Infra # main group
  services:
    # the hypervisor
    - name: Proxmox
      href: https://pve:8006
      widget:
        type: proxmox
        password: hunter2 # keep me
    - name: NAS
      href: http://nas
`;

  it("keeps comments and masked secrets while reordering and editing", () => {
    const data = [
      {
        name: "Infra",
        _orig: "Infra",
        services: [
          { name: "NAS", href: "http://nas.local", _key: "a" },
          { name: "PVE", _orig: "Proxmox", href: "https://pve:8006", widget: { type: "proxmox", password: MASK } },
        ],
      },
    ];
    const out = patchYaml(text, data);
    expect(out).toContain("# My services");
    expect(out).toContain("# main group");
    expect(out).toContain("# the hypervisor");
    expect(out).toContain("password: hunter2 # keep me");
    expect(out).not.toContain("_key");
    expect(out).not.toContain("_orig");
    const parsed = YAML.parse(out);
    expect(parsed[0].services.map((s: { name: string }) => s.name)).toEqual(["NAS", "PVE"]);
    expect(parsed[0].services[0].href).toBe("http://nas.local");
  });

  it("removes deleted keys and items", () => {
    const out = YAML.parse(patchYaml(text, [{ name: "Infra", services: [{ name: "Proxmox", href: "https://pve:8006" }] }]));
    expect(out[0].services).toEqual([{ name: "Proxmox", href: "https://pve:8006" }]);
  });

  it("reorders nameless items without merging two into one node", () => {
    const yaml = "- type: greeting\n  name: Lucas\n- type: resources\n- type: weather\n  label: Paris\n";
    const next = [{ type: "weather", label: "Paris" }, { type: "resources" }, { type: "greeting", name: "Lucas" }];
    expect(YAML.parse(patchYaml(yaml, next))).toEqual(next);
  });

  it("drops a masked secret that has no stored value", () => {
    const out = YAML.parse(patchYaml("[]", [{ name: "G", services: [{ name: "X", widget: { type: "portainer", key: MASK } }] }]));
    expect(out[0].services[0].widget).toEqual({ type: "portainer" });
  });
});
