import type { ComponentType, SVGProps } from "react";
import type { Readiness, ReadinessItem } from "../lib/readiness";
import { formatDuration, formatRelative } from "../lib/format";
import { useNow } from "../lib/useNow";
import { STEP_ORDER, useRecording, type StepId, type StepState } from "../store/recording";
import { useSettings } from "../store/settings";
import { ClipboardIcon, CursorIcon, MicIcon, SparkIcon, WaveIcon } from "./icons";

type Tone = "idle" | "active" | "ok" | "warn" | "error" | "off";

interface StationView {
  id: StepId;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: Tone;
  detail: string;
}

const TONE_OF_STEP: Record<StepState, Tone> = {
  idle: "idle",
  active: "active",
  done: "ok",
  degraded: "warn",
  error: "error",
  skipped: "off",
};

const TONE_OF_ITEM: Record<ReadinessItem["state"], Tone> = {
  ok: "ok",
  pending: "idle",
  warn: "warn",
  error: "error",
  off: "off",
};

const LABELS: Record<StepId, string> = {
  capture: "Micro",
  transcribe: "Transcription",
  correct: "Correction IA",
  deliver: "Insertion",
};

interface PipelineProps {
  readiness: Readiness;
}

/**
 * Chaîne de dictée : Micro → Transcription → Correction → Insertion.
 * Avant toute dictée, chaque étape affiche si elle est PRÊTE (sondes réelles) ; ensuite,
 * ce qui s'est vraiment passé à la dernière dictée : durée, issue, et l'étape exacte qui a
 * échoué le cas échéant.
 */
export function Pipeline({ readiness }: PipelineProps) {
  const pipeline = useRecording((s) => s.pipeline);
  const status = useRecording((s) => s.status);
  const lastAt = useRecording((s) => s.lastAt);
  const outputMode = useSettings((s) => s.outputMode);
  const now = useNow();
  const hasRun = pipeline.capture.state !== "idle";

  const item = (id: ReadinessItem["id"]): ReadinessItem | undefined =>
    readiness.items.find((i) => i.id === id);

  const stations: StationView[] = STEP_ORDER.map((id) => {
    const Icon =
      id === "capture"
        ? MicIcon
        : id === "transcribe"
          ? WaveIcon
          : id === "correct"
            ? SparkIcon
            : outputMode === "cursor"
              ? CursorIcon
              : ClipboardIcon;
    if (hasRun) {
      const step = pipeline[id];
      const detail =
        step.note ??
        (step.state === "active"
          ? id === "capture"
            ? "À l'écoute…"
            : "En cours…"
          : step.ms !== undefined
            ? formatDuration(step.ms)
            : "—");
      return { id, label: LABELS[id], Icon, tone: TONE_OF_STEP[step.state], detail };
    }
    // Avant la première dictée : état de préparation de chaque étape.
    const ready =
      id === "capture"
        ? item("microphone")
        : id === "transcribe"
          ? item("transcription")
          : id === "correct"
            ? item("correction")
            : undefined;
    if (id === "deliver") {
      return {
        id,
        label: LABELS[id],
        Icon,
        tone: "ok",
        detail: outputMode === "cursor" ? "Au curseur" : "Presse-papier",
      };
    }
    return {
      id,
      label: LABELS[id],
      Icon,
      tone: ready ? TONE_OF_ITEM[ready.state] : "idle",
      detail: ready?.detail ?? "—",
    };
  });

  const caption =
    status === "recording"
      ? "Dictée en cours"
      : status === "transcribing"
        ? "Traitement…"
        : hasRun && lastAt
          ? `Dernière dictée ${formatRelative(lastAt, now)}`
          : hasRun
            ? "Dernière dictée"
            : "Prête à l'emploi";

  return (
    <section className="card pipeline" aria-label="Chaîne de dictée">
      <header className="pipeline__head">
        <h2 className="caption">Chaîne de dictée</h2>
        <span className="pipeline__caption">{caption}</span>
      </header>
      <ol className="pipeline__track">
        {stations.map((s, index) => (
          <li
            key={s.id}
            className={`station station--${s.tone}`}
            aria-label={`${s.label} : ${s.detail}`}
          >
            {index > 0 && (
              <span className="station__link" aria-hidden="true">
                <i />
              </span>
            )}
            <span className="station__node" aria-hidden="true">
              <s.Icon />
            </span>
            <span className="station__label">{s.label}</span>
            <span className="station__detail num">{s.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
