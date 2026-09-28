import { useState } from "react";
import { prettyShortcut, shortcutFromEvent } from "../lib/shortcut";
import { useRecording } from "../store/recording";
import { useSettings } from "../store/settings";
import { toast } from "../store/toast";

/**
 * Capture du raccourci global : on clique, on presse la combinaison, c'est enregistré.
 * Signale clairement un raccourci déjà pris par une autre application.
 */
export function ShortcutField() {
  const shortcut = useSettings((s) => s.pushToTalkShortcut);
  const setShortcut = useSettings((s) => s.setPushToTalkShortcut);
  const shortcutOk = useRecording((s) => s.shortcutOk);
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!capturing) return;
    e.preventDefault();
    if (e.key === "Escape") {
      setCapturing(false);
      setHint(null);
      return;
    }
    const capture = shortcutFromEvent(e);
    if (capture.status === "pending") return;
    if (capture.status === "needs-modifier") {
      setHint("Ajoutez Ctrl, Alt, Maj ou Win — seules F1 à F12 peuvent être utilisées seules.");
      return;
    }
    setShortcut(capture.shortcut);
    setCapturing(false);
    setHint(null);
    toast(`Raccourci : ${prettyShortcut(capture.shortcut)}`);
  }

  return (
    <div className="shortcutfield">
      <button
        type="button"
        className={`shortcut ${capturing ? "shortcut--capturing" : ""} ${!shortcutOk && !capturing ? "shortcut--error" : ""}`}
        onClick={() => {
          setCapturing(true);
          setHint(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setCapturing(false);
          setHint(null);
        }}
        aria-label={
          capturing
            ? "Appuyez sur la nouvelle combinaison"
            : `Raccourci actuel : ${prettyShortcut(shortcut)}. Cliquer pour changer`
        }
      >
        {capturing ? (
          <span className="shortcut__listening">
            Appuyez sur la combinaison… (Échap pour annuler)
          </span>
        ) : (
          prettyShortcut(shortcut)
            .split(" + ")
            .map((k) => (
              <kbd key={k} className="kbd">
                {k}
              </kbd>
            ))
        )}
      </button>
      {hint && <p className="fieldmsg fieldmsg--warn">{hint}</p>}
      {!capturing && !shortcutOk && (
        <p className="fieldmsg fieldmsg--error">
          Ce raccourci est déjà utilisé par Windows ou une autre application. Cliquez pour en
          choisir un autre.
        </p>
      )}
    </div>
  );
}
