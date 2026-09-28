/**
 * Couche STT : UNE seule fonction `transcribe()` isole l'appel de transcription
 * du reste du backend. Fournisseur unique en v1 : Voxtral (Mistral). Cette couche
 * reste le point d'extension centralisé si un second fournisseur devient nécessaire.
 *
 * RÈGLE DE SÉCURITÉ : la clé API ne provient QUE de l'env serveur (BackendEnv).
 */
import { Mistral } from "@mistralai/mistralai";
import type { TranscriptionResult } from "@asas-voice/shared";
import type { BackendEnv } from "./env";

export interface TranscribeParams {
  audio: { buffer: Buffer; filename: string; mimetype: string };
  /** Code ISO (ex. "fr"). undefined/"auto" → détection automatique. */
  language?: string | undefined;
  /** Vocabulaire personnalisé → context biasing (≤100 termes). */
  biasTerms?: string[] | undefined;
  /** Délai max de l'appel upstream, en ms (défaut 60 s). */
  timeoutMs?: number;
}

// Client Mistral réutilisé tant que la clé ne change pas (partagé avec la vérification).
let cached: { apiKey: string; client: Mistral } | undefined;
export function mistralClient(apiKey: string): Mistral {
  if (!cached || cached.apiKey !== apiKey) {
    cached = { apiKey, client: new Mistral({ apiKey }) };
  }
  return cached.client;
}

async function transcribeWithMistral(
  env: BackendEnv,
  params: TranscribeParams,
): Promise<TranscriptionResult> {
  if (!env.mistralApiKey) throw new Error("MISTRAL_API_KEY manquante.");
  const { audio, language, biasTerms, timeoutMs = 60_000 } = params;
  const client = mistralClient(env.mistralApiKey);
  const model = env.transcriptionModel;
  const useLanguage = language && language !== "auto" ? language : undefined;
  const bias = (biasTerms ?? []).filter(Boolean).slice(0, 100);

  const result = await client.audio.transcriptions.complete(
    {
      model,
      file: { fileName: audio.filename, content: audio.buffer },
      ...(useLanguage ? { language: useLanguage } : {}),
      ...(bias.length > 0 ? { contextBias: bias } : {}),
    },
    { timeoutMs },
  );

  const seconds = result.usage.promptAudioSeconds ?? 0;
  return { text: result.text, durationSec: Math.round(seconds * 10) / 10 };
}

/**
 * Transcrit l'audio via Voxtral (Mistral) et renvoie { text, durationSec }.
 * Les erreurs upstream sont propagées telles quelles (mappées en HTTP par la route).
 */
export async function transcribe(
  env: BackendEnv,
  params: TranscribeParams,
): Promise<TranscriptionResult> {
  return transcribeWithMistral(env, params);
}
