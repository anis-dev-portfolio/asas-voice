import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  DEFAULT_BACKEND_PORT,
  type ApiError,
  type ApiErrorCode,
  type TranscriptionResult,
} from "@asas-voice/shared";

const BACKEND_URL = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;

export interface TranscribeOptions {
  language: string;
  /** Vocabulaire personnalisé → context biasing (≤100 termes). */
  vocabulary?: string[];
}

/**
 * Motif d'échec d'une transcription : un code du backend, ou un échec côté client
 * (service local muet, délai dépassé, réponse illisible). Sert à attribuer l'erreur à la
 * bonne étape dans l'UI (clé refusée ≠ réseau coupé ≠ silence).
 */
export type TranscribeFailure = ApiErrorCode | "service_unreachable" | "timeout" | "bad_response";

/** Erreur de transcription typée (message FR prêt à afficher + code stable). */
export class TranscribeError extends Error {
  readonly code: TranscribeFailure;
  readonly status: number | undefined;

  constructor(code: TranscribeFailure, message: string, status?: number) {
    super(message);
    this.name = "TranscribeError";
    this.code = code;
    this.status = status;
  }
}

/** Envoie le blob audio au backend local (POST /transcribe) et renvoie la transcription. */
export async function postAudioForTranscription(
  blob: Blob,
  options: TranscribeOptions,
  filename = "dictation.webm",
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("language", options.language);
  // Context biasing : on borne à 100 termes côté client (limite Voxtral).
  const bias = (options.vocabulary ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (bias.length > 0) form.append("vocabulary", JSON.stringify(bias));

  // Garde-fou : le backend a son propre timeout (60 s). On coupe à 65 s côté client
  // pour ne pas laisser l'UI bloquée en « transcribing » si le backend devient muet.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 65_000);
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/transcribe`, {
      method: "POST",
      // En-tête custom EXIGÉ par le backend : force un préflight CORS côté navigateur,
      // de sorte que seule la webview Tauri (origine autorisée) puisse déclencher une
      // transcription.
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TranscribeError(
        "timeout",
        "La transcription a expiré (service trop lent ou injoignable).",
      );
    }
    // fetch rejette en TypeError quand rien n'écoute sur le port : service local arrêté.
    throw new TranscribeError(
      "service_unreachable",
      "Le service de transcription local ne répond pas. Relancez-le depuis le bandeau.",
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let code: TranscribeFailure = "upstream_error";
    let message = `Erreur du service de transcription (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as ApiError;
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      // réponse non-JSON : on garde le message générique
    }
    throw new TranscribeError(code, message, res.status);
  }

  try {
    return (await res.json()) as TranscriptionResult;
  } catch {
    throw new TranscribeError("bad_response", "Réponse du service illisible (JSON attendu).");
  }
}
