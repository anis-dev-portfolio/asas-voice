import { describe, expect, it } from "vitest";
import { buildExport } from "./export";
import type { DictationRow } from "./history";

const items: DictationRow[] = [
  { id: 1, text: "  Première dictée  ", duration_sec: 12, created_at: 1_700_000_000_000, pinned: 1 },
  { id: 2, text: "Seconde dictée", duration_sec: 5, created_at: 1_700_000_100_000, pinned: 0 },
];

describe("buildExport — Markdown", () => {
  it("écrit un titre, les textes (trimés) et marque les épinglées", () => {
    const md = buildExport(items, "md");
    expect(md).toContain("# Asas Voice — historique des dictées");
    expect(md).toContain("Première dictée");
    expect(md).toContain("Seconde dictée");
    expect(md).toContain("· épinglée");
    expect(md).not.toContain("  Première dictée  "); // texte trimé
  });
});

describe("buildExport — texte brut", () => {
  it("inclut la durée et sépare les entrées", () => {
    const txt = buildExport(items, "txt");
    expect(txt).toContain("(12s)");
    expect(txt).toContain("Première dictée");
    expect(txt).toContain("———"); // séparateur entre deux entrées
  });
});
