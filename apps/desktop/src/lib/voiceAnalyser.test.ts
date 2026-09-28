import { describe, expect, it } from "vitest";
import { VOICE_BANDS } from "@asas-voice/shared";
import { createBandMapper, rmsOf } from "./voiceAnalyser";

describe("createBandMapper", () => {
  const toBands = createBandMapper(48_000, 512);

  it("produit VOICE_BANDS bandes", () => {
    expect(toBands(new Uint8Array(512))).toHaveLength(VOICE_BANDS);
  });

  it("silence → toutes les bandes à 0", () => {
    expect(toBands(new Uint8Array(512)).every((v) => v === 0)).toBe(true);
  });

  it("plein niveau → bandes bornées à 1", () => {
    const bands = toBands(new Uint8Array(512).fill(255));
    expect(bands.every((v) => v > 0.99 && v <= 1)).toBe(true);
  });

  it("une énergie à ~1 kHz allume une bande médiane, pas les extrêmes", () => {
    const freq = new Uint8Array(512);
    const bin = Math.round(1000 / (24_000 / 512));
    for (let i = bin - 1; i <= bin + 1; i++) freq[i] = 230;
    const bands = toBands(freq);
    const hot = bands.findIndex((v) => v > 0.3);
    expect(hot).toBeGreaterThan(4);
    expect(hot).toBeLessThan(VOICE_BANDS - 4);
    expect(bands[0]).toBe(0);
    expect(bands[VOICE_BANDS - 1]).toBe(0);
  });
});

describe("rmsOf", () => {
  it("signal centré (silence) → 0", () => {
    expect(rmsOf(new Uint8Array(64).fill(128))).toBe(0);
  });
  it("signal carré pleine échelle → ~1", () => {
    const sq = new Uint8Array(64).map((_, i) => (i % 2 ? 0 : 255));
    expect(rmsOf(sq)).toBeGreaterThan(0.99);
  });
});
