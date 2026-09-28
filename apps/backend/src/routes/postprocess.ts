import Anthropic from "@anthropic-ai/sdk";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiError, ApiErrorCode } from "@asas-voice/shared";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "@asas-voice/shared";
import type { BackendEnv } from "../env";
import { extractRetryAfter } from "../upstream";

/**
 * Modèle de correction : tâche simple (orthographe/grammaire/ponctuation d'un texte
 * dicté), appelée sur le CHEMIN CRITIQUE de la dictée (avant le collage) et sur la clé
 * BYOK de l'utilisateur → on privilégie la latence et le coût : Haiku, le modèle le plus
 * rapide et économique pour les tâches simples.
 */
export const CORRECTION_MODEL = "claude-haiku-4-5";

/** Timeout de l'appel Anthropic (ms). Haiku répond en ~1-3 s ; 15 s laisse une marge. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Borne de taille du texte d'entrée (caractères). La sortie est plafonnée à 2048 tokens ;
 * au-delà de ~8000 caractères en entrée la correction serait de toute façon tronquée, et
 * ça protège d'un abus. Un texte plus long est rejeté proprement (413).
 */
const MAX_INPUT_CHARS = 8000;

// Prompt système : reformule et améliore le texte dicté sans en changer le sens.
const SYSTEM_PROMPT =
  "Tu es un assistant de dictée vocale. L'utilisateur te transmet un texte brut issu d'une reconnaissance vocale. " +
  "Corrige les fautes d'orthographe et de grammaire, améliore la ponctuation et la mise en forme. " +
  "Conserve intégralement le sens et le style. Retourne uniquement le texte corrigé, sans commentaire ni explication.";

function apiError(code: ApiErrorCode, message: string, retryAfterSec?: number): ApiError {
  return {
    error: { code, message, ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) },
  };
}

let cachedClient: { apiKey: string; client: Anthropic } | undefined;

/** Client Anthropic réutilisé tant que la clé ne change pas (partagé avec la vérification). */
export function anthropicClient(apiKey: string): Anthropic {
  if (!cachedClient || cachedClient.apiKey !== apiKey) {
    cachedClient = { apiKey, client: new Anthropic({ apiKey }) };
  }
  return cachedClient.client;
}

/** Mappe une erreur d'appel Anthropic vers une réponse HTTP normalisée (ApiError). */
export function handlePostprocessError(
  request: FastifyRequest,
  reply: FastifyReply,
  err: unknown,
): FastifyReply {
  // Timeout / connexion : pas de réponse HTTP upstream (err.status indéfini) → on les
  // teste AVANT le cas générique APIError (dont ils héritent).
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    request.log.error({ err }, "Timeout Anthropic");
    return reply
      .code(504)
      .send(
        apiError(
          "upstream_timeout",
          "Le post-traitement a expiré (Claude trop lent ou indisponible).",
        ),
      );
  }
  if (err instanceof Anthropic.APIConnectionError) {
    request.log.error({ err }, "Connexion Anthropic impossible");
    return reply
      .code(502)
      .send(apiError("upstream_error", "Impossible de joindre le service de post-traitement."));
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status;

    if (status === 401 || status === 403) {
      request.log.error({ err, status }, "Clé Anthropic invalide");
      return reply
        .code(502)
        .send(apiError("invalid_api_key", "Clé Anthropic refusée. Vérifiez-la dans Moteurs."));
    }

    // Quota dépassé : réponse dédiée + Retry-After (si fourni) pour que l'UI temporise.
    if (status === 429) {
      const retryAfterSec = extractRetryAfter(err);
      request.log.warn({ err, status, retryAfterSec }, "Quota Anthropic dépassé (429)");
      if (retryAfterSec !== undefined) reply.header("Retry-After", String(retryAfterSec));
      return reply
        .code(429)
        .send(
          apiError(
            "rate_limited",
            "Quota de post-traitement atteint. Patientez un instant avant de réessayer.",
            retryAfterSec,
          ),
        );
    }

    request.log.error({ err, status }, "Erreur upstream Anthropic");
    return reply
      .code(502)
      .send(
        apiError(
          "upstream_error",
          `Erreur du service de post-traitement (HTTP ${status ?? "inconnu"}).`,
        ),
      );
  }

  request.log.error({ err }, "Erreur interne de post-traitement");
  return reply
    .code(500)
    .send(apiError("internal_error", "Erreur interne lors du post-traitement."));
}

export async function postprocessRoutes(app: FastifyInstance, env: BackendEnv): Promise<void> {
  app.post<{ Body: { text?: string } }>("/postprocess", async (request, reply) => {
    // 0) En-tête custom EXIGÉ, valeur comprise (aligné sur /transcribe) : bloque le
    // déclenchement cross-origin, pas seulement la lecture de la réponse.
    if (request.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) {
      return reply.code(403).send(apiError("forbidden", "Requête refusée : client non autorisé."));
    }

    // 1) Clé Anthropic configurée côté serveur ?
    if (!env.anthropicApiKey) {
      return reply
        .code(503)
        .send(apiError("no_anthropic_key", "Clé API Anthropic non configurée."));
    }

    // 2) Texte présent et borné.
    const text = request.body?.text?.trim();
    if (!text) {
      return reply.code(400).send(apiError("missing_text", "Champ text requis."));
    }
    if (text.length > MAX_INPUT_CHARS) {
      return reply
        .code(413)
        .send(
          apiError(
            "text_too_long",
            `Texte trop long pour le post-traitement (max ${MAX_INPUT_CHARS} caractères).`,
          ),
        );
    }

    // 3) Appel Claude, borné en temps et en réessais (chemin critique de la dictée).
    try {
      const client = anthropicClient(env.anthropicApiKey);
      const message = await client.messages.create(
        {
          model: CORRECTION_MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        },
        { timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 },
      );

      const first = message.content[0];
      const improved = first?.type === "text" ? first.text.trim() : text;
      return reply.code(200).send({ text: improved });
    } catch (err) {
      return handlePostprocessError(request, reply, err);
    }
  });
}
