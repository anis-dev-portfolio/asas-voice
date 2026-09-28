import { useState } from "react";
import { restartBackend } from "../lib/config";
import { useSystem } from "../store/system";
import { toast } from "../store/toast";
import { AlertIcon, RefreshIcon } from "./icons";

/**
 * Bandeau explicite quand le service local de transcription (sidecar) ne répond pas.
 * Propose une relance et confirme son issue (la sonde de santé tranche).
 */
export function BackendBanner() {
  const service = useSystem((s) => s.service);
  const [restarting, setRestarting] = useState(false);

  if (service !== "down") return null;

  const onRestart = async (): Promise<void> => {
    setRestarting(true);
    try {
      await restartBackend();
    } catch {
      // L'état réel est établi par la sonde ci-dessous.
    }
    // Laisse le service démarrer (~1-2 s), puis vérifie vraiment.
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
      await useSystem.getState().refresh();
      if (useSystem.getState().service === "up") break;
    }
    setRestarting(false);
    if (useSystem.getState().service === "up") toast("Service de transcription relancé");
    else toast("Le service ne redémarre pas — redémarrez Asas Voice.", "warn");
  };

  return (
    <div className="banner" role="alert">
      <span className="banner__icon" aria-hidden="true">
        <AlertIcon />
      </span>
      <span className="banner__text">
        Le service de transcription local ne répond pas — la dictée est indisponible.
      </span>
      <button
        type="button"
        className="btn btn--quiet banner__action"
        onClick={() => void onRestart()}
        disabled={restarting}
      >
        <RefreshIcon className={restarting ? "spin" : undefined} />
        {restarting ? "Relance…" : "Relancer le service"}
      </button>
    </div>
  );
}
