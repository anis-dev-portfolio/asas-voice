import { describe, expect, it } from "vitest";
import { MAX_VOCABULARY, mergeTerms, normalizeVocabulary, splitTerms } from "./vocabulary";

describe("vocabulaire", () => {
  it("découpe une saisie en mots (espaces, virgules, points-virgules)", () => {
    expect(splitTerms(" Asas Voice, Weyda ;Jean-Pierre ")).toEqual([
      "Asas",
      "Voice",
      "Weyda",
      "Jean-Pierre",
    ]);
    expect(splitTerms("   ")).toEqual([]);
  });

  it("fusionne sans doublon (casse ignorée) et garde l'ordre", () => {
    expect(mergeTerms(["Asas"], ["asas", "Voice", "VOICE"])).toEqual(["Asas", "Voice"]);
  });

  it("respecte la limite de 100 termes", () => {
    const many = Array.from({ length: 150 }, (_, i) => `mot${i}`);
    expect(mergeTerms([], many)).toHaveLength(MAX_VOCABULARY);
  });

  it("normalise une liste héritée contenant des expressions", () => {
    expect(normalizeVocabulary(["Asas Voice", "Asas"])).toEqual(["Asas", "Voice"]);
  });
});
