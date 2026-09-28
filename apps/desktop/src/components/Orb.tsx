import { useEffect, useRef } from "react";
import { makeOrb, type OrbHandle } from "../orb/orb";
import { useOrb } from "../store/orb";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

interface OrbProps {
  /** Côté du canvas en px (carré). */
  size?: number;
  className?: string;
}

/**
 * Orbe « hero » de la fenêtre principale — même moteur que l'orbe flottante, piloté par
 * le store local (trames audio + état). Se met en pause dès que la fenêtre est cachée ou
 * réduite : rien ne tourne en arrière-plan.
 */
export function Orb({ size = 260, className }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let orb: OrbHandle;
    try {
      orb = makeOrb(canvas, { coreRatio: 0.165, theme: useSettings.getState().theme });
    } catch {
      return;
    }
    const initial = useOrb.getState();
    orb.setState(initial.state);
    orb.setFrame(initial.frame);
    orb.setActive(useUi.getState().mainVisible);

    const unsubOrb = useOrb.subscribe((s, prev) => {
      if (s.frame !== prev.frame) orb.setFrame(s.frame);
      if (s.state !== prev.state) orb.setState(s.state);
    });
    const unsubUi = useUi.subscribe((s, prev) => {
      if (s.mainVisible !== prev.mainVisible) orb.setActive(s.mainVisible);
    });
    const unsubTheme = useSettings.subscribe((s, prev) => {
      if (s.theme !== prev.theme) orb.setTheme(s.theme);
    });

    // Le curseur attire la matière (mêmes coordonnées normalisées que l'orbe flottante).
    const onMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      orb.setPointer(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        ((e.clientY - rect.top) / rect.height) * 2 - 1,
      );
    };
    const onLeave = (): void => orb.setPointer(null, null);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    return () => {
      unsubOrb();
      unsubUi();
      unsubTheme();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      orb.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
