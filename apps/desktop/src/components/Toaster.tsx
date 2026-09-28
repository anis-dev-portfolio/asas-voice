import { useToasts } from "../store/toast";
import { AlertIcon, CheckIcon, InfoIcon } from "./icons";

/** Pile de confirmations brèves, en bas au centre de la fenêtre. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast--${t.tone}`}
          onClick={() => dismiss(t.id)}
        >
          <span className="toast__icon" aria-hidden="true">
            {t.tone === "ok" ? <CheckIcon /> : t.tone === "warn" ? <AlertIcon /> : <InfoIcon />}
          </span>
          {t.message}
        </button>
      ))}
    </div>
  );
}
