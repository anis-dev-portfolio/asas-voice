import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { EngineCheck, EngineId } from "@asas-voice/shared";
import {
  clearAnthropicKey,
  clearApiKey,
  setAnthropicKey,
  setApiKey,
  waitForBackendKey,
} from "../lib/config";
import { useSettings } from "../store/settings";
import { useSystem } from "../store/system";
import { toast } from "../store/toast";
import { ExternalIcon, EyeIcon, EyeOffIcon } from "./icons";

const PROVIDER: Record<
  EngineId,
  { name: string; which: "mistral" | "anthropic"; url: string; placeholder: string }
> = {
  transcription: {
    name: "Mistral",
    which: "mistral",
    url: "https://console.mistral.ai/api-keys",
    placeholder: "Collez votre clé API Mistral",
  },
  correction: {
    name: "Anthropic",
    which: "anthropic",
    url: "https://console.anthropic.com/settings/keys",
    placeholder: "Collez votre clé API Anthropic",
  },
};

interface KeyFieldProps {
  engine: EngineId;
  /** Une clé est déjà enregistrée (null = inconnu). */
  hasKey: boolean | null;
  /** Appelé après enregistrement + vérification (check null = vérification impossible). */
  onVerified?: (check: EngineCheck | null) => void;
  /** Proposer d'effacer la clé enregistrée. */
  allowClear?: boolean;
  autoFocus?: boolean;
}

type Phase = "idle" | "saving" | "verifying" | "clearing";

/**
 * Saisie d'une clé API : rangée dans le coffre Windows, puis VÉRIFIÉE auprès du
 * fournisseur (appel gratuit). Le verdict affiché est celui du fournisseur, pas une
 * supposition.
 */
export function KeyField({ engine, hasKey, onVerified, allowClear, autoFocus }: KeyFieldProps) {
  const provider = PROVIDER[engine];
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const key = value.trim();
    if (!key || phase !== "idle") return;
    setPhase("saving");
    setError(null);
    try {
      if (engine === "transcription") await setApiKey(key);
      else await setAnthropicKey(key);
      // Le service redémarre avec la nouvelle clé : on attend qu'il la confirme.
      const loaded = await waitForBackendKey(12_000, provider.which);
      if (!loaded) {
        setError(
          "Clé enregistrée, mais le service n'a pas redémarré à temps. Réessayez la vérification.",
        );
        onVerified?.(null);
        return;
      }
      setPhase("verifying");
      const system = useSystem.getState();
      await system.refresh();
      await system.verify([engine]);
      const check = useSystem.getState().checks[engine] ?? null;
      setValue("");
      if (check?.status === "ok") {
        toast(`Clé ${provider.name} vérifiée`);
      } else if (check) {
        setError(check.message);
      } else {
        setError("Clé enregistrée, mais la vérification n'a pas pu aboutir.");
      }
      onVerified?.(check);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'enregistrement de la clé.");
    } finally {
      setPhase("idle");
    }
  }

  async function clear(): Promise<void> {
    setPhase("clearing");
    setError(null);
    try {
      if (engine === "transcription") {
        await clearApiKey();
      } else {
        await clearAnthropicKey();
        // Sans clé, la correction ne peut plus tourner : on la coupe plutôt que la laisser échouer.
        useSettings.getState().setClaudePostProcess(false);
      }
      await useSystem.getState().refresh();
      toast(`Clé ${provider.name} effacée`, "info");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la suppression de la clé.");
    } finally {
      setPhase("idle");
    }
  }

  const busyLabel =
    phase === "saving" ? "Enregistrement…" : phase === "verifying" ? "Vérification…" : null;

  return (
    <div className="keyfield">
      <form
        className="keyfield__row"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="inputwrap">
          <input
            className="textinput textinput--mono"
            type={reveal ? "text" : "password"}
            placeholder={hasKey ? `Nouvelle clé ${provider.name}` : provider.placeholder}
            value={value}
            spellCheck={false}
            autoComplete="off"
            autoFocus={autoFocus}
            aria-label={`Clé API ${provider.name}`}
            onChange={(e) => {
              setValue(e.currentTarget.value);
              setError(null);
            }}
          />
          <button
            type="button"
            className="inputwrap__btn"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? "Masquer la clé" : "Afficher la clé"}
            title={reveal ? "Masquer" : "Afficher"}
          >
            {reveal ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!value.trim() || phase !== "idle"}
        >
          {busyLabel ?? (hasKey ? "Remplacer" : "Enregistrer")}
        </button>
      </form>
      {error && (
        <p className="fieldmsg fieldmsg--error" role="alert">
          {error}
        </p>
      )}
      <div className="keyfield__links">
        <button
          type="button"
          className="linkbtn"
          onClick={() => void openUrl(provider.url).catch(() => undefined)}
        >
          Obtenir une clé {provider.name}
          <ExternalIcon />
        </button>
        {allowClear && hasKey && (
          <button
            type="button"
            className="linkbtn linkbtn--danger"
            disabled={phase !== "idle"}
            onClick={() => void clear()}
          >
            {phase === "clearing" ? "Suppression…" : "Effacer la clé"}
          </button>
        )}
      </div>
    </div>
  );
}
