/*
 * Synchronisations fenêtre ↔ Rust, démarrées UNE fois depuis App :
 *  - visibilité de la fenêtre principale : cachée dans le tray ou réduite, elle coupe TOUTES
 *    ses animations (canvas + CSS). Cacher une fenêtre Tauri ne met pas la page en pause :
 *    sans ça, l'orbe de l'écran Dictée tournerait en arrière-plan 24 h/24 ;
 *  - visibilité de l'orbe flottante : toujours, ou seulement pendant une dictée.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WINDOW_VISIBILITY_EVENT, type WindowVisibility } from "@asas-voice/shared";
import { useOrb } from "../store/orb";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

function applyMainVisible(visible: boolean): void {
  useUi.getState().setMainVisible(visible);
  // Attribut lu par le CSS : met en pause toute animation CSS quand la fenêtre est cachée.
  document.documentElement.dataset.visible = visible ? "true" : "false";
}

/** Suit la visibilité réelle de la fenêtre principale. Renvoie la fonction d'arrêt. */
export function startMainVisibilitySync(): () => void {
  const win = getCurrentWindow();
  let disposed = false;
  const unlisteners: (() => void)[] = [];

  const refresh = async (): Promise<void> => {
    try {
      const [visible, minimized, maximized] = await Promise.all([
        win.isVisible(),
        win.isMinimized(),
        win.isMaximized(),
      ]);
      if (disposed) return;
      applyMainVisible(visible && !minimized);
      // Agrandie : plus de coins arrondis (la fenêtre touche les bords de l'écran).
      document.documentElement.dataset.maximized = maximized ? "true" : "false";
    } catch {
      // Hors Tauri (tests) : on reste « visible ».
    }
  };
  void refresh();

  void listen<WindowVisibility>(WINDOW_VISIBILITY_EVENT, (event) => {
    if (event.payload.label === "main") applyMainVisible(event.payload.visible);
  }).then((un) => (disposed ? un() : unlisteners.push(un)));
  // Réduction / restauration : Windows signale un redimensionnement.
  void win.onResized(() => void refresh()).then((un) => (disposed ? un() : unlisteners.push(un)));

  return () => {
    disposed = true;
    unlisteners.forEach((un) => un());
  };
}

/** Délai avant de masquer l'orbe après une dictée (laisse finir l'animation de fin). */
const HIDE_DELAY_MS = 450;

/** Affiche l'orbe flottante selon le réglage : toujours, ou seulement pendant une dictée. */
export function startOrbVisibilitySync(): () => void {
  let hideTimer: number | null = null;
  let current: boolean | null = null;

  const apply = (visible: boolean): void => {
    if (current === visible) return;
    current = visible;
    void invoke("set_orb_visible", { visible }).catch(() => undefined);
  };

  const update = (): void => {
    const always = useSettings.getState().orbVisibility === "always";
    const busy = useOrb.getState().state !== "idle";
    if (always || busy) {
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = null;
      apply(true);
    } else if (hideTimer === null && current !== false) {
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        apply(false);
      }, HIDE_DELAY_MS);
    }
  };

  update();
  const unsubSettings = useSettings.subscribe((s, prev) => {
    if (s.orbVisibility !== prev.orbVisibility) update();
  });
  const unsubOrb = useOrb.subscribe((s, prev) => {
    if (s.state !== prev.state) update();
  });

  return () => {
    if (hideTimer !== null) clearTimeout(hideTimer);
    unsubSettings();
    unsubOrb();
  };
}
