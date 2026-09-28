import { describe, expect, it } from "vitest";
import { migrateSettings } from "./settingsMigration";

describe("migrateSettings", () => {
  it("v0 : autoPaste → outputMode", () => {
    expect(migrateSettings({ autoPaste: false }, 0).outputMode).toBe("clipboard");
    expect(migrateSettings({ autoPaste: true }, 0).outputMode).toBe("cursor");
    expect(migrateSettings({ autoPaste: true }, 0)).not.toHaveProperty("autoPaste");
  });

  it("v1 → v2 : retire le faux choix de qualité", () => {
    const out = migrateSettings({ quality: "fast", language: "en" }, 1);
    expect(out).not.toHaveProperty("quality");
    expect(out.language).toBe("en");
  });

  it("v1 → v2 : retire l'ancien mode continu sans changer le comportement du raccourci", () => {
    const out = migrateSettings({ continuousMode: true }, 1);
    expect(out).not.toHaveProperty("continuousMode");
    expect(out).not.toHaveProperty("dictationMode"); // défaut « maintenir » appliqué par le store
  });

  it("conserve les réglages utilisateur existants", () => {
    const out = migrateSettings(
      { vocabulary: ["Weyda"], pushToTalkShortcut: "Alt+F9", onboardingComplete: true },
      1,
    );
    expect(out).toMatchObject({
      vocabulary: ["Weyda"],
      pushToTalkShortcut: "Alt+F9",
      onboardingComplete: true,
    });
  });

  it("v2 → v3 : découpe les expressions du vocabulaire en mots, sans doublon", () => {
    const out = migrateSettings({ vocabulary: ["Asas Voice", "Weyda", "asas", "Jean-Pierre"] }, 2);
    expect(out.vocabulary).toEqual(["Asas", "Voice", "Weyda", "Jean-Pierre"]);
  });

  it("tolère un état persisté absent", () => {
    expect(migrateSettings(undefined, 0)).toEqual({});
  });
});
