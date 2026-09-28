import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiError, ApiErrorCode } from "@asas-voice/shared";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, TRANSCRIPTION_LANGUAGES } from "@asas-voice/shared";
import type { BackendEnv } from "../env";
import { transcribe } from "../stt";
import { extractRetryAfter, getProp } from "../upstream";

/** Codes langue acceptés (le reste → détection automatique). */
const VALID_LANGUAGES = new Set<string>(TRANSCRIPTION_LANGUAGES);
/** Longueur max d'un terme de vocabulaire (context biasing). */
const MAX_BIAS_TERM_LENGTH = 128;
/** Nombre max de termes acceptés par Voxtral. */
const MAX_BIAS_TERMS = 100;

/**
 * Prépare le vocabulaire pour Voxtral. L'API REFUSE (HTTP 400, toute la transcription
 * échoue) un terme contenant un espace ou une virgule : « Asas Voice » doit devenir
 * « Asas » + « Voice ». On découpe donc les expressions en mots, on retire les doublons
 * (sans tenir compte de la casse) et on borne à 100 termes.
 */
export function sanitizeBiasTerms(raw: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    for (const piece of item.split(/[\s,]+/u)) {
      const word = piece.trim();
      if (!word || word.length > MAX_BIAS_TERM_LENGTH) continue;
      const key = word.toLocaleLowerCase("fr");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(word);
      if (out.length >= MAX_BIAS_TERMS) return out;
    }
  }
  return out;
}

interface ParsedAudio {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

function apiError(code: ApiErrorCode, message: string, retryAfterSec?: number): ApiError {
  return {
    error: { code, message, ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) },
  };
}

/** Détail d'erreur extrait du corps JSON renvoyé par Voxtral (SDK Mistral). */
interface UpstreamDetail {
  /** Type d'erreur Voxtral, ex. "invalid_model", "invalid_request_file". */
  type?: string;
  /** Code numérique Voxtral (chaîne), ex. "3310" (audio indécodable). */
  code?: string;
  /** Message humain renvoyé par Voxtral. */
  message?: string;
}

/**
 * Extrait le motif RÉEL d'une erreur upstream. Le SDK Mistral expose le corps brut de la
 * réponse d'erreur dans `err.body` (JSON) ; sans ça, un « HTTP 400 » reste opaque alors
 * que Voxtral distingue « modèle invalide » d'« audio indécodable ». `message` peut être
 * une chaîne (cas 400) ou un objet (cas 422, validation) → on normalise en chaîne.
 */
export function extractUpstreamDetail(err: unknown): UpstreamDetail {
  const body = getProp(err, "body");
  if (typeof body !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(body);
    const type = getProp(parsed, "type");
    const code = getProp(parsed, "code");
    const rawMsg = getProp(parsed, "message");
    const message =
      typeof rawMsg === "string"
        ? rawMsg.trim()
        : rawMsg && typeof rawMsg === "object"
          ? JSON.stringify(rawMsg)
          : undefined;
    return {
      type: typeof type === "string" ? type : undefined,
      code: typeof code === "string" ? code : undefined,
      message: message || undefined,
    };
  } catch {
    return {};
  }
}

/** Mappe une erreur d'appel Voxtral vers une réponse HTTP normalisée (ApiError). */
export function handleUpstreamError(
  request: FastifyRequest,
  reply: FastifyReply,
  err: unknown,
): FastifyReply {
  const name = err instanceof Error ? err.name : "";
  const status = getProp(err, "statusCode");

  if (name === "RequestTimeoutError" || name === "RequestAbortedError") {
    request.log.error({ err }, "Timeout Voxtral");
    return reply
      .code(504)
      .send(
        apiError(
          "upstream_timeout",
          "La transcription a expiré (Voxtral trop lent ou indisponible).",
        ),
      );
  }

  if (name === "ConnectionError") {
    request.log.error({ err }, "Connexion Voxtral impossible");
    return reply
      .code(502)
      .send(apiError("upstream_error", "Impossible de joindre le service de transcription."));
  }

  if (typeof status === "number") {
    // On extrait le motif RÉEL renvoyé par Voxtral (sinon tous les 400 se confondent).
    const detail = extractUpstreamDetail(err);
    request.log.error({ err, status, upstream: detail }, "Erreur upstream Voxtral");

    // Quota dépassé : réponse dédiée + Retry-After (si Voxtral le fournit) pour que
    // l'UI puisse temporiser au lieu de traiter ça comme une panne générique.
    if (status === 429) {
      const retryAfterSec = extractRetryAfter(err);
      request.log.warn({ err, status, retryAfterSec }, "Quota Voxtral dépassé (429)");
      if (retryAfterSec !== undefined) reply.header("Retry-After", String(retryAfterSec));
      return reply
        .code(429)
        .send(
          apiError(
            "rate_limited",
            "Quota de transcription atteint. Patientez un instant avant de réessayer.",
            retryAfterSec,
          ),
        );
    }

    if (status === 401 || status === 403) {
      return reply
        .code(502)
        .send(
          apiError(
            "invalid_api_key",
            "Clé Mistral refusée. Vérifiez-la ou remplacez-la dans Moteurs.",
          ),
        );
    }

    // Audio présent mais indécodable (silence, micro muet, clip trop court, fichier
    // corrompu) → code Voxtral 3310 / type invalid_request_file. C'est un problème
    // d'ENTRÉE, pas une panne du service : message actionnable et statut 422.
    if (detail.code === "3310" || detail.type === "invalid_request_file") {
      return reply
        .code(422)
        .send(
          apiError(
            "invalid_audio",
            "Aucun son exploitable détecté. Vérifiez que le bon micro est sélectionné et qu'il capte, puis réessayez.",
          ),
        );
    }

    // Modèle refusé par Voxtral (mauvaise config VOXTRAL_MODEL).
    if (detail.type === "invalid_model") {
      return reply
        .code(502)
        .send(
          apiError(
            "upstream_error",
            `Modèle de transcription invalide (${detail.message ?? "inconnu"}). Vérifiez la configuration du backend.`,
          ),
        );
    }

    // Autres erreurs upstream : on remonte le message réel de Voxtral quand il existe.
    const suffix = detail.message ? ` : ${detail.message}` : ".";
    return reply
      .code(502)
      .send(
        apiError("upstream_error", `Erreur du service de transcription (HTTP ${status})${suffix}`),
      );
  }

  request.log.error({ err }, "Erreur interne de transcription");
  return reply
    .code(500)
    .send(apiError("internal_error", "Erreur interne lors de la transcription."));
}

/**
 * POST /transcribe — reçoit un fichier audio (multipart/form-data, champ « file »
 * + champ optionnel « language »), appelle Voxtral Mini et renvoie { text, durationSec }.
 */
export async function transcribeRoutes(app: FastifyInstance, env: BackendEnv): Promise<void> {
  app.post("/transcribe", async (request, reply) => {
    // 0) L'en-tête custom du client desktop est EXIGÉ. Sans lui, un multipart est une
    // « simple request » : n'importe quelle page web pourrait déclencher des transcriptions
    // (et drainer le quota) sans être bloquée par CORS. L'exiger force un préflight.
    if (request.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) {
      return reply.code(403).send(apiError("forbidden", "Requête refusée : client non autorisé."));
    }

    // 1) La clé est-elle configurée côté serveur ?
    if (!env.mistralApiKey) {
      return reply
        .code(500)
        .send(
          apiError(
            "missing_api_key",
            "Aucune clé Mistral enregistrée. Ajoutez-la dans Moteurs pour activer la transcription.",
          ),
        );
    }

    // 2) Lecture du multipart : fichier audio + champs « language » et « vocabulary ».
    // (Un ancien champ « quality » éventuel est ignoré : il n'existe qu'un modèle.)
    let audio: ParsedAudio | undefined;
    let language: string | undefined;
    let biasTerms: string[] | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (!audio) {
            const buffer = await part.toBuffer();
            audio = {
              buffer,
              filename: part.filename || "audio",
              mimetype: part.mimetype || "application/octet-stream",
            };
          }
        } else if (part.fieldname === "language" && typeof part.value === "string") {
          // On n'accepte qu'un code connu ; toute autre valeur laisse `language`
          // indéfini → détection automatique côté fournisseur.
          const lang = part.value.trim().toLowerCase();
          if (VALID_LANGUAGES.has(lang)) language = lang;
        } else if (part.fieldname === "vocabulary" && typeof part.value === "string") {
          try {
            const parsed: unknown = JSON.parse(part.value);
            if (Array.isArray(parsed)) biasTerms = sanitizeBiasTerms(parsed);
          } catch {
            // Vocabulaire mal formé : ignoré (transcription sans biais).
          }
        }
      }
    } catch (err) {
      if (getProp(err, "code") === "FST_REQ_FILE_TOO_LARGE") {
        return reply
          .code(413)
          .send(apiError("invalid_audio", "Fichier audio trop volumineux (max 25 Mo)."));
      }
      request.log.error({ err }, "Échec de lecture du multipart");
      return reply.code(400).send(apiError("invalid_audio", "Requête multipart invalide."));
    }

    if (!audio || audio.buffer.length === 0) {
      return reply
        .code(400)
        .send(apiError("invalid_audio", "Aucun fichier audio reçu (champ multipart « file »)."));
    }

    // Whitelist du type : le client envoie du audio/* (audio/webm). On accepte aussi
    // application/octet-stream, valeur par défaut quand le navigateur n'a pas typé le blob.
    const mime = audio.mimetype.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!mime.startsWith("audio/") && mime !== "application/octet-stream") {
      return reply
        .code(415)
        .send(apiError("invalid_audio", "Type de fichier non supporté (audio attendu)."));
    }

    // 3) Appel STT (Voxtral).
    try {
      const result = await transcribe(env, {
        audio,
        language,
        biasTerms,
        timeoutMs: 60_000,
      });
      request.log.info(
        { durationSec: result.durationSec, chars: result.text.length },
        "Transcription réussie",
      );
      return reply.code(200).send(result);
    } catch (err) {
      return handleUpstreamError(request, reply, err);
    }
  });
}
