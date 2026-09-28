import { useLayoutEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { prettyShortcut } from "../lib/shortcut";
import { useReadiness } from "../lib/useReadiness";
import { useRecording } from "../store/recording";
import { useSettings } from "../store/settings";
import { useUi, type Screen } from "../store/ui";
import { BrandMark } from "./BrandMark";
import { EnginesIcon, HistoryIcon, MicIcon, SettingsIcon } from "./icons";
import { StatusPill } from "./StatusPill";

interface NavItem {
  id: Screen;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const ITEMS: NavItem[] = [
  { id: "dictation", label: "Dictée", Icon: MicIcon },
  { id: "history", label: "Historique", Icon: HistoryIcon },
  { id: "engines", label: "Moteurs", Icon: EnginesIcon },
  { id: "settings", label: "Réglages", Icon: SettingsIcon },
];

/**
 * Barre latérale pleine hauteur : marque (zone de glissement), navigation avec un
 * indicateur unique qui glisse d'un écran à l'autre, et en pied l'état réel + le raccourci.
 */
export function Sidebar() {
  const active = useUi((s) => s.screen);
  const setScreen = useUi((s) => s.setScreen);
  const shortcut = useSettings((s) => s.pushToTalkShortcut);
  const mode = useSettings((s) => s.dictationMode);
  const status = useRecording((s) => s.status);
  const readiness = useReadiness();

  // Indicateur glissant : mesuré sur l'élément actif, animé par un ressort CSS.
  const itemRefs = useRef<Partial<Record<Screen, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState<{ y: number; h: number; ready: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = itemRefs.current[active];
    if (!el) return;
    setIndicator((prev) => ({ y: el.offsetTop, h: el.offsetHeight, ready: prev !== null }));
  }, [active]);

  const live = status === "recording" || status === "transcribing";

  return (
    <aside className="sidebar">
      <div className="sidebar__brand" data-tauri-drag-region>
        <BrandMark size={22} className="sidebar__mark" />
        <span className="sidebar__name" data-tauri-drag-region>
          Asas Voice
        </span>
      </div>

      <nav className="nav" aria-label="Navigation principale">
        {indicator && (
          <span
            className={`nav__indicator ${indicator.ready ? "is-animated" : ""}`}
            style={{ transform: `translateY(${indicator.y}px)`, height: indicator.h }}
            aria-hidden="true"
          />
        )}
        {ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            ref={(el) => {
              itemRefs.current[id] = el;
            }}
            type="button"
            className={`nav__item ${active === id ? "is-active" : ""}`}
            aria-current={active === id ? "page" : undefined}
            onClick={() => setScreen(id)}
          >
            <span className="nav__icon">
              <Icon />
            </span>
            <span className="nav__label">{label}</span>
            {id === "dictation" && live && (
              <span className="nav__live" aria-label="Dictée en cours" />
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar__foot">
        <StatusPill readiness={readiness} />
        <div className="keycard" aria-label="Raccourci de dictée">
          <span className="keycard__label">
            {mode === "hold" ? "Maintenir pour dicter" : "Appuyer pour dicter"}
          </span>
          <span className="keycard__keys">
            {prettyShortcut(shortcut)
              .split(" + ")
              .map((k) => (
                <kbd key={k} className="kbd">
                  {k}
                </kbd>
              ))}
          </span>
        </div>
      </div>
    </aside>
  );
}
