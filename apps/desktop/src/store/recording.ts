import { create } from "zustand";
import type { TranscriptionResult } from "@asas-voice/shared";

export type DictationStatus = "idle" | "recording" | "transcribing" | "error";

/** Étapes d'une dictée, dans l'ordre où elles s'exécutent. */
export type StepId = "capture" | "transcribe" | "correct" | "deliver";
export const STEP_ORDER: StepId[] = ["capture", "transcribe", "correct", "deliver"];

/**
 * État d'une étape :
 *  - idle : pas encore atteinte ; active : en cours ; done : réussie ;
 *  - degraded : a échoué SANS bloquer (ex. correction indisponible → texte brut livré) ;
 *  - error : a fait échouer la dictée ; skipped : désactivée ou sans objet.
 */
export type StepState = "idle" | "active" | "done" | "degraded" | "error" | "skipped";

export interface StepStatus {
  state: StepState;
  /** Durée de l'étape (ms), une fois terminée. */
  ms?: number;
  /** Précision affichée sous l'étape (« Collé au curseur », « Clé refusée »…). */
  note?: string;
}

export type Pipeline = Record<StepId, StepStatus>;

export function emptyPipeline(correctionEnabled: boolean): Pipeline {
  return {
    capture: { state: "idle" },
    transcribe: { state: "idle" },
    correct: correctionEnabled ? { state: "idle" } : { state: "skipped", note: "Désactivée" },
    deliver: { state: "idle" },
  };
}

interface RecordingState {
  status: DictationStatus;
  lastResult: TranscriptionResult | null;
  lastError: string | null;
  /** Info non-bloquante (ex. arrêt auto sur durée max). Distincte d'une erreur. */
  notice: string | null;
  /** Faux si le raccourci global n'a pas pu être enregistré (déjà pris par l'OS/une app). */
  shortcutOk: boolean;
  /** Déroulé de la dernière dictée (ou de celle en cours), étape par étape. */
  pipeline: Pipeline;
  /** Horodatage de fin de la dernière dictée aboutie (ms epoch). */
  lastAt: number | null;
  set: (
    partial: Partial<
      Pick<RecordingState, "status" | "lastResult" | "lastError" | "notice" | "lastAt">
    >,
  ) => void;
  setShortcutOk: (ok: boolean) => void;
  resetPipeline: (correctionEnabled: boolean) => void;
  setStep: (id: StepId, status: StepStatus) => void;
}

/** État volatil de la dictée en cours (non persisté). */
export const useRecording = create<RecordingState>((set) => ({
  status: "idle",
  lastResult: null,
  lastError: null,
  notice: null,
  shortcutOk: true,
  pipeline: emptyPipeline(false),
  lastAt: null,
  set: (partial) => set(partial),
  setShortcutOk: (shortcutOk) => set({ shortcutOk }),
  resetPipeline: (correctionEnabled) => set({ pipeline: emptyPipeline(correctionEnabled) }),
  setStep: (id, status) => set((s) => ({ pipeline: { ...s.pipeline, [id]: status } })),
}));
