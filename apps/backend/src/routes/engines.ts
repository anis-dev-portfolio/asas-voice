/**
 * Routes « moteurs » : décrire ce qui tourne réellement et le VÉRIFIER auprès du
 * fournisseur, pour que l'UI n'affiche jamais un état deviné.
 *
 *  - GET  /engines         → description statique (modèle exact, clé présente ou non).
 *  - POST /engines/verify  → vérification réelle, GRATUITE : on demande au fournisseur la
 *    fiche du modèle (`models.retrieve`). Ni transcription ni génération : aucun coût.
 *    Une clé refusée, un modèle inaccessible ou un réseau coupé sont distingués.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { FastifyInstance } from "fastify";
import type {
  ApiError,
  EngineCheck,
  EngineCheckStatus,
  EngineId,
  EnginesResponse,
  VerifyResponse,
} from "@asas-voice/shared";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "@asas-voice/shared";
import type { BackendEnv } from "../env";
import { mistralClient } from "../stt";
import { getProp } from "../upstream";
import { anthropicClient, CORRECTION_MODEL } from "./postprocess";

/** Délai max d'une vérification (par fournisseur). */
const VERIFY_TIMEOUT_MS = 8_000;

/** Noms affichés (le modèle exact est toujours montré à côté). */
const TRANSCRIPTION_NAME = "Voxtral Mini Transcribe";
const CORRECTION_NAME = "Claude Haiku 4.5";

interface Verdict {
  status: EngineCheckStatus;
  message: string;
}

const MESSAGES: Record<EngineId, Record<Exclude<EngineCheckStatus, "error">, string>> = {
  transcription: {
    ok: "Clé acceptée par Mistral, modèle accessible.",
    missing_key: "Aucune clé Mistral enregistrée.",
    invalid_key: "Mistral refuse cette clé. Vérifiez-la ou collez-en une nouvelle.",
    model_unavailable: "La clé est valide mais ce modèle n'est pas accessible avec ce compte.",
    rate_limited: "Quota Mistral momentanément atteint. Réessayez dans un instant.",
    unreachable: "Mistral est injoignable (connexion Internet ?).",
  },
  correction: {
    ok: "Clé acceptée par Anthropic, modèle accessible.",
    missing_key: "Aucune clé Anthropic enregistrée.",
    invalid_key: "Anthropic refuse cette clé. Vérifiez-la ou collez-en une nouvelle.",
    model_unavailable: "La clé est valide mais ce modèle n'est pas accessible avec ce compte.",
    rate_limited: "Quota Anthropic momentanément atteint. Réessayez dans un instant.",
    unreachable: "Anthropic est injoignable (connexion Internet ?).",
  },
};

function verdict(id: EngineId, status: EngineCheckStatus, detail?: string): Verdict {
  if (status === "error") {
    return { status, message: `Réponse inattendue du fournisseur${detail ? ` (${detail})` : ""}.` };
  }
  return { status, message: MESSAGES[id][status] };
}

/** Classe une erreur du SDK Mistral en verdict de vérification. */
export function classifyMistralError(err: unknown): Verdict {
  const name = err instanceof Error ? err.name : "";
  if (
    name === "ConnectionError" ||
    name === "RequestTimeoutError" ||
    name === "RequestAbortedError" ||
    name === "TimeoutError" ||
    name === "AbortError"
  ) {
    return verdict("transcription", "unreachable");
  }
  const status = getProp(err, "statusCode");
  if (status === 401 || status === 403) return verdict("transcription", "invalid_key");
  if (status === 404) return verdict("transcription", "model_unavailable");
  if (status === 429) return verdict("transcription", "rate_limited");
  return verdict("transcription", "error", typeof status === "number" ? `HTTP ${status}` : name);
}

/** Classe une erreur du SDK Anthropic en verdict de vérification (du plus précis au plus large). */
export function classifyAnthropicError(err: unknown): Verdict {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return verdict("correction", "unreachable");
  }
  if (err instanceof Anthropic.APIConnectionError) return verdict("correction", "unreachable");
  if (err instanceof Anthropic.AuthenticationError) return verdict("correction", "invalid_key");
  if (err instanceof Anthropic.PermissionDeniedError) return verdict("correction", "invalid_key");
  if (err instanceof Anthropic.NotFoundError) return verdict("correction", "model_unavailable");
  if (err instanceof Anthropic.RateLimitError) return verdict("correction", "rate_limited");
  if (err instanceof Anthropic.APIError) {
    return verdict("correction", "error", `HTTP ${err.status ?? "inconnu"}`);
  }
  return verdict("correction", "error", err instanceof Error ? err.name : undefined);
}

function check(id: EngineId, v: Verdict, extra: Partial<EngineCheck> = {}): EngineCheck {
  return { id, status: v.status, message: v.message, checkedAt: Date.now(), ...extra };
}

/** Vérifie la clé Mistral + l'accès au modèle de transcription. */
export async function verifyTranscription(env: BackendEnv): Promise<EngineCheck> {
  if (!env.mistralApiKey) return check("transcription", verdict("transcription", "missing_key"));
  const started = performance.now();
  try {
    const card = await mistralClient(env.mistralApiKey).models.retrieve(
      { modelId: env.transcriptionModel },
      { timeoutMs: VERIFY_TIMEOUT_MS, retries: { strategy: "none" } },
    );
    const id = getProp(card, "id");
    return check("transcription", verdict("transcription", "ok"), {
      latencyMs: Math.round(performance.now() - started),
      resolvedModel: typeof id === "string" ? id : env.transcriptionModel,
    });
  } catch (err) {
    return check("transcription", classifyMistralError(err), {
      latencyMs: Math.round(performance.now() - started),
    });
  }
}

/** Vérifie la clé Anthropic + l'accès au modèle de correction. */
export async function verifyCorrection(env: BackendEnv): Promise<EngineCheck> {
  if (!env.anthropicApiKey) return check("correction", verdict("correction", "missing_key"));
  const started = performance.now();
  try {
    const info = await anthropicClient(env.anthropicApiKey).models.retrieve(
      CORRECTION_MODEL,
      null,
      {
        timeout: VERIFY_TIMEOUT_MS,
        maxRetries: 0,
      },
    );
    return check("correction", verdict("correction", "ok"), {
      latencyMs: Math.round(performance.now() - started),
      resolvedModel: info.id,
    });
  } catch (err) {
    return check("correction", classifyAnthropicError(err), {
      latencyMs: Math.round(performance.now() - started),
    });
  }
}

/** Description statique des moteurs (aucun appel réseau). */
export function describeEngines(env: BackendEnv): EnginesResponse {
  return {
    transcription: {
      id: "transcription",
      name: TRANSCRIPTION_NAME,
      provider: "Mistral AI",
      model: env.transcriptionModel,
      configured: Boolean(env.mistralApiKey),
    },
    correction: {
      id: "correction",
      name: CORRECTION_NAME,
      provider: "Anthropic",
      model: CORRECTION_MODEL,
      configured: Boolean(env.anthropicApiKey),
    },
  };
}

function parseTargets(body: unknown): EngineId[] {
  const raw = getProp(body, "engines");
  if (!Array.isArray(raw)) return ["transcription", "correction"];
  const wanted = raw.filter((e): e is EngineId => e === "transcription" || e === "correction");
  return wanted.length > 0 ? [...new Set(wanted)] : ["transcription", "correction"];
}

export async function engineRoutes(app: FastifyInstance, env: BackendEnv): Promise<void> {
  // Lecture pure et fréquente : pas de log par requête.
  app.get("/engines", { logLevel: "warn" }, async (): Promise<EnginesResponse> => {
    return describeEngines(env);
  });

  app.post("/engines/verify", async (request, reply) => {
    // Même garde que les autres POST : bloque le déclenchement cross-origin.
    if (request.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) {
      const body: ApiError = {
        error: { code: "forbidden", message: "Requête refusée : client non autorisé." },
      };
      return reply.code(403).send(body);
    }
    const targets = parseTargets(request.body);
    const [transcription, correction] = await Promise.all([
      targets.includes("transcription") ? verifyTranscription(env) : undefined,
      targets.includes("correction") ? verifyCorrection(env) : undefined,
    ]);
    const result: VerifyResponse = {
      ...(transcription ? { transcription } : {}),
      ...(correction ? { correction } : {}),
    };
    request.log.info(
      { transcription: transcription?.status, correction: correction?.status },
      "Vérification des moteurs",
    );
    return reply.code(200).send(result);
  });
}
