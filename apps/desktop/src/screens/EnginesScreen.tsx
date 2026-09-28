import type { ComponentType, ReactNode, SVGProps } from "react";
import type { EngineCheck, EngineId } from "@asas-voice/shared";
import { KeyField } from "../components/KeyField";
import { Switch, Tile, type TileTone } from "../components/controls";
import {
  ChevronRightIcon,
  HardDriveIcon,
  RefreshIcon,
  ShieldIcon,
  SparkIcon,
  WaveIcon,
} from "../components/icons";
import { formatDuration, formatRelative } from "../lib/format";
import { useNow } from "../lib/useNow";
import { useSettings } from "../store/settings";
import { useSystem } from "../store/system";
import { toast } from "../store/toast";
import { useUi } from "../store/ui";

type BadgeTone = "ok" | "warn" | "error" | "idle" | "off";

interface Badge {
  tone: BadgeTone;
  label: string;
}

/** Verdict affiché pour un moteur, déduit UNIQUEMENT de sondes réelles. */
function badgeFor(
  id: EngineId,
  serviceUp: boolean,
  configured: boolean | null,
  check: EngineCheck | undefined,
  verifying: boolean,
): Badge {
  if (!serviceUp) return { tone: "error", label: "Service arrêté" };
  if (verifying) return { tone: "idle", label: "Vérification…" };
  if (configured === false || check?.status === "missing_key") {
    return id === "transcription"
      ? { tone: "error", label: "Clé manquante" }
      : { tone: "off", label: "Non configurée" };
  }
  switch (check?.status) {
    case "ok":
      return { tone: "ok", label: "Opérationnel" };
    case "invalid_key":
      return { tone: "error", label: "Clé refusée" };
    case "model_unavailable":
      return { tone: "error", label: "Modèle inaccessible" };
    case "rate_limited":
      return { tone: "warn", label: "Quota atteint" };
    case "unreachable":
      return { tone: "warn", label: "Hors ligne" };
    case "error":
      return { tone: "warn", label: "À revérifier" };
    default:
      return { tone: "idle", label: "Non vérifiée" };
  }
}

interface EngineCardProps {
  id: EngineId;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: TileTone;
  kicker: string;
  name: string;
  provider: string;
  model: string;
  children?: ReactNode;
}

function EngineCard({ id, Icon, tone, kicker, name, provider, model, children }: EngineCardProps) {
  const service = useSystem((s) => s.service);
  const health = useSystem((s) => s.health);
  const check = useSystem((s) => s.checks[id]);
  const verifying = useSystem((s) => Boolean(s.verifying[id]));
  const verify = useSystem((s) => s.verify);
  const now = useNow();

  const serviceUp = service === "up";
  const configured = health
    ? id === "transcription"
      ? health.ready
      : health.hasAnthropicKey
    : null;
  const badge = badgeFor(id, serviceUp, configured, check, verifying);
  const resolved =
    check?.resolvedModel && check.resolvedModel !== model ? check.resolvedModel : null;

  const onVerify = async (): Promise<void> => {
    await verify([id]);
    const result = useSystem.getState().checks[id];
    if (result?.status === "ok") toast(`${name} : opérationnel`);
    else if (result) toast(result.message, "warn");
    else toast("Vérification impossible : le service local ne répond pas.", "warn");
  };

  return (
    <section className={`card engine engine--${badge.tone}`} aria-label={`${kicker} — ${name}`}>
      <div className="engine__head">
        <Tile Icon={Icon} tone={tone} size="md" />
        <div className="engine__id">
          <span className="caption">{kicker}</span>
          <h2 className="engine__name">{name}</h2>
          <span className="engine__provider">
            {provider} · <code className="mono">{model}</code>
            {resolved && (
              <>
                {" "}
                → <code className="mono">{resolved}</code>
              </>
            )}
          </span>
        </div>
        <span className={`badge badge--${badge.tone}`}>
          <span className="badge__dot" aria-hidden="true" />
          {badge.label}
        </span>
      </div>

      <dl className="facts">
        <div className="facts__row">
          <dt>Clé API</dt>
          <dd>
            {configured === null ? (
              "—"
            ) : configured ? (
              <span className="facts__vault">
                <ShieldIcon />
                Rangée dans le coffre Windows
              </span>
            ) : (
              "Aucune clé enregistrée"
            )}
          </dd>
        </div>
        <div className="facts__row">
          <dt>Dernier contrôle</dt>
          <dd className="num">
            {check && check.status !== "missing_key"
              ? `${formatRelative(check.checkedAt, now)}${check.latencyMs !== undefined ? ` · réponse en ${formatDuration(check.latencyMs)}` : ""}`
              : "—"}
          </dd>
        </div>
        {check && check.status !== "ok" && check.status !== "missing_key" && (
          <div className="facts__row facts__row--msg">
            <dt>Détail</dt>
            <dd>{check.message}</dd>
          </div>
        )}
      </dl>

      {children}

      <div className="engine__foot">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!serviceUp || !configured || verifying}
          onClick={() => void onVerify()}
        >
          <RefreshIcon className={verifying ? "spin" : undefined} />
          {verifying ? "Vérification…" : "Vérifier maintenant"}
        </button>
      </div>
    </section>
  );
}

/** Écran Moteurs : ce qui transforme votre voix en texte, et la preuve que ça marche. */
export function EnginesScreen() {
  const engines = useSystem((s) => s.engines);
  const health = useSystem((s) => s.health);
  const claudePostProcess = useSettings((s) => s.claudePostProcess);
  const setClaudePostProcess = useSettings((s) => s.setClaudePostProcess);
  const voiceCommands = useSettings((s) => s.voiceCommands);
  const autoFormat = useSettings((s) => s.autoFormat);
  const vocabulary = useSettings((s) => s.vocabulary);
  const setScreen = useUi((s) => s.setScreen);

  const hasMistral = health ? health.ready : null;
  const hasAnthropic = health ? health.hasAnthropicKey : null;

  return (
    <div className="screen engines">
      <header className="screen__head">
        <div>
          <h1 className="screen__title">Moteurs</h1>
          <p className="screen__lede">
            Ce qui transforme votre voix en texte. Chaque état est vérifié auprès du fournisseur —
            gratuitement, sans rien transcrire.
          </p>
        </div>
      </header>

      <EngineCard
        id="transcription"
        Icon={WaveIcon}
        tone="violet"
        kicker="Transcription · indispensable"
        name={engines?.transcription.name ?? "Voxtral Mini Transcribe"}
        provider={engines?.transcription.provider ?? "Mistral AI"}
        model={engines?.transcription.model ?? "voxtral-mini-latest"}
      >
        <p className="engine__desc">
          Le modèle de transcription de Mistral, le plus récent. Seul l'audio de chaque dictée lui
          est envoyé ; Asas Voice ne garde que le texte, dans votre historique local.
        </p>
        <KeyField engine="transcription" hasKey={hasMistral} allowClear />
      </EngineCard>

      <EngineCard
        id="correction"
        Icon={SparkIcon}
        tone="rose"
        kicker="Correction IA · optionnelle"
        name={engines?.correction.name ?? "Claude Haiku 4.5"}
        provider={engines?.correction.provider ?? "Anthropic"}
        model={engines?.correction.model ?? "claude-haiku-4-5"}
      >
        <Switch
          checked={claudePostProcess && Boolean(hasAnthropic)}
          onChange={setClaudePostProcess}
          disabled={!hasAnthropic}
          label="Corriger chaque dictée"
          hint={
            hasAnthropic
              ? "Orthographe, grammaire et ponctuation, sans changer vos mots. Ajoute environ 1 à 2 s. Si la correction échoue, le texte brut est collé quand même."
              : "Ajoutez d'abord une clé Anthropic ci-dessous."
          }
        />
        <KeyField engine="correction" hasKey={hasAnthropic} allowClear />
      </EngineCard>

      <section className="card local" aria-label="Traitement sur ce PC">
        <div className="engine__head">
          <Tile Icon={HardDriveIcon} tone="graphite" size="md" />
          <div className="engine__id">
            <span className="caption">Sur ce PC · hors ligne</span>
            <h2 className="engine__name">Mise en forme locale</h2>
          </div>
          <button type="button" className="btn btn--quiet" onClick={() => setScreen("settings")}>
            Modifier
            <ChevronRightIcon />
          </button>
        </div>
        <ul className="local__list">
          <li>
            <span>Commandes vocales</span>
            <span className={`pill ${voiceCommands ? "pill--on" : ""}`}>
              {voiceCommands ? "Activées" : "Désactivées"}
            </span>
          </li>
          <li>
            <span>Ponctuation et majuscules automatiques</span>
            <span className={`pill ${autoFormat ? "pill--on" : ""}`}>
              {autoFormat ? "Activées" : "Désactivées"}
            </span>
          </li>
          <li>
            <span>Vocabulaire personnalisé</span>
            <span className={`pill ${vocabulary.length ? "pill--on" : ""}`}>
              {vocabulary.length
                ? `${vocabulary.length} terme${vocabulary.length > 1 ? "s" : ""}`
                : "Aucun terme"}
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
