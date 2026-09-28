/**
 * Lecture / validation des variables d'environnement du backend.
 * RÈGLE DE SÉCURITÉ : la clé Voxtral (MISTRAL_API_KEY) ne vit QU'ICI, côté serveur,
 * jamais dans l'app desktop.
 */
import { existsSync } from "node:fs";
import { DEFAULT_BACKEND_PORT } from "@asas-voice/shared";

// Charge apps/backend/.env s'il existe (cwd = dossier du package, en dev comme en prod).
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/**
 * Modèle de transcription par défaut. C'est le SEUL modèle de transcription « batch » de
 * Mistral : l'alias suit la dernière version (Voxtral Mini Transcribe 2 à ce jour).
 */
export const DEFAULT_TRANSCRIPTION_MODEL = "voxtral-mini-latest";

export interface BackendEnv {
  port: number;
  /** undefined si non configurée → erreur claire renvoyée au moment de la requête. */
  mistralApiKey: string | undefined;
  /** Clé Anthropic pour Claude (post-traitement IA). undefined = fonctionnalité désactivée. */
  anthropicApiKey: string | undefined;
  /** Modèle de transcription envoyé à Mistral (surchargeable via VOXTRAL_MODEL). */
  transcriptionModel: string;
}

export function readEnv(): BackendEnv {
  const rawPort = process.env.PORT;
  const parsedPort = rawPort ? Number(rawPort) : DEFAULT_BACKEND_PORT;
  return {
    port: Number.isFinite(parsedPort) ? parsedPort : DEFAULT_BACKEND_PORT,
    mistralApiKey: process.env.MISTRAL_API_KEY?.trim() || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    transcriptionModel: process.env.VOXTRAL_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL,
  };
}
