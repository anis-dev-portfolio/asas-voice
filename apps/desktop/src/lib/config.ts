import { invoke } from "@tauri-apps/api/core";
import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  DEFAULT_BACKEND_PORT,
  type ApiError,
  type EngineId,
  type EnginesResponse,
  type VerifyResponse,
} from "@asas-voice/shared";

/**
 * Pont vers la configuration côté Rust : la clé API est stockée dans le trousseau OS
 * (Windows Credential Manager), jamais dans la webview ni en localStorage. Le renderer
 * peut seulement l'écrire et savoir SI une clé existe — jamais la relire.
 */

/** Enregistre la clé API (trousseau OS) et relance le backend embarqué avec. */
export async function setApiKey(key: string): Promise<void> {
  await invoke("set_api_key", { key });
}

/** Efface la clé API et relance le backend sans clé. */
export async function clearApiKey(): Promise<void> {
  await invoke("clear_api_key");
}

/** Vrai si une clé API est enregistrée dans le trousseau (jamais la clé elle-même). */
export function apiKeyIsSet(): Promise<boolean> {
  return invoke<boolean>("api_key_is_set");
}

/** (Re)lance le backend embarqué sans toucher aux clés (bouton « Relancer le service »). */
export async function restartBackend(): Promise<void> {
  await invoke("restart_backend");
}

const BACKEND_URL = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
const CONFIG_URL = `${BACKEND_URL}/config`;

/**
 * Demande au backend s'il a bien reçu une clé (GET /config). Sert à confirmer, après
 * `setApiKey`, que le sidecar a redémarré AVEC la clé avant de proposer le test de dictée.
 */
export async function backendHasKey(which: "mistral" | "anthropic" = "mistral"): Promise<boolean> {
  try {
    const res = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { hasKey?: boolean; hasAnthropicKey?: boolean };
    return Boolean(which === "mistral" ? data.hasKey : data.hasAnthropicKey);
  } catch {
    return false;
  }
}

/**
 * Attend que le backend confirme avoir la clé. `setApiKey` relance le sidecar : il y a une
 * fenêtre (~1-2 s) où /config est injoignable puis répond enfin `hasKey:true`. On sonde
 * jusqu'au délai imparti.
 */
export async function waitForBackendKey(
  timeoutMs: number,
  which: "mistral" | "anthropic" = "mistral",
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await backendHasKey(which)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ─── Clé Anthropic (post-traitement Claude) ─────────────────────────────────

/** Enregistre la clé Anthropic (trousseau OS) et relance le backend embarqué avec. */
export async function setAnthropicKey(key: string): Promise<void> {
  await invoke("set_anthropic_key", { key });
}

/** Efface la clé Anthropic et relance le backend sans elle. */
export async function clearAnthropicKey(): Promise<void> {
  await invoke("clear_anthropic_key");
}

/** Vrai si une clé Anthropic est enregistrée dans le trousseau (jamais la clé elle-même). */
export function anthropicKeyIsSet(): Promise<boolean> {
  return invoke<boolean>("anthropic_key_is_set");
}

/** Délai max côté client pour le post-traitement. Au-delà, on colle le texte brut. */
const POSTPROCESS_TIMEOUT_MS = 20_000;

/** Issue du post-traitement : le texte à livrer + si la correction a vraiment eu lieu. */
export interface PostprocessOutcome {
  text: string;
  applied: boolean;
  /** Raison lisible quand la correction n'a pas pu être appliquée (texte brut livré). */
  failure?: { code: string; message: string };
}

/**
 * Envoie le texte transcrit à Claude (POST /postprocess) pour correction.
 * Dégradation silencieuse pour la DICTÉE (le texte brut est livré quoi qu'il arrive), mais
 * l'échec est rapporté pour que l'UI puisse le montrer au lieu de le cacher.
 */
export async function postprocessText(text: string): Promise<PostprocessOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POSTPROCESS_TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/postprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let failure = {
        code: "upstream_error",
        message: `Correction indisponible (HTTP ${res.status}).`,
      };
      try {
        const body = (await res.json()) as ApiError;
        if (body.error) failure = { code: body.error.code, message: body.error.message };
      } catch {
        // corps non-JSON : message générique
      }
      return { text, applied: false, failure };
    }
    const data = (await res.json()) as { text?: string };
    const improved = data.text?.trim();
    return improved ? { text: improved, applied: true } : { text, applied: false };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    return {
      text,
      applied: false,
      failure: timedOut
        ? {
            code: "upstream_timeout",
            message: "La correction a expiré — texte livré sans correction.",
          }
        : {
            code: "service_unreachable",
            message: "Service local injoignable — texte livré sans correction.",
          },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Moteurs : description + vérification réelle ────────────────────────────

/** Décrit les moteurs réellement configurés (GET /engines). null si le service ne répond pas. */
export async function fetchEngines(): Promise<EnginesResponse | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/engines`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as EnginesResponse;
  } catch {
    return null;
  }
}

/**
 * Vérifie réellement les clés auprès des fournisseurs (POST /engines/verify, gratuit).
 * null si le service local ne répond pas.
 */
export async function verifyEngines(engines?: EngineId[]): Promise<VerifyResponse | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/engines/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
      body: JSON.stringify(engines ? { engines } : {}),
    });
    if (!res.ok) return null;
    return (await res.json()) as VerifyResponse;
  } catch {
    return null;
  }
}
