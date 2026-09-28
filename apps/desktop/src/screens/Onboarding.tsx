import { useEffect, useState } from "react";
import type { EngineCheck } from "@asas-voice/shared";
import { KeyField } from "../components/KeyField";
import { Orb } from "../components/Orb";
import { Pipeline } from "../components/Pipeline";
import { ShortcutField } from "../components/ShortcutField";
import { Segmented } from "../components/controls";
import { CheckIcon, KeyIcon, MicIcon } from "../components/icons";
import { VuMeter } from "../components/VuMeter";
import { prettyShortcut } from "../lib/shortcut";
import { useMicrophones } from "../lib/useMicrophones";
import { useReadiness } from "../lib/useReadiness";
import { useVuMeter } from "../lib/useVuMeter";
import { useRecording } from "../store/recording";
import { useSettings } from "../store/settings";
import { refreshMicState, useSystem } from "../store/system";

const STEPS = ["welcome", "key", "mic", "shortcut", "test"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  welcome: "Bienvenue",
  key: "Clé",
  mic: "Micro",
  shortcut: "Raccourci",
  test: "Essai",
};

/**
 * Onboarding 1er lancement : d'« app installée » à « première dictée réussie » sans
 * fichier .env ni terminal. Rendu À LA PLACE de la coque tant que `onboardingComplete`
 * est faux.
 */
export function Onboarding() {
  const [index, setIndex] = useState(0);
  const step = STEPS[index] ?? "welcome";
  const setOnboardingComplete = useSettings((s) => s.setOnboardingComplete);
  const settings = useSettings();

  // ---- Clé ----
  const health = useSystem((s) => s.health);
  const storedCheck = useSystem((s) => s.checks.transcription);
  const [keyCheck, setKeyCheck] = useState<EngineCheck | null>(null);
  const check = keyCheck ?? storedCheck ?? null;
  // On peut avancer si Mistral a accepté la clé — ou si elle est enregistrée mais que la
  // vérification n'a pas pu joindre Mistral (réseau) : l'essai final tranchera.
  const keyOk =
    check?.status === "ok" || (Boolean(health?.ready) && check?.status === "unreachable");

  // ---- Micro ----
  const { devices, permission, requestAccess, refresh } = useMicrophones();
  const micLevel = useVuMeter(settings.selectedMicId, step === "mic");

  // ---- Essai ----
  const recStatus = useRecording((s) => s.status);
  const lastResult = useRecording((s) => s.lastResult);
  const lastError = useRecording((s) => s.lastError);
  const readiness = useReadiness();

  useEffect(() => {
    if (step === "mic") void refreshMicState();
  }, [step, permission]);

  const canNext = step === "key" ? keyOk : step === "mic" ? permission === "granted" : true;
  const isLast = index === STEPS.length - 1;
  const next = (): void => setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const back = (): void => setIndex((i) => Math.max(i - 1, 0));
  const key = <kbd className="kbd">{prettyShortcut(settings.pushToTalkShortcut)}</kbd>;

  return (
    <div className="onboarding">
      <ol className="steps" aria-label="Progression">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`steps__item ${i === index ? "is-active" : ""} ${i < index ? "is-done" : ""}`}
            aria-current={i === index ? "step" : undefined}
          >
            <span className="steps__dot num">{i < index ? <CheckIcon /> : i + 1}</span>
            <span className="steps__label">{STEP_LABELS[s]}</span>
          </li>
        ))}
      </ol>

      <div className="onboarding__body" key={step}>
        {step === "welcome" && (
          <div className="panel panel--center">
            <Orb size={200} className="orb-canvas" />
            <h1 className="panel__title">Votre voix, écrite partout.</h1>
            <p className="panel__lede">
              Maintenez un raccourci, parlez, relâchez : le texte s'écrit là où se trouve votre
              curseur, dans n'importe quelle application. Trois réglages et c'est prêt.
            </p>
          </div>
        )}

        {step === "key" && (
          <div className="panel">
            <span className="panel__icon" aria-hidden="true">
              <KeyIcon />
            </span>
            <h1 className="panel__title">Votre clé de transcription</h1>
            <p className="panel__lede">
              Asas Voice transcrit avec Voxtral, le modèle de Mistral. Collez votre clé API : elle
              est rangée dans le coffre de Windows, jamais en clair sur le disque, puis vérifiée
              auprès de Mistral.
            </p>
            <KeyField
              engine="transcription"
              hasKey={health?.ready ?? null}
              onVerified={setKeyCheck}
              autoFocus
            />
            {check?.status === "ok" && (
              <p className="fieldmsg fieldmsg--ok">
                <CheckIcon /> Clé acceptée par Mistral — la transcription est prête.
              </p>
            )}
            {check?.status === "unreachable" && health?.ready && (
              <p className="fieldmsg fieldmsg--warn">
                Clé enregistrée, mais Mistral est injoignable pour la vérifier. Vous pourrez
                continuer ; l'essai final confirmera.
              </p>
            )}
          </div>
        )}

        {step === "mic" && (
          <div className="panel">
            <span className="panel__icon" aria-hidden="true">
              <MicIcon />
            </span>
            <h1 className="panel__title">Votre micro</h1>
            <p className="panel__lede">
              Autorisez l'accès, choisissez l'entrée, puis parlez : la jauge doit bouger.
            </p>
            {permission === "denied" && (
              <p className="fieldmsg fieldmsg--error">
                Windows bloque le micro. Paramètres › Confidentialité › Microphone : autorisez les
                applications de bureau, puis cliquez sur « Rafraîchir ».
              </p>
            )}
            <select
              className="select"
              value={settings.selectedMicId ?? ""}
              onChange={(e) => settings.setSelectedMic(e.currentTarget.value || null)}
              aria-label="Micro utilisé"
            >
              <option value="">Micro par défaut de Windows</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <div className="panel__row">
              {permission !== "granted" ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void requestAccess()}
                >
                  Autoriser le micro
                </button>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={() => void refresh()}>
                  Rafraîchir
                </button>
              )}
            </div>
            <VuMeter level={micLevel} active={step === "mic" && permission === "granted"} />
          </div>
        )}

        {step === "shortcut" && (
          <div className="panel">
            <h1 className="panel__title">Votre raccourci</h1>
            <p className="panel__lede">
              Il fonctionne partout. Cliquez dessus pour en choisir un autre.
            </p>
            <ShortcutField />
            <Segmented
              ariaLabel="Comportement du raccourci"
              value={settings.dictationMode}
              onChange={settings.setDictationMode}
              options={[
                { value: "hold", label: "Maintenir pour parler" },
                { value: "toggle", label: "Appuyer pour démarrer / arrêter" },
              ]}
            />
          </div>
        )}

        {step === "test" && (
          <div className="panel panel--center panel--wide">
            <Orb size={170} className="orb-canvas" />
            <h1 className="panel__title">Essayez maintenant</h1>
            <p className="panel__lede">
              {settings.dictationMode === "hold" ? (
                <>Maintenez {key}, dites une phrase, puis relâchez.</>
              ) : (
                <>Appuyez sur {key}, dites une phrase, puis appuyez de nouveau.</>
              )}
            </p>
            <Pipeline readiness={readiness} />
            {lastResult && recStatus !== "error" && (
              <p className="result selectable">« {lastResult.text} »</p>
            )}
            {recStatus === "error" && lastError && (
              <p className="fieldmsg fieldmsg--error">{lastError}</p>
            )}
          </div>
        )}
      </div>

      <div className="onboarding__nav">
        <button type="button" className="btn btn--quiet" onClick={back} disabled={index === 0}>
          Retour
        </button>
        {isLast ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setOnboardingComplete(true)}
          >
            {lastResult ? "Commencer à dicter" : "Terminer sans essai"}
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={next} disabled={!canNext}>
            Continuer
          </button>
        )}
      </div>
    </div>
  );
}
