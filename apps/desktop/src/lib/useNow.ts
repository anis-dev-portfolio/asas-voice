import { useEffect, useState } from "react";
import { useUi } from "../store/ui";

/**
 * Horloge pour les temps relatifs (« il y a 3 min ») : se met à jour toutes les
 * `intervalMs`, et seulement quand la fenêtre est à l'écran.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  const visible = useUi((s) => s.mainVisible);
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [visible, intervalMs]);
  return now;
}
