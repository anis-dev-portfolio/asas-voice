import { describe, expect, it } from "vitest";
import {
  countWords,
  dayLabel,
  formatDuration,
  formatRelative,
  formatSeconds,
  formatWords,
  groupByDay,
} from "./format";

// Mercredi 24 septembre 2026, 15:00 locale.
const NOW = new Date(2026, 8, 24, 15, 0, 0).getTime();

describe("durées", () => {
  it("millisecondes sous la seconde, secondes au-delà (virgule française)", () => {
    expect(formatDuration(320)).toBe("320 ms");
    expect(formatDuration(1420)).toBe("1,4 s");
    expect(formatDuration(-1)).toBe("—");
  });
  it("secondes d'audio", () => {
    expect(formatSeconds(3.25)).toBe("3,3 s");
    expect(formatSeconds(12)).toBe("12 s");
  });
});

describe("mots", () => {
  it("compte les mots et accorde le pluriel", () => {
    expect(countWords("  Bonjour à tous \n ça va ")).toBe(5);
    expect(countWords("   ")).toBe(0);
    expect(formatWords(1)).toBe("1 mot");
    expect(formatWords(12)).toBe("12 mots");
  });
});

describe("temps relatif", () => {
  it("à l'instant, minutes, heures", () => {
    expect(formatRelative(NOW - 10_000, NOW)).toBe("à l'instant");
    expect(formatRelative(NOW - 3 * 60_000, NOW)).toBe("il y a 3 min");
    expect(formatRelative(NOW - 2 * 3_600_000, NOW)).toBe("il y a 2 h");
  });
});

describe("jours", () => {
  it("aujourd'hui, hier, puis la date", () => {
    expect(dayLabel(new Date(2026, 8, 24, 8, 0).getTime(), NOW)).toBe("Aujourd'hui");
    expect(dayLabel(new Date(2026, 8, 23, 23, 30).getTime(), NOW)).toBe("Hier");
    expect(dayLabel(new Date(2026, 8, 21, 10, 0).getTime(), NOW)).toBe("lundi 21 septembre");
    expect(dayLabel(new Date(2025, 11, 1, 10, 0).getTime(), NOW)).toContain("2025");
  });

  it("regroupe des éléments triés par jour", () => {
    const items = [
      new Date(2026, 8, 24, 14, 0).getTime(),
      new Date(2026, 8, 24, 9, 0).getTime(),
      new Date(2026, 8, 23, 18, 0).getTime(),
    ];
    const groups = groupByDay(items, (x) => x, NOW);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["Aujourd'hui", 2],
      ["Hier", 1],
    ]);
  });
});
