import { HealthCallout } from "../components/HealthCallout";
import { Orb } from "../components/Orb";
import { Pipeline } from "../components/Pipeline";
import { CopyIcon } from "../components/icons";
import type { DictationControls } from "../lib/useDictation";
import { countWords, formatSeconds, formatTime, formatWords } from "../lib/format";
import { prettyShortcut } from "../lib/shortcut";
import { copyText } from "../lib/paste";
import { useReadiness } from "../lib/useReadiness";
import { useRecording } from "../store/recording";
import { useSettings } from "../store/settings";
import { toast } from "../store/toast";

const STATUS_TITLE = {
  idle: "Prête à écrire",
  recording: "À l'écoute",
  transcribing: "Transcription",
  error: "La dictée a échoué",
} as const;

/** Une dictée plus récente que ça s'affiche avec l'encre violette (comme au curseur). */
const FRESH_MS = 4000;

interface DictationScreenProps {
  controls: DictationControls;
}

/** Suite de touches d'un raccourci, en capuchons de clavier. */
function Keys({ shortcut }: { shortcut: string }) {
  return (
    <span className="keys">
      {prettyShortcut(shortcut)
        .split(" + ")
        .map((k) => (
          <kbd key={k} className="kbd">
            {k}
          </kbd>
        ))}
    </span>
  );
}

/** Écran d'accueil : l'orbe-instrument, le statut, la chaîne de dictée, la dernière dictée. */
export function DictationScreen({ controls }: DictationScreenProps) {
  const status = useRecording((s) => s.status);
  const lastResult = useRecording((s) => s.lastResult);
  const lastError = useRecording((s) => s.lastError);
  const lastAt = useRecording((s) => s.lastAt);
  const notice = useRecording((s) => s.notice);
  const shortcutOk = useRecording((s) => s.shortcutOk);
  const shortcut = useSettings((s) => s.pushToTalkShortcut);
  const mode = useSettings((s) => s.dictationMode);
  const readiness = useReadiness();

  const recording = status === "recording";
  const key = <Keys shortcut={shortcut} />;
  const fresh = lastAt !== null && Date.now() - lastAt < FRESH_MS;

  let hint: React.ReactNode;
  if (status === "error" && lastError) {
    hint = <span className="hint--warn">{lastError}</span>;
  } else if (recording) {
    hint =
      mode === "hold" ? (
        <>Relâchez {key} pour terminer</>
      ) : (
        <>Appuyez de nouveau sur {key} ou touchez l'orbe pour terminer</>
      );
  } else if (status === "transcribing") {
    hint = "Le texte arrive…";
  } else if (!shortcutOk) {
    hint = (
      <span className="hint--warn">
        {key} est déjà pris par une autre application — changez-le dans Réglages.
      </span>
    );
  } else {
    hint =
      mode === "hold" ? (
        <>Maintenez {key}, parlez, relâchez — ou touchez l'orbe</>
      ) : (
        <>Appuyez sur {key} pour commencer, encore pour finir — ou touchez l'orbe</>
      );
  }

  const copyLast = (): void => {
    if (!lastResult) return;
    void copyText(lastResult.text)
      .then(() => toast("Copié dans le presse-papier"))
      .catch(() => toast("Impossible de copier", "warn"));
  };

  return (
    <div className="screen screen--dictation">
      <section className={`hero is-${status}`} aria-label="Dictée">
        <div className="hero__light" aria-hidden="true" />
        <button
          type="button"
          className="hero__orb"
          onClick={() => controls.toggle("app")}
          disabled={status === "transcribing"}
          aria-label={recording ? "Terminer la dictée" : "Démarrer une dictée"}
          title={recording ? "Terminer la dictée" : "Démarrer une dictée (texte copié)"}
        >
          <Orb size={248} className="orb-canvas" />
        </button>

        <h1 key={status} className={`hero__status status--${status}`} aria-live="polite">
          {STATUS_TITLE[status]}
          {(status === "recording" || status === "transcribing") && (
            <span className="hero__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </h1>
        <p className="hero__hint">{hint}</p>
        {notice && status !== "error" && <p className="hero__notice">{notice}</p>}
      </section>

      {status === "idle" && <HealthCallout readiness={readiness} />}

      <Pipeline readiness={readiness} />

      <section className="card lastcard" aria-label="Dernière dictée">
        <header className="lastcard__head">
          <h2 className="caption">Dernière dictée</h2>
          {lastResult && (
            <div className="lastcard__meta">
              <span className="meta num">
                {lastAt ? `${formatTime(lastAt)} · ` : ""}
                {formatSeconds(lastResult.durationSec)} · {formatWords(countWords(lastResult.text))}
              </span>
              <button
                type="button"
                className="iconbtn"
                aria-label="Copier le texte"
                title="Copier"
                onClick={copyLast}
              >
                <CopyIcon />
              </button>
            </div>
          )}
        </header>
        {lastResult ? (
          <p key={lastAt ?? 0} className="lastcard__text selectable">
            <span className={fresh ? "ink is-fresh" : "ink"}>{lastResult.text}</span>
          </p>
        ) : (
          <p className="lastcard__empty">
            Votre première dictée apparaîtra ici. {mode === "hold" ? "Maintenez" : "Appuyez sur"}{" "}
            {key} et dites « Bonjour, ceci est un essai ».
          </p>
        )}
      </section>
    </div>
  );
}
