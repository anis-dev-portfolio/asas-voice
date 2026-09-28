import { create } from "zustand";
import {
  DEFAULT_BACKEND_PORT,
  type EngineCheck,
  type EngineId,
  type EnginesResponse,
  type HealthResponse,
} from "@asas-voice/shared";
import { fetchEngines, verifyEngines } from "../lib/config";
import type { MicPermission, ServiceState } from "../lib/readiness";
import { useUi } from "./ui";

const HEALTH_URL = `http://127.0.0.1:${DEFAULT_BACKEND_PORT}/health`;
/** Cadence de sonde : vive quand la fenêtre est à l'écran, lente quand elle est cachée. */
const POLL_VISIBLE_MS = 5_000;
const POLL_HIDDEN_MS = 30_000;
/** Échecs consécutifs tolérés avant de déclarer le service arrêté (évite le clignotement). */
const DOWN_AFTER_FAILURES = 2;

interface SystemState {
  service: ServiceState;
  health: HealthResponse | null;
  engines: EnginesResponse | null;
  checks: Partial<Record<EngineId, EngineCheck>>;
  verifying: Partial<Record<EngineId, boolean>>;
  micPermission: MicPermission;
  micCount: number | null;

  /** Sonde /health maintenant (et rafraîchit les moteurs si la configuration a changé). */
  refresh: () => Promise<void>;
  /** Vérifie réellement les clés auprès des fournisseurs (gratuit). */
  verify: (engines?: EngineId[]) => Promise<void>;
  /** Enregistre un verdict observé ailleurs (ex. une dictée refusée pour clé invalide). */
  recordCheck: (check: EngineCheck) => void;
  setMic: (permission: MicPermission, count: number | null) => void;
}

let failures = 0;
/** Vérifications en cours, par moteur. */
const inflight = new Map<EngineId, Promise<void>>();

export const useSystem = create<SystemState>((set, get) => ({
  service: "checking",
  health: null,
  engines: null,
  checks: {},
  verifying: {},
  micPermission: "unknown",
  micCount: null,

  refresh: async () => {
    let next: HealthResponse | null = null;
    try {
      const res = await fetch(HEALTH_URL, { cache: "no-store" });
      if (res.ok) next = (await res.json()) as HealthResponse;
    } catch {
      next = null;
    }
    const prev = get();
    if (!next) {
      failures += 1;
      // Au démarrage (ou pendant un redémarrage sur changement de clé), le sidecar met
      // ~1 s à écouter : un échec isolé ne suffit pas à le déclarer arrêté.
      if (failures >= DOWN_AFTER_FAILURES) set({ service: "down", health: null });
      return;
    }
    failures = 0;
    const cameUp = prev.service !== "up";
    // Le backend redémarre à chaque changement de clé : ready / hasAnthropicKey changent.
    const keysChanged =
      !prev.health ||
      prev.health.ready !== next.ready ||
      prev.health.hasAnthropicKey !== next.hasAnthropicKey ||
      next.uptimeSec < prev.health.uptimeSec;
    set({ service: "up", health: next });
    if (cameUp || keysChanged) {
      const engines = await fetchEngines();
      if (engines) set({ engines });
      // Un verdict antérieur ne vaut plus pour une nouvelle clé : on revérifie.
      set({ checks: {} });
      void get().verify();
    }
  },

  verify: async (which) => {
    const targets: EngineId[] = which ?? ["transcription", "correction"];
    // Une vérification déjà en vol pour un moteur est réutilisée (un seul appel réseau).
    const fresh = targets.filter((t) => !inflight.has(t));
    if (fresh.length > 0) {
      set((s) => ({
        verifying: { ...s.verifying, ...Object.fromEntries(fresh.map((t) => [t, true])) },
      }));
      const run = verifyEngines(fresh)
        .then((result) => {
          set((s) => ({
            checks: { ...s.checks, ...(result ?? {}) },
            verifying: { ...s.verifying, ...Object.fromEntries(fresh.map((t) => [t, false])) },
          }));
        })
        .finally(() => fresh.forEach((t) => inflight.delete(t)));
      fresh.forEach((t) => inflight.set(t, run));
    }
    await Promise.all(targets.map((t) => inflight.get(t)));
  },

  recordCheck: (check) => set((s) => ({ checks: { ...s.checks, [check.id]: check } })),

  setMic: (micPermission, micCount) => set({ micPermission, micCount }),
}));

/** Relit l'état du micro (autorisation + nombre de micros) pour l'état « Prêt ». */
export async function refreshMicState(): Promise<void> {
  let count: number | null = null;
  let permission: MicPermission = "unknown";
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    count = devices.filter((d) => d.kind === "audioinput").length;
  } catch {
    count = null;
  }
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    permission = status.state as MicPermission;
  } catch {
    permission = "unknown";
  }
  useSystem.getState().setMic(permission, count);
}

/**
 * Démarre la surveillance (UNE fois, depuis App) : sonde de santé à cadence adaptée à la
 * visibilité de la fenêtre + suivi des micros (branchement / débranchement).
 * Renvoie la fonction d'arrêt.
 */
export function startSystemMonitor(): () => void {
  let timer: number | null = null;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    const delay = useUi.getState().mainVisible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
    timer = window.setTimeout(() => {
      void useSystem.getState().refresh().finally(schedule);
    }, delay);
  };
  void useSystem.getState().refresh().finally(schedule);

  // Retour à l'écran : sonde immédiate (l'état affiché doit être frais).
  const unsubUi = useUi.subscribe((s, prev) => {
    if (s.mainVisible && !prev.mainVisible) void useSystem.getState().refresh();
  });

  void refreshMicState();
  const onDeviceChange = (): void => void refreshMicState();
  navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);

  return () => {
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    unsubUi();
    navigator.mediaDevices?.removeEventListener("devicechange", onDeviceChange);
  };
}
