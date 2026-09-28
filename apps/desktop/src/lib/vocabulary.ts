/**
 * Vocabulaire personnalisé (context biasing Voxtral). L'API n'accepte que des MOTS : un
 * terme contenant un espace ou une virgule fait échouer toute la transcription. On découpe
 * donc les expressions en mots, sans doublon (casse ignorée), bornés à 100.
 */
export const MAX_VOCABULARY = 100;

/** Découpe un texte saisi (« Asas Voice, Weyda ») en mots utilisables. */
export function splitTerms(input: string): string[] {
  return input
    .split(/[\s,;]+/u)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Ajoute des mots à une liste existante, sans doublon, dans la limite autorisée. */
export function mergeTerms(existing: string[], incoming: string[]): string[] {
  const out = [...existing];
  const seen = new Set(existing.map((t) => t.toLocaleLowerCase("fr")));
  for (const word of incoming) {
    if (out.length >= MAX_VOCABULARY) break;
    const key = word.toLocaleLowerCase("fr");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

/** Normalise une liste héritée (qui pouvait contenir des expressions) en liste de mots. */
export function normalizeVocabulary(terms: string[]): string[] {
  return mergeTerms([], terms.flatMap(splitTerms));
}
