import type { SettingsState } from "../store/settings";
import { normalizeVocabulary } from "./vocabulary";

/** Forme persistée des versions antérieures (champs retirés ou renommés depuis). */
type LegacySettings = Partial<SettingsState> & {
  autoPaste?: boolean;
  continuousMode?: boolean;
  quality?: string;
};

/**
 * Migration des réglages persistés :
 *  - v0 → v1 : l'ancien booléen autoPaste devient outputMode ;
 *  - v1 → v2 : le faux choix « qualité » disparaît (un seul modèle existe) et l'ancien
 *    « mode continu » (qui ne servait qu'à rendre l'orbe cliquable — elle l'est désormais
 *    toujours) est retiré. Le raccourci garde son comportement : maintenir pour parler ;
 *  - v2 → v3 : le vocabulaire est découpé en mots (Voxtral refuse les expressions, ce qui
 *    faisait échouer toute la transcription dès qu'un terme contenait un espace).
 */
export function migrateSettings(persisted: unknown, version: number): Partial<SettingsState> {
  const state = { ...((persisted ?? {}) as LegacySettings) };
  if (version < 1 && typeof state.autoPaste === "boolean") {
    state.outputMode = state.autoPaste ? "cursor" : "clipboard";
  }
  if (version < 2) {
    delete state.continuousMode;
    delete state.quality;
  }
  if (version < 3 && Array.isArray(state.vocabulary)) {
    state.vocabulary = normalizeVocabulary(
      state.vocabulary.filter((t): t is string => typeof t === "string"),
    );
  }
  delete state.autoPaste;
  return state;
}
