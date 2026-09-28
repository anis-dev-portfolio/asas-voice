/**
 * Analyse live du micro pendant l'écoute : niveau global (RMS) + énergie par bande de
 * fréquence, pour piloter l'orbe (cœur + anneau de mesure).
 *
 * Réutilise le MediaStream de la dictée — on NE crée PAS de 2e flux micro. Cadencé par
 * un minuteur (et non requestAnimationFrame) : la dictée se fait le plus souvent fenêtre
 * principale cachée, et l'analyse doit continuer à alimenter l'orbe flottante.
 */
import { VOICE_BANDS, type VoiceFrame } from "@asas-voice/shared";

export interface VoiceAnalyser {
  /** Arrête la mesure et libère l'AudioContext (le stream n'est PAS fermé ici). */
  stop: () => void;
}

const TICK_MS = 1000 / 30;
/** Plage de la voix utile (Hz) répartie en bandes logarithmiques. */
const MIN_HZ = 90;
const MAX_HZ = 7000;

/**
 * Construit une fonction qui regroupe les bins FFT (0..255, sortie de
 * getByteFrequencyData) en `bandCount` bandes logarithmiques 0..1. Les bornes sont
 * calculées une fois ; chaque bande couvre au moins un bin.
 */
export function createBandMapper(
  sampleRate: number,
  binCount: number,
  bandCount: number = VOICE_BANDS,
): (freq: Uint8Array) => number[] {
  const hzPerBin = sampleRate / 2 / binCount;
  const edges: [number, number][] = [];
  const ratio = MAX_HZ / MIN_HZ;
  for (let b = 0; b < bandCount; b++) {
    const lo = MIN_HZ * Math.pow(ratio, b / bandCount);
    const hi = MIN_HZ * Math.pow(ratio, (b + 1) / bandCount);
    const start = Math.min(binCount - 1, Math.max(0, Math.floor(lo / hzPerBin)));
    const end = Math.min(binCount, Math.max(start + 1, Math.ceil(hi / hzPerBin)));
    edges.push([start, end]);
  }
  return (freq) =>
    edges.map(([start, end]) => {
      let sum = 0;
      for (let i = start; i < end; i++) sum += freq[i] ?? 0;
      const mean = sum / (end - start) / 255;
      // Courbe douce : écrase le bruit de fond, garde la dynamique de la voix.
      return Math.min(1, Math.pow(mean, 1.35) * 1.25);
    });
}

/** RMS (0..1) d'un signal temporel 8 bits centré sur 128. */
export function rmsOf(time: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < time.length; i++) {
    const v = ((time[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return time.length > 0 ? Math.sqrt(sum / time.length) : 0;
}

export function startVoiceAnalyser(
  stream: MediaStream,
  onFrame: (frame: VoiceFrame) => void,
): VoiceAnalyser {
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  analyser.minDecibels = -88;
  analyser.maxDecibels = -22;
  source.connect(analyser);
  const time = new Uint8Array(analyser.fftSize);
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const toBands = createBandMapper(audioCtx.sampleRate, analyser.frequencyBinCount);

  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(time);
    analyser.getByteFrequencyData(freq);
    // Gain ×6, plafond 1.3 : l'orbe doit réagir franchement à la voix.
    onFrame({ level: Math.min(1.3, rmsOf(time) * 6), bands: toBands(freq) });
  }, TICK_MS);

  return {
    stop: () => {
      window.clearInterval(timer);
      onFrame({ level: 0, bands: new Array<number>(VOICE_BANDS).fill(0) });
      source.disconnect();
      // close() est async : on l'invoque sans bloquer, mais on avale un éventuel rejet
      // (contexte déjà fermé) pour ne pas déclencher d'« unhandled rejection ».
      void audioCtx.close().catch(() => undefined);
    },
  };
}
