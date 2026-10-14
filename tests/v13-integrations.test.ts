import { describe, expect, it } from "vitest";
import { parseAuthentik, parseVaultwarden } from "@/integrations/apps";
import { counted, energyToday, parseEnergy } from "@/integrations/energy";
import { integrations } from "@/integrations";

const val = (r: { fields: { label: string; value: unknown; status?: string }[] }, label: string) => r.fields.find((f) => f.label === label);

describe("home assistant energy", () => {
  it("counts what a meter added today, through resets", () => {
    expect(counted([{ state: "100.5" }, { state: "101" }, { state: "unavailable" }, { state: "102.5" }])).toBeCloseTo(2);
    // Reset to 0.3 at midnight-ish: 0.3 counts too.
    expect(counted([{ state: "12" }, { state: "0.3" }, { state: "1.3" }])).toBeCloseTo(1.3);
    expect(counted([{ state: "unknown" }])).toBeNull();
  });

  it("works out consumption, self-use and cost", () => {
    const today = energyToday(
      [
        [{ entity_id: "sensor.solar", state: "1000" }, { state: "1006" }],
        [{ entity_id: "sensor.grid_in", state: "50" }, { state: "54" }],
        [{ entity_id: "sensor.grid_out", state: "20" }, { state: "21.5" }],
      ],
      { solar: "sensor.solar", gridImport: "sensor.grid_in", gridExport: "sensor.grid_out" },
    );
    expect(today).toEqual({ solar: 6, gridImport: 4, gridExport: 1.5 });
    const r = parseEnergy(today, { price: 0.25, currency: "€" }, [{ name: "House", watts: 1830 }]);
    expect(val(r, "Consumption")).toMatchObject({ value: "8.50 kWh", raw: 8.5 });
    expect(val(r, "Self-use")).toMatchObject({ value: "75%" });
    expect(val(r, "Cost")).toMatchObject({ value: "1.00 €" });
    expect(r.list).toEqual([{ label: "House", value: "1.83 kW", raw: 1830 }]);
    expect(parseEnergy({ consumption: 12.34 }, { currency: "€" }).fields.map((f) => f.label)).toEqual(["Consumption"]);
  });
});

describe("authentik outposts and version", () => {
  it("flags an outpost not seen for five minutes", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    const r = parseAuthentik(14, 37, 0, {
      version: "2026.8.1",
      now,
      outposts: [
        { name: "proxy", lastSeen: now - 30_000 },
        { name: "ldap", lastSeen: now - 10 * 60_000 },
        { name: "new", lastSeen: null },
      ],
    });
    expect(val(r, "Outposts")).toMatchObject({ value: "1/3", status: "error" });
    expect(val(r, "Version")?.value).toBe("2026.8.1");
    expect(r.list?.map((l) => l.value)).toEqual(["up", "down", "never seen"]);
    // Without the extra rights: as before.
    expect(parseAuthentik(1, 2, 3).fields.map((f) => f.label)).toEqual(["Users", "Logins 24h", "Failed 24h"]);
  });
});

describe("vaultwarden", () => {
  it("shows health, version and, with the admin token, users", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(parseVaultwarden({ up: false, latencyMs: 8000 }).fields[0]).toMatchObject({ value: "down", status: "error" });
    const r = parseVaultwarden({
      up: true,
      latencyMs: 12,
      version: "1.32.0",
      now,
      users: [
        { userEnabled: true, twoFactorEnabled: true, lastActive: "2026-10-10T08:00:00Z" },
        { userEnabled: true, twoFactorEnabled: false, lastActive: "2026-01-01T08:00:00Z" },
        { userEnabled: false, twoFactorEnabled: false },
      ],
    });
    expect(r.fields.map((f) => [f.label, f.value])).toEqual([
      ["Status", "up"],
      ["Response", "12 ms"],
      ["Version", "1.32.0"],
      ["Users", 2],
      ["2FA", "50%"],
      ["Active 30d", 1],
    ]);
  });

  it("are registered", () => {
    for (const type of ["vaultwarden", "homeassistant-energy", "authentik"]) expect(integrations[type]).toBeDefined();
    expect(integrations["homeassistant-energy"].schema.safeParse({ url: "http://ha:8123", token: "t", entities: { solar: "sensor.solar" } }).success).toBe(true);
  });
});
