import { useEffect, useRef, useState } from "react";
import { openMicStream } from "./audio";

/**
 * Niveau d'entrée micro (0..1) en temps réel pour `deviceId`.
 * `active=false` coupe l'analyse et libère le micro.
 */
export function useVuMeter(deviceId: string | null, active: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let cancelled = false;
    let stream: MediaStream | undefined;
    let audioCtx: AudioContext | undefined;

    const start = async (): Promise<void> => {
      try {
        stream = await openMicStream(deviceId);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = (): void => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          // RMS autour de 128 (silence du signal PCM 8 bits) → niveau 0..1.
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = ((data[i] ?? 128) - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          setLevel(Math.min(1, rms * 2.5)); // léger gain pour l'affichage
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!cancelled) setLevel(0);
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
      // close() rejette si le contexte est déjà fermé : on avale pour éviter
      // une « unhandled rejection » au démontage.
      void audioCtx?.close().catch(() => undefined);
    };
  }, [deviceId, active]);

  return level;
}
