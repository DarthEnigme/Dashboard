import { describe, expect, it } from "vitest";
import { crc32, zip } from "@/lib/zip";
import { changedFields, fieldKeys, validateSettings } from "@/components/settings/validate";
import { sections } from "@/components/settings/sections";
import { settingsSchema } from "@/lib/config/schema";

describe("zip", () => {
  it("computes CRC-32", () => {
    expect(crc32(Buffer.from("hello"))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes local headers, a central directory and the end record", () => {
    const out = zip([
      { name: "settings.yaml", data: "title: Home\n" },
      { name: "services.yaml", data: "[]\n" },
    ]);
    expect(out.readUInt32LE(0)).toBe(0x04034b50);
    const end = out.subarray(out.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(10)).toBe(2); // entries
    const dirStart = end.readUInt32LE(16);
    expect(out.readUInt32LE(dirStart)).toBe(0x02014b50);
    // First entry's data follows its 30-byte header and name, uncompressed.
    const nameLen = out.readUInt16LE(26);
    expect(out.subarray(30 + nameLen, 30 + nameLen + 12).toString()).toBe("title: Home\n");
    expect(out.readUInt32LE(14)).toBe(crc32(Buffer.from("title: Home\n")));
  });
});

describe("settings page", () => {
  it("covers every setting in the schema", () => {
    const top = Object.keys(settingsSchema.removeDefault().shape);
    const covered = new Set(fieldKeys.map((k) => k.split(".")[0]));
    expect(top.filter((k) => !covered.has(k))).toEqual([]);
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
  });

  it("maps schema issues to the fields they belong to", () => {
    const { errors, parsed } = validateSettings({ refreshInterval: 2, auth: { providers: [{ id: "Bad Id", type: "oidc", clientId: "x", clientSecret: "y" }] } });
    expect(parsed).toBeUndefined();
    expect(errors.refreshInterval).toMatch(/greater than or equal to 5/);
    expect(errors["auth.providers"]).toMatch(/^0\.id: /);
  });

  it("lets env placeholders through (they are resolved on the server)", () => {
    expect(validateSettings({ refreshInterval: "{{HOMEPAGE_VAR_REFRESH}}" }).errors).toEqual({});
  });

  it("fills defaults for the preview and lists changed fields", () => {
    expect(validateSettings({ style: "liquid" }).parsed?.background.gradient).toBe("aurora");
    expect(changedFields({ title: "A", background: { blur: 2 } }, { title: "A" })).toEqual(["background.blur"]);
    expect(changedFields({ tabs: undefined }, {})).toEqual([]);
  });
});
