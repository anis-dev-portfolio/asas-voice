import { useId } from "react";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Marque d'Asas Voice en SVG (nette à toute densité) : la sphère spectrale dans son
 * anneau, arc des graves allumé — la même lecture que l'orbe animée et l'icône.
 */
export function BrandMark({ size = 20, className }: BrandMarkProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient
          id={`${id}c`}
          cx="17"
          cy="17.3"
          r="10.5"
          fx="12.3"
          fy="11.8"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fff3e4" />
          <stop offset="0.22" stopColor="#ffb088" />
          <stop offset="0.52" stopColor="#e07fc4" />
          <stop offset="0.78" stopColor="#9a66ff" />
          <stop offset="1" stopColor="#3f2ea6" />
        </radialGradient>
      </defs>
      <circle
        cx="16"
        cy="16"
        r="13"
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.45"
        strokeWidth="1.6"
      />
      <path
        d="M9.3 27.2A13 13 0 0 0 22.7 27.2"
        fill="none"
        stroke="var(--live)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="8.4" fill={`url(#${id}c)`} />
    </svg>
  );
}
