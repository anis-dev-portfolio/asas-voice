import { describe, expect, it } from "vitest";
import { applyAutoFormat, applyVoiceCommands, postProcess } from "./postprocess";

describe("applyVoiceCommands — ponctuation", () => {
  it("« virgule » → ,", () => {
    expect(applyVoiceCommands("bonjour virgule ça va")).toBe("bonjour, ça va");
  });

  it("« point » en fin → .", () => {
    expect(applyVoiceCommands("c'est fini point")).toBe("c'est fini.");
  });

  it("préserve « point de vue » (lookahead négatif)", () => {
    expect(applyVoiceCommands("mon point de vue compte")).toBe("mon point de vue compte");
  });

  it("« deux points » → :", () => {
    expect(applyVoiceCommands("liste deux points a b")).toBe("liste: a b");
  });

  it("« point d'interrogation » → ?", () => {
    expect(applyVoiceCommands("ça va point d'interrogation")).toBe("ça va?");
  });
});

describe("applyVoiceCommands — sauts de ligne & suppression", () => {
  it("« nouvelle ligne » → saut de ligne", () => {
    expect(applyVoiceCommands("a nouvelle ligne b")).toBe("a\n b");
  });

  it("« nouveau paragraphe » → double saut", () => {
    expect(applyVoiceCommands("a nouveau paragraphe b")).toBe("a\n\n b");
  });

  it("« mot supprime ça » retire le mot précédent ET la commande", () => {
    expect(applyVoiceCommands("bonjour erreur supprime ça").trim()).toBe("bonjour");
  });

  it("« supprime ça » isolé retire juste la commande", () => {
    expect(applyVoiceCommands("supprime ça bonjour").trim()).toBe("bonjour");
  });

  it("accepte « efface cela » comme variante", () => {
    expect(applyVoiceCommands("texte parasite efface cela").trim()).toBe("texte");
  });
});

describe("applyAutoFormat", () => {
  it("réduit les espaces multiples et met une majuscule en tête", () => {
    expect(applyAutoFormat("  bonjour   monde  ")).toBe("Bonjour monde");
  });

  it("supprime l'espace avant une ponctuation collante", () => {
    expect(applyAutoFormat("salut ,  ça va")).toBe("Salut, ça va");
  });

  it("ajoute un espace manquant après la ponctuation", () => {
    expect(applyAutoFormat("un.deux trois")).toBe("Un. Deux trois");
  });

  it("préserve un nombre décimal (pas d'espace après le point)", () => {
    expect(applyAutoFormat("le prix est 3.14 euros")).toBe("Le prix est 3.14 euros");
  });

  it("met une majuscule après un point et après un saut de ligne", () => {
    expect(applyAutoFormat("bonjour. ça va\noui")).toBe("Bonjour. Ça va\nOui");
  });
});

describe("postProcess — pipeline", () => {
  it("commandes puis mise en forme (nouvelle ligne nettoyée)", () => {
    expect(
      postProcess("ligne un nouvelle ligne ligne deux", { voiceCommands: true, autoFormat: true }),
    ).toBe("Ligne un\nLigne deux");
  });

  it("virgule + majuscule + espaces", () => {
    expect(
      postProcess("bonjour  virgule   le monde", { voiceCommands: true, autoFormat: true }),
    ).toBe("Bonjour, le monde");
  });

  it("n'altère rien si les deux options sont désactivées", () => {
    const raw = "texte virgule brut";
    expect(postProcess(raw, { voiceCommands: false, autoFormat: false })).toBe(raw);
  });
});
