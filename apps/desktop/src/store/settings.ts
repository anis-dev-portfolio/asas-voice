import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TranscriptionLanguage } from "@asas-voice/shared";
import { migrateSettings } from "../lib/settingsMigration";

/** Mode de sortie du texte transcrit. */
export type OutputMode = "cursor" | "clipboard";

/** Comportement du raccourci : maintenir pour parler, ou appuyer pour démarrer/arrêter. */
export type DictationMode = "hold" | "toggle";

/** Visibilité de l'orbe flottante : toujours à l'écran, ou seulement pendant une dictée. */
export type OrbVisibility = "always" | "dictation";

/** Thème de l'interface (la DA reste violet-sombre ; « clair » est une variante chaude). */
export type Theme = "dark" | "light";

/** État de configuration persistant (localStorage de la webview). */
export interface SettingsState {
  /** deviceId du micro choisi ; null = micro par défaut du système. */
  selectedMicId: string | null;
  /** Langue de transcription (fr par défaut). */
  language: TranscriptionLanguage;
  /** Raccourci global de dictée (syntaxe Tauri, ex. "CommandOrControl+Space"). */
  pushToTalkShortcut: string;
  /** Maintenir le raccourci pendant qu'on parle, ou l'utiliser comme interrupteur. */
  dictationMode: DictationMode;
  /** Mode de sortie : insertion au curseur ou copie seule. */
  outputMode: OutputMode;
  /** Mise en forme automatique (ponctuation, majuscules) du texte transcrit. */
  autoFormat: boolean;
  /** Reconnaître les commandes vocales d'édition (« nouvelle ligne », « point »…). */
  voiceCommands: boolean;
  /** Vocabulaire personnalisé → context biasing (≤100 termes/phrases). */
  vocabulary: string[];
  /** Quand afficher l'orbe flottante. */
  orbVisibility: OrbVisibility;
  /**
   * Effet « livraison » au collage : l'orbe lance le texte vers le curseur, qui s'illumine
   * en violet. Purement visuel, sans aucune attente ajoutée au collage.
   */
  deliveryAnimation: boolean;
  /** Thème de l'interface. */
  theme: Theme;
  /** Onboarding 1er lancement terminé (clé API, micro, raccourci, test). */
  onboardingComplete: boolean;
  /** Correction du texte transcrit par Claude (nécessite une clé Anthropic). */
  claudePostProcess: boolean;

  setSelectedMic: (deviceId: string | null) => void;
  setLanguage: (language: TranscriptionLanguage) => void;
  setPushToTalkShortcut: (shortcut: string) => void;
  setDictationMode: (mode: DictationMode) => void;
  setOutputMode: (mode: OutputMode) => void;
  setAutoFormat: (on: boolean) => void;
  setVoiceCommands: (on: boolean) => void;
  setVocabulary: (terms: string[]) => void;
  setOrbVisibility: (visibility: OrbVisibility) => void;
  setDeliveryAnimation: (on: boolean) => void;
  setTheme: (theme: Theme) => void;
  setOnboardingComplete: (done: boolean) => void;
  setClaudePostProcess: (on: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      selectedMicId: null,
      language: "fr",
      pushToTalkShortcut: "CommandOrControl+Space",
      dictationMode: "hold",
      outputMode: "cursor",
      autoFormat: true,
      voiceCommands: true,
      vocabulary: [],
      orbVisibility: "always",
      deliveryAnimation: true,
      theme: "dark",
      onboardingComplete: false,
      claudePostProcess: false,
      setSelectedMic: (selectedMicId) => set({ selectedMicId }),
      setLanguage: (language) => set({ language }),
      setPushToTalkShortcut: (pushToTalkShortcut) => set({ pushToTalkShortcut }),
      setDictationMode: (dictationMode) => set({ dictationMode }),
      setOutputMode: (outputMode) => set({ outputMode }),
      setAutoFormat: (autoFormat) => set({ autoFormat }),
      setVoiceCommands: (voiceCommands) => set({ voiceCommands }),
      setVocabulary: (vocabulary) => set({ vocabulary }),
      setOrbVisibility: (orbVisibility) => set({ orbVisibility }),
      setDeliveryAnimation: (deliveryAnimation) => set({ deliveryAnimation }),
      setTheme: (theme) => set({ theme }),
      setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
      setClaudePostProcess: (claudePostProcess) => set({ claudePostProcess }),
    }),
    {
      name: "asas-voice-settings",
      version: 3,
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsState,
    },
  ),
);
