/*
 * Point d'entrée de la fenêtre orbe (label Tauri « orb »).
 *
 * Ne fait QUE du rendu : elle ne touche pas au micro. Tout arrive par events :
 *   - VOICE_FRAME_EVENT (fenêtre principale, ~30 fps pendant l'écoute) → orb.setFrame()
 *   - ORB_STATE_EVENT (fenêtre principale)                              → orb.setState()
 *   - ORB_SENSE_EVENT (Rust : curseur à proximité, fenêtre déplacée)    → setPointer/setMotion
 *   - ORB_LAUNCH_EVENT (Rust : texte collé au curseur, effet livraison) → orb.launch()
 *   - WINDOW_VISIBILITY_EVENT (Rust : orbe affichée / masquée)          → orb.setActive()
 *     Au masquage, Rust attend la fin de la sortie animée (OUTRO_MS) avant de cacher la
 *     fenêtre : l'orbe se rétracte et s'efface au lieu de disparaître d'un coup.
 *
 * Les zones transparentes autour de l'orbe laissent passer les clics (géré côté Rust) :
 * seule l'orbe elle-même s'attrape (glisser) et se clique (ouvre Asas Voice).
 */
import "./orb.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ORB_LAUNCH_EVENT,
  ORB_SENSE_EVENT,
  ORB_STATE_EVENT,
  VOICE_FRAME_EVENT,
  WINDOW_VISIBILITY_EVENT,
  type OrbLaunch,
  type OrbSense,
  type OrbVisualState,
  type VoiceFrame,
  type WindowVisibility,
} from "@asas-voice/shared";
import { makeOrb } from "./orb";

const canvas = document.getElementById("orb") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Canvas #orb introuvable.");

// Posée sur n'importe quel fond (document blanc, éditeur sombre) : ombre + graduations cernées.
const orb = makeOrb(canvas, { coreRatio: 0.165, theme: "dark", floating: true });

/**
 * Réglage « seulement pendant la dictée » : la fenêtre principale va masquer l'orbe dès
 * son démarrage. On ne l'allume donc pas ici (sinon : apparition puis effacement à chaque
 * lancement) ; elle entrera en scène au premier affichage. Même origine que la fenêtre
 * principale : on lit son stockage persistant (format zustand/persist).
 */
function startsHidden(): boolean {
  try {
    const raw = localStorage.getItem("asas-voice-settings");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { orbVisibility?: unknown } } | null;
    return parsed?.state?.orbVisibility === "dictation";
  } catch {
    return false;
  }
}
if (!startsHidden()) orb.setActive(true);

// Pas de menu contextuel du navigateur sur l'orbe.
document.addEventListener("contextmenu", (e) => e.preventDefault());

// ---- Interaction : glisser pour déplacer, cliquer pour ouvrir Asas Voice ----
// Déplacement = drag natif de l'OS (fiable, fluide) : au-delà d'un seuil on lui rend
// la main. En deçà, le clic ouvre la fenêtre principale.
const appWindow = getCurrentWindow();
const DRAG_THRESHOLD = 4; // px
let downX = 0;
let downY = 0;
let pressed = false;
let dragging = false;

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  downX = e.screenX;
  downY = e.screenY;
  pressed = true;
  dragging = false;
});

canvas.addEventListener("pointermove", (e) => {
  // Suivi fin du curseur quand il survole l'orbe (Rust prend le relais à l'extérieur).
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    orb.setPointer(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      ((e.clientY - rect.top) / rect.height) * 2 - 1,
    );
  }
  if (!pressed || dragging || e.buttons !== 1) return;
  if (Math.hypot(e.screenX - downX, e.screenY - downY) > DRAG_THRESHOLD) {
    dragging = true;
    void appWindow.startDragging();
  }
});

canvas.addEventListener("pointerup", () => {
  if (pressed && !dragging) void invoke("show_main");
  pressed = false;
});
canvas.addEventListener("pointercancel", () => {
  pressed = false;
});

void listen<VoiceFrame>(VOICE_FRAME_EVENT, (event) => orb.setFrame(event.payload));
void listen<OrbVisualState>(ORB_STATE_EVENT, (event) => orb.setState(event.payload));
void listen<OrbSense>(ORB_SENSE_EVENT, (event) => {
  const { x, y, vx, vy } = event.payload;
  orb.setPointer(x, y);
  orb.setMotion(vx, vy);
});
void listen<OrbLaunch>(ORB_LAUNCH_EVENT, (event) => orb.launch(event.payload.dx, event.payload.dy));
void listen<WindowVisibility>(WINDOW_VISIBILITY_EVENT, (event) => {
  if (event.payload.label === "orb") orb.setActive(event.payload.visible, true);
});
