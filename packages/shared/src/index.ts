/**
 * Types partagés entre l'app desktop et le backend.
 * Aucune dépendance, aucun secret : uniquement des contrats de données.
 */

/** Langues de transcription supportées (codes ISO 639-1 ; "auto" = détection automatique). */
export const TRANSCRIPTION_LANGUAGES = ["fr", "ar", "en", "es", "de", "it", "auto"] as const;

/** Langue de transcription (codes ISO 639-1 ; "auto" = détection automatique). */
export type TranscriptionLanguage = (typeof TRANSCRIPTION_LANGUAGES)[number];

/** Résultat d'une transcription réussie renvoyé par le backend (POST /transcribe). */
export interface TranscriptionResult {
  /** Texte transcrit. */
  text: string;
  /** Durée de l'audio transcrit, en secondes (source : usage.prompt_audio_seconds). */
  durationSec: number;
}

/** Codes d'erreur stables renvoyés par le backend (toutes routes confondues). */
export type ApiErrorCode =
  // Transcription (/transcribe)
  | "missing_api_key"
  | "invalid_api_key"
  | "invalid_audio"
  | "upstream_error"
  | "upstream_timeout"
  | "rate_limited"
  | "internal_error"
  | "forbidden"
  // Post-traitement Claude (/postprocess)
  | "no_anthropic_key"
  | "missing_text"
  | "text_too_long";

/** @deprecated Alias historique — utiliser {@link ApiErrorCode}. */
export type TranscribeErrorCode = ApiErrorCode;

/**
 * En-tête custom exigé sur les routes POST. Un multipart sans en-tête custom est une
 * « simple request » : n'importe quelle page web pourrait la DÉCLENCHER (même sans lire la
 * réponse) et drainer le quota. Exiger cet en-tête force un préflight CORS, que seules les
 * origines autorisées passent.
 */
export const CLIENT_HEADER = "x-asas-client";
export const CLIENT_HEADER_VALUE = "desktop";

/** Forme d'erreur normalisée renvoyée par l'API. */
export interface ApiError {
  error: {
    /** Code stable, lisible par la machine. */
    code: ApiErrorCode;
    /** Message lisible par l'humain (FR). */
    message: string;
    /** Secondes à patienter avant de réessayer (présent sur les réponses 429). */
    retryAfterSec?: number;
  };
}

/**
 * Réponse de l'endpoint de santé GET /health. Sert de sonde de vivacité (le process
 * répond) ET d'introspection : `ready` indique si la clé Mistral est présente, donc
 * si /transcribe est réellement opérationnel.
 */
export interface HealthResponse {
  status: "ok";
  service: "asas-voice-backend";
  /** Prêt à transcrire : la clé Mistral est configurée côté serveur. */
  ready: boolean;
  /** Post-traitement Claude disponible : la clé Anthropic est configurée. */
  hasAnthropicKey: boolean;
  /** Uptime du process backend, en secondes (entier). */
  uptimeSec: number;
}

/* ---- Moteurs (transcription, correction) : description + vérification réelle ---- */

/** Les deux moteurs distants utilisés par Asas Voice. */
export type EngineId = "transcription" | "correction";

/** Description statique d'un moteur (aucun appel réseau). */
export interface EngineInfo {
  id: EngineId;
  /** Nom commercial affiché, ex. « Voxtral Mini Transcribe 2 ». */
  name: string;
  /** Éditeur, ex. « Mistral AI ». */
  provider: string;
  /** Identifiant exact envoyé à l'API, ex. « voxtral-mini-latest ». */
  model: string;
  /** Une clé est présente côté backend (sans dire si elle est valide). */
  configured: boolean;
}

/** Réponse de GET /engines. */
export interface EnginesResponse {
  transcription: EngineInfo;
  correction: EngineInfo;
}

/**
 * Verdict d'une vérification réelle auprès du fournisseur (appel gratuit, sans
 * transcription ni génération) :
 *  - ok : clé acceptée ET modèle accessible ;
 *  - missing_key : aucune clé enregistrée ;
 *  - invalid_key : clé refusée par le fournisseur (401/403) ;
 *  - model_unavailable : clé valide mais modèle introuvable pour ce compte (404) ;
 *  - rate_limited : quota momentanément atteint (429) ;
 *  - unreachable : fournisseur injoignable (réseau, délai dépassé) ;
 *  - error : autre réponse inattendue.
 */
export type EngineCheckStatus =
  | "ok"
  | "missing_key"
  | "invalid_key"
  | "model_unavailable"
  | "rate_limited"
  | "unreachable"
  | "error";

/** Résultat de vérification d'un moteur. */
export interface EngineCheck {
  id: EngineId;
  status: EngineCheckStatus;
  /** Message lisible (FR). */
  message: string;
  /** Aller-retour avec le fournisseur, en ms (absent si aucun appel n'a eu lieu). */
  latencyMs?: number;
  /** Modèle réellement servi par le fournisseur (un alias « -latest » est résolu). */
  resolvedModel?: string;
  /** Horodatage de la vérification (ms epoch). */
  checkedAt: number;
}

/** Réponse de POST /engines/verify. */
export interface VerifyResponse {
  transcription?: EngineCheck;
  correction?: EngineCheck;
}

/** Port local par défaut du backend en Phase 0. */
export const DEFAULT_BACKEND_PORT = 4321;

/* ---- Contrat d'événements Tauri entre la fenêtre principale, Rust et l'orbe ---- */

/** État visuel de l'orbe (piloté par la fenêtre principale). */
export type OrbVisualState = "idle" | "listening" | "transcribing" | "confirmed" | "error";

/** Nombre de bandes de fréquence transmises à l'orbe (anneau de mesure). */
export const VOICE_BANDS = 24;

/**
 * Trame audio live émise ~30 fps pendant l'écoute : niveau global (RMS, 0..~1.3) et
 * énergie par bande de fréquence (VOICE_BANDS valeurs 0..1, graves → aigus).
 */
export interface VoiceFrame {
  level: number;
  bands: number[];
}

/** Event : trame audio live (payload = VoiceFrame). */
export const VOICE_FRAME_EVENT = "voice-frame";

/** Event : transition d'état de l'orbe (payload = OrbVisualState). */
export const ORB_STATE_EVENT = "orb-state";

/**
 * Event émis par Rust vers l'orbe : position du curseur relative à l'orbe
 * (x, y normalisés -1..1, null quand le curseur est loin) et vitesse de la fenêtre
 * pendant un déplacement (vx, vy en largeurs d'orbe par seconde).
 */
export interface OrbSense {
  x: number | null;
  y: number | null;
  vx: number;
  vy: number;
}
export const ORB_SENSE_EVENT = "orb-sense";

/**
 * Event émis par Rust vers l'orbe au moment du collage au curseur (effet « livraison ») :
 * direction (vecteur unitaire, y vers le bas) de l'endroit où le texte arrive. L'orbe
 * « lance » le texte dans cette direction : jet de matière, recul, anneau qui s'embrase.
 */
export interface OrbLaunch {
  dx: number;
  dy: number;
}
export const ORB_LAUNCH_EVENT = "orb-launch";

/**
 * Event émis par Rust quand une fenêtre est affichée ou cachée (tray, fermeture, mode
 * « orbe pendant la dictée »). Cacher une fenêtre Tauri ne met PAS la page en pause :
 * chaque fenêtre coupe elle-même ses animations en réponse à cet event.
 */
export interface WindowVisibility {
  /** Label Tauri de la fenêtre concernée (« main » ou « orb »). */
  label: string;
  visible: boolean;
}
export const WINDOW_VISIBILITY_EVENT = "window-visibility";
