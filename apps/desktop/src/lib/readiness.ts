/**
 * État « prêt à dicter » : agrège tout ce qui doit fonctionner pour qu'une dictée
 * aboutisse, et le traduit en un verdict lisible. Fonction PURE (testée) : l'UI n'invente
 * jamais un état, elle affiche ce que ce calcul déduit des sondes réelles.
 */
import type { EngineCheck, HealthResponse } from "@asas-voice/shared";
import type { Screen } from "../store/ui";

export type ServiceState = "checking" | "up" | "down";
export type MicPermission = "prompt" | "granted" | "denied" | "unknown";

export type ItemState = "ok" | "pending" | "warn" | "error" | "off";

export type ReadinessId = "service" | "transcription" | "microphone" | "shortcut" | "correction";

export interface ReadinessItem {
  id: ReadinessId;
  state: ItemState;
  /** Nom court de l'élément (« Clé Mistral »). */
  label: string;
  /** État en quelques mots (« Vérifiée », « Refusée »). */
  detail: string;
  /** Écran où corriger le problème, s'il y en a un. */
  fix?: Screen;
}

export type ReadinessLevel = "ready" | "checking" | "degraded" | "blocked";

export interface Readiness {
  level: ReadinessLevel;
  /** Verdict en 1 à 3 mots pour la barre de titre. */
  headline: string;
  items: ReadinessItem[];
}

export interface ReadinessInput {
  service: ServiceState;
  health: HealthResponse | null;
  transcriptionCheck: EngineCheck | null;
  correctionCheck: EngineCheck | null;
  verifying: boolean;
  micPermission: MicPermission;
  /** Nombre de micros détectés ; null = pas encore énuméré. */
  micCount: number | null;
  shortcutOk: boolean;
  correctionEnabled: boolean;
}

function serviceItem(service: ServiceState): ReadinessItem {
  const base = { id: "service" as const, label: "Service local" };
  if (service === "checking") return { ...base, state: "pending", detail: "Démarrage…" };
  if (service === "down") return { ...base, state: "error", detail: "Arrêté" };
  return { ...base, state: "ok", detail: "Actif" };
}

function transcriptionItem(input: ReadinessInput): ReadinessItem {
  const base = { id: "transcription" as const, label: "Clé Mistral", fix: "engines" as Screen };
  if (input.service !== "up" || !input.health) {
    return { ...base, state: "pending", detail: "En attente du service" };
  }
  if (!input.health.ready) return { ...base, state: "error", detail: "Manquante" };
  const check = input.transcriptionCheck;
  if (!check) {
    return {
      ...base,
      state: "pending",
      detail: input.verifying ? "Vérification…" : "Non vérifiée",
    };
  }
  switch (check.status) {
    case "ok":
      return { ...base, state: "ok", detail: "Vérifiée" };
    case "missing_key":
      return { ...base, state: "error", detail: "Manquante" };
    case "invalid_key":
      return { ...base, state: "error", detail: "Refusée" };
    case "model_unavailable":
      return { ...base, state: "error", detail: "Modèle inaccessible" };
    case "rate_limited":
      return { ...base, state: "warn", detail: "Quota atteint" };
    case "unreachable":
      return { ...base, state: "warn", detail: "Hors ligne" };
    default:
      return { ...base, state: "warn", detail: "À revérifier" };
  }
}

function microphoneItem(input: ReadinessInput): ReadinessItem {
  const base = { id: "microphone" as const, label: "Micro", fix: "settings" as Screen };
  if (input.micPermission === "denied") return { ...base, state: "error", detail: "Accès refusé" };
  if (input.micCount === null) return { ...base, state: "pending", detail: "Détection…" };
  if (input.micCount === 0) return { ...base, state: "error", detail: "Aucun micro" };
  return {
    ...base,
    state: "ok",
    detail: input.micPermission === "granted" ? "Autorisé" : "Détecté",
  };
}

function shortcutItem(ok: boolean): ReadinessItem {
  const base = { id: "shortcut" as const, label: "Raccourci", fix: "settings" as Screen };
  return ok
    ? { ...base, state: "ok", detail: "Actif" }
    : { ...base, state: "error", detail: "Déjà pris" };
}

function correctionItem(input: ReadinessInput): ReadinessItem {
  const base = { id: "correction" as const, label: "Correction IA", fix: "engines" as Screen };
  if (!input.correctionEnabled) return { ...base, state: "off", detail: "Désactivée" };
  if (input.service !== "up" || !input.health) {
    return { ...base, state: "pending", detail: "En attente du service" };
  }
  // La correction est optionnelle : un problème la dégrade (texte livré brut), il ne bloque pas.
  if (!input.health.hasAnthropicKey) return { ...base, state: "warn", detail: "Clé manquante" };
  const check = input.correctionCheck;
  if (!check) {
    return {
      ...base,
      state: "pending",
      detail: input.verifying ? "Vérification…" : "Non vérifiée",
    };
  }
  if (check.status === "ok") return { ...base, state: "ok", detail: "Vérifiée" };
  if (check.status === "invalid_key") return { ...base, state: "warn", detail: "Clé refusée" };
  if (check.status === "unreachable") return { ...base, state: "warn", detail: "Hors ligne" };
  return { ...base, state: "warn", detail: "Indisponible" };
}

/** Calcule le verdict global et le détail par élément. */
export function computeReadiness(input: ReadinessInput): Readiness {
  const items = [
    serviceItem(input.service),
    transcriptionItem(input),
    microphoneItem(input),
    shortcutItem(input.shortcutOk),
    correctionItem(input),
  ];
  const firstError = items.find((i) => i.state === "error");
  if (firstError) {
    return { level: "blocked", headline: headlineFor(firstError), items };
  }
  if (items.some((i) => i.state === "pending")) {
    return { level: "checking", headline: "Vérification…", items };
  }
  const firstWarn = items.find((i) => i.state === "warn");
  if (firstWarn) return { level: "degraded", headline: headlineFor(firstWarn), items };
  return { level: "ready", headline: "Prêt", items };
}

const TRANSCRIPTION_HEADLINES: Record<string, string> = {
  Manquante: "Clé manquante",
  Refusée: "Clé refusée",
  "Modèle inaccessible": "Modèle inaccessible",
  "Quota atteint": "Quota atteint",
  "Hors ligne": "Hors ligne",
};

function headlineFor(item: ReadinessItem): string {
  switch (item.id) {
    case "service":
      return "Service arrêté";
    case "transcription":
      return TRANSCRIPTION_HEADLINES[item.detail] ?? "Clé à revérifier";
    case "microphone":
      return item.detail;
    case "shortcut":
      return "Raccourci indisponible";
    case "correction":
      return "Correction indisponible";
  }
}
