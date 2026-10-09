import { describe, expect, it } from "vitest";
import { collectKeys } from "../scripts/i18n-keys.mjs";
import { fr } from "@/i18n/fr";
import { pickLocale, translator } from "@/i18n";

/** Code, YAML samples and example values that read the same in every language. */
const TECHNICAL = new Set([
  ".yaml",
  "JSON",
  "ms",
  "sso:",
  "services.yaml",
  "visible: [family, media]",
  "finance, travel, watchlist",
  "family, cn=media,ou=groups,dc=example,dc=com",
  "http://10.0.0.5:8080/health",
  "1.3.6.1.2.1.1.3.0 (sysUpTime)",
  "25565 (Java) / 19132 (Bedrock)",
  "[{{level}}] {{message}}",
]);
const isTechnical = (k: string) => TECHNICAL.has(k) || k.includes("\n");
const placeholders = (s: string) => [...s.matchAll(/\{\{?(\w+)\}?\}/g)].map((m) => m[0]).sort();

describe("French translation", () => {
  const keys = collectKeys();

  it("covers every text the UI shows", () => {
    expect(keys.length).toBeGreaterThan(800);
    const missing = keys.filter((k) => !(k in fr) && !isTechnical(k));
    expect(missing).toEqual([]);
  });

  it("keeps every {placeholder}", () => {
    const broken = Object.entries(fr).filter(([k, v]) => JSON.stringify(placeholders(k)) !== JSON.stringify(placeholders(v)));
    expect(broken).toEqual([]);
  });

  it("translates with placeholders and plurals, and falls back to English", () => {
    const t = translator("fr");
    expect(t("Delete {name}", { name: "NAS" })).toBe("Supprimer NAS");
    expect(t.plural(1, "{n} transaction", "{n} transactions")).toBe("1 transaction");
    expect(t.plural(0, "{n} problem", "{n} problems")).toBe("0 problème");
    expect(t.plural(3, "{n} problem", "{n} problems")).toBe("3 problèmes");
    expect(t("Not a key at all")).toBe("Not a key at all");
    expect(translator("en")("Delete {name}", { name: "NAS" })).toBe("Delete NAS");
    expect(translator("en").plural(0, "{n} problem", "{n} problems")).toBe("0 problems");
  });

  it("picks the language from the setting or the browser", () => {
    expect(pickLocale("fr", "en-US")).toBe("fr");
    expect(pickLocale("en", "fr-FR")).toBe("en");
    expect(pickLocale("auto", "fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(pickLocale("auto", "de-DE,fr;q=0.5")).toBe("fr");
    expect(pickLocale("auto", "de-DE")).toBe("en");
    expect(pickLocale("auto", null)).toBe("en");
  });
});
