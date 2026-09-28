/* Contrôles réutilisables : interrupteur, sélecteur segmenté, groupe et ligne de réglage. */
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Précision sous le libellé (ce que fait l'option, concrètement). */
  hint?: ReactNode;
  disabled?: boolean;
}

/** Interrupteur on/off accessible (case à cocher stylée), dans une ligne de réglage. */
export function Switch({ checked, onChange, label, hint, disabled }: SwitchProps) {
  return (
    <label className={`row switch ${disabled ? "is-disabled" : ""}`}>
      <span className="row__text">
        <span className="row__label">{label}</span>
        {hint && <span className="row__hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </label>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Occupe toute la largeur disponible (options de même largeur). */
  block?: boolean;
}

/**
 * Sélecteur segmenté (radiogroup) pour 2–3 options exclusives. Un curseur unique glisse
 * sous l'option choisie (ressort), comme un vrai contrôle matériel.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  block,
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<{ x: number; w: number; ready: boolean } | null>(null);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  useLayoutEffect(() => {
    const el = refs.current[index];
    if (!el) return;
    const measure = (): void =>
      setThumb((prev) => ({ x: el.offsetLeft, w: el.offsetWidth, ready: prev !== null }));
    measure();
    // Les libellés changent de largeur quand la police finit de charger.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, options.length]);

  return (
    <div
      className={`segmented ${block ? "segmented--block" : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {thumb && (
        <span
          className={`segmented__thumb ${thumb.ready ? "is-animated" : ""}`}
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
          aria-hidden="true"
        />
      )}
      {options.map((opt, i) => (
        <button
          key={opt.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`segmented__opt ${value === opt.value ? "is-active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface SettingRowProps {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  /** Empile libellé et contrôle (pour les contrôles larges). */
  stacked?: boolean;
}

/** Ligne de réglage : libellé (+ précision) à gauche, contrôle à droite. */
export function SettingRow({ label, hint, children, stacked }: SettingRowProps) {
  return (
    <div className={`row ${stacked ? "row--stacked" : ""}`}>
      <div className="row__text">
        <span className="row__label">{label}</span>
        {hint && <span className="row__hint">{hint}</span>}
      </div>
      <div className="row__control">{children}</div>
    </div>
  );
}

export type TileTone = "violet" | "peach" | "indigo" | "rose" | "graphite" | "spectral" | "mint";

interface TileProps {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: TileTone;
  size?: "sm" | "md";
}

/** Tuile d'icône colorée (en-têtes de groupes, moteurs). */
export function Tile({ Icon, tone, size = "sm" }: TileProps) {
  return (
    <span className={`tile tile--${tone} tile--${size}`} aria-hidden="true">
      <Icon />
    </span>
  );
}

interface GroupProps {
  id: string;
  title: string;
  Icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: TileTone;
  /** Phrase d'explication sous le titre. */
  lede?: ReactNode;
  children: ReactNode;
}

/** Groupe de réglages : titre (+ tuile) hors du panneau, lignes séparées par des filets. */
export function Group({ id, title, Icon, tone = "violet", lede, children }: GroupProps) {
  return (
    <section className="group" aria-labelledby={id}>
      <header className="group__head">
        {Icon && <Tile Icon={Icon} tone={tone} />}
        <h2 id={id} className="group__title">
          {title}
        </h2>
      </header>
      {lede && <p className="group__lede">{lede}</p>}
      <div className="group__body">{children}</div>
    </section>
  );
}
