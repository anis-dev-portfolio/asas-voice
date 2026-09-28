import { useCallback, useEffect, useRef } from "react";
import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import type { EngineCheck } from "@asas-voice/shared";
import { openMicStream } from "./audio";
import { startRecording, type ActiveRecording } from "./recorder";
import { startVoiceAnalyser, type VoiceAnalyser } from "./voiceAnalyser";
import {
  postAudioForTranscription,
  TranscribeError,
  type TranscribeFailure,
} from "./transcribeClient";
import { postProcess } from "./postprocess";
import { postprocessText } from "./config";
import { captureTarget, copyText, pasteText } from "./paste";
import { pushOrbState, pushVoiceFrame } from "./orbEvents";
import { useSettings } from "../store/settings";
import { STEP_ORDER, useRecording } from "../store/recording";
import { useHistory } from "../store/history";
import { useSystem } from "../store/system";

/** D'où vient la demande de dictée : le raccourci global, ou un clic dans Asas Voice. */
export type DictationSource = "shortcut" | "app";

/** Contrôles de dictée exposés à l'UI (clic sur l'orbe). */
export interface DictationControls {
  /** Démarre si à l'arrêt, arrête sinon. */
  toggle: (source?: DictationSource) => void;
}

const CONFIRM_HOLD_MS = 760;
const ERROR_HOLD_MS = 1100;
/**
 * Durée max d'un enregistrement côté client. On coupe AVANT la limite backend de 60 s
 * (Voxtral) pour éviter une erreur en bout de chaîne : la dictée jusqu'ici est transcrite
 * normalement et l'utilisateur est prévenu.
 */
const MAX_RECORDING_MS = 55_000;

/** Libellé court affiché sous l'étape « Transcription » quand elle échoue. */
function transcribeNote(code: TranscribeFailure): string {
  switch (code) {
    case "invalid_api_key":
      return "Clé refusée";
    case "missing_api_key":
      return "Clé manquante";
    case "invalid_audio":
      return "Son inexploitable";
    case "rate_limited":
      return "Quota atteint";
    case "timeout":
    case "upstream_timeout":
      return "Délai dépassé";
    case "service_unreachable":
      return "Service arrêté";
    default:
      return "Échec";
  }
}

/** Correction IA effective : activée dans les réglages ET une clé Anthropic est présente. */
function correctionEnabled(): boolean {
  return (
    useSettings.getState().claudePostProcess &&
    Boolean(useSystem.getState().health?.hasAnthropicKey)
  );
}

/** File des opérations sur le raccourci global (exécutées une à une, dans l'ordre). */
let shortcutQueue: Promise<unknown> = Promise.resolve();
function enqueueShortcutOp(op: () => Promise<unknown>): Promise<unknown> {
  shortcutQueue = shortcutQueue.then(op, op);
  return shortcutQueue;
}

function fmtSec(ms: number): string {
  return `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}

/**
 * Enregistre le raccourci global et orchestre le cycle
 * écoute → transcription → correction → insertion, étape par étape.
 * Pilote l'orbe (états + trames audio) et renseigne le déroulé affiché dans l'UI.
 * À appeler UNE fois (App).
 */
export function useDictation(): DictationControls {
  const shortcut = useSettings((s) => s.pushToTalkShortcut);

  const activeRef = useRef<ActiveRecording | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<VoiceAnalyser | null>(null);
  const busyRef = useRef(false);
  const sourceRef = useRef<DictationSource>("shortcut");
  const startedAtRef = useRef(0);
  const stateTimer = useRef<number | null>(null);
  // Garde-fou durée max : coupe l'enregistrement avant la limite backend.
  const maxDurationTimer = useRef<number | null>(null);
  // Vrai si l'utilisateur a relâché le raccourci AVANT que start() ait fini d'initialiser le micro.
  const releaseRequestedRef = useRef(false);
  // Mode bascule : ignore l'auto-répétition du clavier tant que la touche reste enfoncée.
  const keyDownRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (maxDurationTimer.current !== null) clearTimeout(maxDurationTimer.current);
    maxDurationTimer.current = null;
  }, []);

  const cleanupCapture = useCallback(() => {
    analyserRef.current?.stop();
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /** Affiche un état transitoire de l'orbe (confirmé / erreur) puis revient en veille. */
  const flashOrb = useCallback((state: "confirmed" | "error") => {
    if (stateTimer.current !== null) clearTimeout(stateTimer.current);
    pushOrbState(state);
    stateTimer.current = window.setTimeout(
      () => {
        stateTimer.current = null;
        pushOrbState("idle");
      },
      state === "confirmed" ? CONFIRM_HOLD_MS : ERROR_HOLD_MS,
    );
  }, []);

  const fail = useCallback(
    (message: string) => {
      useRecording.getState().set({ status: "error", lastError: message });
      flashOrb("error");
    },
    [flashOrb],
  );

  const stop = useCallback(async () => {
    clearTimers();
    const active = activeRef.current;
    if (!active) {
      // start() est peut-être encore dans ses await (init micro) : on mémorise le relâchement.
      if (busyRef.current) releaseRequestedRef.current = true;
      return;
    }
    activeRef.current = null;
    analyserRef.current?.stop();
    analyserRef.current = null;

    const rec = useRecording.getState();
    const audioMs = performance.now() - startedAtRef.current;
    rec.set({ status: "transcribing" });
    pushOrbState("transcribing");

    try {
      const blob = await active.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (blob.size === 0) {
        rec.setStep("capture", { state: "error", note: "Aucun son enregistré" });
        fail("Aucun son n'a été enregistré. Vérifiez le micro sélectionné.");
        return;
      }
      rec.setStep("capture", { state: "done", ms: audioMs, note: `${fmtSec(audioMs)} d'audio` });

      const settings = useSettings.getState();
      const { language, vocabulary, autoFormat, voiceCommands } = settings;
      const correctionOn = correctionEnabled();

      // ---- Transcription ----
      rec.setStep("transcribe", { state: "active" });
      const t0 = performance.now();
      let result;
      try {
        result = await postAudioForTranscription(blob, { language, vocabulary });
      } catch (err) {
        const code: TranscribeFailure =
          err instanceof TranscribeError ? err.code : "upstream_error";
        rec.setStep("transcribe", { state: "error", note: transcribeNote(code) });
        // Une clé refusée ou absente est un fait établi : l'état « Prêt » doit le refléter.
        if (code === "invalid_api_key" || code === "missing_api_key") {
          useSystem.getState().recordCheck({
            id: "transcription",
            status: code === "invalid_api_key" ? "invalid_key" : "missing_key",
            message: err instanceof Error ? err.message : "",
            checkedAt: Date.now(),
          });
        }
        fail(err instanceof Error ? err.message : "Échec de la transcription.");
        return;
      }
      const transcribeMs = performance.now() - t0;
      rec.setStep("transcribe", { state: "done", ms: transcribeMs, note: fmtSec(transcribeMs) });
      // Une transcription réussie prouve que la clé fonctionne.
      const prevCheck = useSystem.getState().checks.transcription;
      const proven: EngineCheck = {
        id: "transcription",
        status: "ok",
        message: "Confirmée par votre dernière dictée.",
        checkedAt: Date.now(),
        latencyMs: Math.round(transcribeMs),
        ...(prevCheck?.resolvedModel ? { resolvedModel: prevCheck.resolvedModel } : {}),
      };
      useSystem.getState().recordCheck(proven);

      let text = postProcess(result.text, { voiceCommands, autoFormat });
      // Rien d'exploitable (silence, bruit) : on le dit clairement au lieu de coller du
      // vide et de polluer l'historique d'entrées vides.
      if (!text.trim()) {
        rec.setStep("transcribe", { state: "error", ms: transcribeMs, note: "Aucune parole" });
        fail("Aucune parole détectée. Réessayez en parlant un peu plus fort.");
        return;
      }

      // ---- Correction (optionnelle, jamais bloquante) ----
      if (correctionOn) {
        rec.setStep("correct", { state: "active" });
        const c0 = performance.now();
        const outcome = await postprocessText(text);
        const correctMs = performance.now() - c0;
        text = outcome.text;
        if (outcome.applied) {
          rec.setStep("correct", { state: "done", ms: correctMs, note: fmtSec(correctMs) });
        } else {
          rec.setStep("correct", {
            state: "degraded",
            ms: correctMs,
            note: outcome.failure?.code === "invalid_api_key" ? "Clé refusée" : "Ignorée",
          });
          if (outcome.failure?.code === "invalid_api_key") {
            useSystem.getState().recordCheck({
              id: "correction",
              status: "invalid_key",
              message: outcome.failure.message,
              checkedAt: Date.now(),
            });
          }
          rec.set({
            notice: outcome.failure?.message ?? "Correction ignorée — texte livré tel quel.",
          });
        }
      }

      const finalResult = { ...result, text };
      await useHistory
        .getState()
        .add(text, result.durationSec)
        .catch(() => undefined);

      // ---- Insertion ----
      // Depuis la fenêtre Asas Voice elle-même, il n'y a pas de champ cible : on copie.
      rec.setStep("deliver", { state: "active" });
      const d0 = performance.now();
      const wantsPaste = settings.outputMode === "cursor" && sourceRef.current === "shortcut";
      let note: string | null;
      if (wantsPaste) {
        note = await pasteText(text, settings.deliveryAnimation)
          .then(() => "Collé au curseur")
          .catch(() =>
            copyText(text)
              .then(() => "Copié — collage impossible")
              .catch(() => null),
          );
      } else {
        note = await copyText(text)
          .then(() => "Copié")
          .catch(() => null);
      }
      const deliverMs = performance.now() - d0;

      if (note) {
        rec.setStep("deliver", {
          state: note === "Copié — collage impossible" ? "degraded" : "done",
          ms: deliverMs,
          note,
        });
        rec.set({ status: "idle", lastResult: finalResult, lastError: null, lastAt: Date.now() });
        flashOrb("confirmed");
      } else {
        rec.setStep("deliver", { state: "error", note: "Presse-papier bloqué" });
        rec.set({ lastResult: finalResult, lastAt: Date.now() });
        fail(
          "Texte transcrit mais impossible de le coller ou le copier (il est dans l'historique).",
        );
      }
    } catch (err) {
      // Erreur imprévue : l'étape en cours ne doit pas rester affichée « en cours ».
      const { pipeline, setStep } = useRecording.getState();
      for (const id of STEP_ORDER) {
        if (pipeline[id].state === "active") setStep(id, { state: "error", note: "Échec" });
      }
      fail(err instanceof Error ? err.message : "Échec de la dictée.");
    } finally {
      busyRef.current = false;
    }
  }, [clearTimers, fail, flashOrb]);

  const start = useCallback(
    async (source: DictationSource) => {
      if (busyRef.current) return; // ignore les « Pressed » répétés pendant le maintien
      busyRef.current = true;
      releaseRequestedRef.current = false;
      sourceRef.current = source;
      if (stateTimer.current !== null) {
        clearTimeout(stateTimer.current);
        stateTimer.current = null;
      }
      const rec = useRecording.getState();
      rec.resetPipeline(correctionEnabled());
      rec.setStep("capture", { state: "active" });
      rec.set({ notice: null, lastError: null });
      try {
        if (source === "shortcut") await captureTarget().catch(() => undefined);
        const { selectedMicId } = useSettings.getState();
        const stream = await openMicStream(selectedMicId);
        streamRef.current = stream;
        activeRef.current = startRecording(stream);
        startedAtRef.current = performance.now();
        // Trames audio → orbe (flottante + hero). Non bloquant : si l'AudioContext manque,
        // la dictée continue sans réactivité visuelle plutôt que d'échouer.
        try {
          analyserRef.current = startVoiceAnalyser(stream, pushVoiceFrame);
        } catch {
          analyserRef.current = null;
        }
        rec.set({ status: "recording" });
        pushOrbState("listening");
        clearTimers();
        maxDurationTimer.current = window.setTimeout(() => {
          useRecording
            .getState()
            .set({ notice: "Durée maximale atteinte (55 s) — dictée arrêtée automatiquement." });
          void stop();
        }, MAX_RECORDING_MS);
      } catch (err) {
        cleanupCapture();
        busyRef.current = false;
        releaseRequestedRef.current = false;
        // DOMException = échec micro/permission (message technique) → message générique.
        // Une Error simple vient de nos gardes (MediaRecorder absent) → message explicite.
        const message =
          !(err instanceof DOMException) && err instanceof Error && err.message
            ? err.message
            : "Impossible d'accéder au micro. Vérifiez qu'il est branché et autorisé.";
        rec.setStep("capture", { state: "error", note: "Micro inaccessible" });
        fail(message);
        return;
      }
      // Si l'utilisateur a déjà relâché pendant l'init, on enchaîne tout de suite sur l'arrêt.
      if (releaseRequestedRef.current) {
        releaseRequestedRef.current = false;
        void stop();
      }
    },
    [stop, cleanupCapture, clearTimers, fail],
  );

  const toggle = useCallback(
    (source: DictationSource = "app") => {
      const status = useRecording.getState().status;
      if (status === "recording") void stop();
      else if (!busyRef.current) void start(source);
    },
    [start, stop],
  );

  useEffect(() => {
    const handler = (event: ShortcutEvent): void => {
      const mode = useSettings.getState().dictationMode;
      if (mode === "hold") {
        if (event.state === "Pressed") void start("shortcut");
        else if (event.state === "Released") void stop();
        return;
      }
      // Bascule : un appui démarre, l'appui suivant arrête.
      if (event.state === "Released") {
        keyDownRef.current = false;
        return;
      }
      if (keyDownRef.current) return;
      keyDownRef.current = true;
      toggle("shortcut");
    };
    // Enregistrement et désenregistrement passent par une file : sans elle, un
    // désenregistrement en vol (changement de raccourci, remontage) croise le nouvel
    // enregistrement, qui échoue — et l'UI affiche à tort « raccourci déjà pris ».
    let cancelled = false;
    void enqueueShortcutOp(async () => {
      if (cancelled) return;
      await unregister(shortcut).catch(() => undefined);
      if (cancelled) return;
      try {
        await register(shortcut, handler);
        useRecording.getState().setShortcutOk(true);
      } catch {
        // Raccourci réellement pris par Windows ou une autre app : on le signale à l'UI
        // (Réglages/Dictée) au lieu d'échouer en silence.
        useRecording.getState().setShortcutOk(false);
      }
    });
    return () => {
      cancelled = true;
      void enqueueShortcutOp(() => unregister(shortcut).catch(() => undefined));
    };
  }, [shortcut, start, stop, toggle]);

  // Nettoyage au démontage.
  useEffect(
    () => () => {
      if (stateTimer.current !== null) clearTimeout(stateTimer.current);
      clearTimers();
      cleanupCapture();
    },
    [cleanupCapture, clearTimers],
  );

  return { toggle };
}
