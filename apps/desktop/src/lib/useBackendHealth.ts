import { useEffect, useState } from "react";
import { DEFAULT_BACKEND_PORT } from "@asas-voice/shared";

export type BackendHealth = "checking" | "connected" | "offline";

const HEALTH_URL = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}/health`;

/** Sonde l'état du backend local (GET /health) toutes les 5 s. */
export function useBackendHealth(): BackendHealth {
  const [health, setHealth] = useState<BackendHealth>("checking");

  useEffect(() => {
    let active = true;
    const check = async (): Promise<void> => {
      try {
        const res = await fetch(HEALTH_URL, { cache: "no-store" });
        if (active) setHealth(res.ok ? "connected" : "offline");
      } catch {
        if (active) setHealth("offline");
      }
    };
    void check();
    const id = window.setInterval(check, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return health;
}
