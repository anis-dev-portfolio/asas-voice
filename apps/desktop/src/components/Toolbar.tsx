import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloseIcon, MaximizeIcon, MinimizeIcon } from "./icons";

interface ToolbarProps {
  /** Titre condensé, affiché quand le contenu a défilé sous la barre (null = aucun). */
  title: string | null;
  scrolled: boolean;
}

/**
 * Barre d'outils translucide posée sur le contenu : zone de glissement de la fenêtre,
 * titre condensé qui apparaît au défilement, contrôles de fenêtre.
 */
export function Toolbar({ title, scrolled }: ToolbarProps) {
  const win = getCurrentWindow();
  return (
    <header className={`toolbar ${scrolled ? "is-scrolled" : ""}`} data-tauri-drag-region>
      <span className="toolbar__title" data-tauri-drag-region aria-hidden={!scrolled}>
        {title}
      </span>
      <div className="toolbar__controls">
        <button
          type="button"
          className="wbtn"
          aria-label="Réduire"
          title="Réduire"
          onClick={() => void win.minimize()}
        >
          <MinimizeIcon />
        </button>
        <button
          type="button"
          className="wbtn"
          aria-label="Agrandir ou restaurer"
          title="Agrandir"
          onClick={() => void win.toggleMaximize()}
        >
          <MaximizeIcon />
        </button>
        <button
          type="button"
          className="wbtn wbtn--close"
          aria-label="Fermer (Asas Voice reste active dans la barre des tâches)"
          title="Fermer — reste active dans la barre des tâches"
          onClick={() => void win.close()}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
