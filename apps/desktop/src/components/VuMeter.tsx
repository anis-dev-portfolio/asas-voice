interface VuMeterProps {
  /** Niveau 0..1. */
  level: number;
  active: boolean;
}

const SEGMENTS = 32;

/**
 * Niveau d'entrée micro, en graduations (l'anneau de l'orbe déroulé) : lecture précise,
 * zone utile au centre, saturation en fin de course.
 */
export function VuMeter({ level, active }: VuMeterProps) {
  const clamped = active ? Math.min(1, Math.max(0, level)) : 0;
  const lit = Math.round(clamped * SEGMENTS);
  const pct = Math.round(clamped * 100);
  const verdict = !active
    ? "Test arrêté"
    : pct < 4
      ? "Silence — parlez pour tester"
      : pct > 92
        ? "Trop fort — éloignez le micro"
        : "Niveau correct";
  return (
    <div
      className="vu"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Niveau du micro"
    >
      <div className="vu__ticks" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`vu__tick ${i < lit ? "is-lit" : ""} ${i >= SEGMENTS - 3 ? "is-hot" : ""}`}
          />
        ))}
      </div>
      <span className="vu__label num">{active ? `${pct} %` : "—"}</span>
      <span className="vu__verdict">{verdict}</span>
    </div>
  );
}
