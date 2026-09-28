/** Contrôleur d'un enregistrement en cours. */
export interface ActiveRecording {
  /** Arrête l'enregistrement et renvoie le blob audio complet. */
  stop: () => Promise<Blob>;
}

const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm"];

export function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Démarre l'enregistrement sur `stream` (MediaRecorder ; container webm/opus sous WebView2).
 * Renvoie un contrôleur dont stop() résout le blob audio final.
 *
 * @throws Error si l'API MediaRecorder est indisponible dans l'environnement (peu
 * probable sous WebView2, mais géré proprement au lieu d'un ReferenceError opaque).
 */
export function startRecording(stream: MediaStream): ActiveRecording {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Enregistrement audio indisponible (MediaRecorder absent de cet environnement).");
  }
  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();

  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.addEventListener(
          "stop",
          () => resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" })),
          { once: true },
        );
        recorder.stop();
      }),
  };
}
