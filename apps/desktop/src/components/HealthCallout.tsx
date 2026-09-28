import type { Readiness, ReadinessId } from "../lib/readiness";
import { useUi } from "../store/ui";
import { AlertIcon, ChevronRightIcon } from "./icons";

/** Explication + marche à suivre pour chaque problème bloquant ou dégradant. */
const EXPLAIN: Partial<Record<ReadinessId, Record<string, string>>> = {
  transcription: {
    Manquante: "Ajoutez votre clé Mistral pour activer la transcription.",
    Refusée: "Mistral refuse la clé enregistrée. Collez-en une valide.",
    "Modèle inaccessible": "Votre compte Mistral n'a pas accès au modèle de transcription.",
    "Quota atteint": "Quota Mistral atteint : la transcription reprendra dans un instant.",
    "Hors ligne": "Mistral est injoignable. Vérifiez votre connexion Internet.",
    "À revérifier": "La dernière vérification a échoué. Relancez-la depuis Moteurs.",
  },
  microphone: {
    "Accès refusé":
      "Windows bloque l'accès au micro. Autorisez-le dans Paramètres › Confidentialité › Microphone.",
    "Aucun micro": "Aucun micro n'est branché ou activé.",
  },
  shortcut: {
    "Déjà pris": "Une autre application utilise déjà ce raccourci. Choisissez-en un autre.",
  },
  correction: {
    "Clé manquante":
      "La correction IA est activée sans clé Anthropic : le texte est collé sans correction.",
    "Clé refusée": "Anthropic refuse la clé : le texte est collé sans correction.",
    "Hors ligne": "Anthropic est injoignable : le texte est collé sans correction.",
    Indisponible: "La correction IA est indisponible : le texte est collé sans correction.",
  },
};

const FIX_LABEL = { engines: "Ouvrir Moteurs", settings: "Ouvrir Réglages" } as const;

/** Encadré affiché sur l'écran Dictée quand quelque chose empêche (ou dégrade) la dictée. */
export function HealthCallout({ readiness }: { readiness: Readiness }) {
  const setScreen = useUi((s) => s.setScreen);
  // Le service arrêté a son propre bandeau (avec relance) : pas de doublon ici.
  const item = readiness.items.find(
    (i) => (i.state === "error" || i.state === "warn") && i.id !== "service",
  );
  if (!item) return null;
  const text = EXPLAIN[item.id]?.[item.detail] ?? `${item.label} : ${item.detail}.`;
  const fix = item.fix === "engines" || item.fix === "settings" ? item.fix : null;
  return (
    <div className={`callout callout--${item.state === "error" ? "error" : "warn"}`} role="alert">
      <span className="callout__icon" aria-hidden="true">
        <AlertIcon />
      </span>
      <p className="callout__text">{text}</p>
      {fix && (
        <button
          type="button"
          className="btn btn--quiet callout__action"
          onClick={() => setScreen(fix)}
        >
          {FIX_LABEL[fix]}
          <ChevronRightIcon />
        </button>
      )}
    </div>
  );
}
