/**
 * Pont vers la fenêtre orbe flottante (et le tray).
 * La fenêtre principale pousse les trames audio (~30 fps pendant l'écoute) et l'état ;
 * l'orbe écoute. On met aussi à jour le store local (orbe « hero » de la fenêtre).
 */
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import {
  ORB_STATE_EVENT,
  VOICE_FRAME_EVENT,
  type OrbVisualState,
  type VoiceFrame,
} from "@asas-voice/shared";
import { useOrb } from "../store/orb";

/** Pousse une trame audio live à l'orbe flottante + au store local. */
export function pushVoiceFrame(frame: VoiceFrame): void {
  useOrb.getState().setFrame(frame);
  void emitTo("orb", VOICE_FRAME_EVENT, frame).catch(() => undefined);
}

/** Change l'état visuel de l'orbe (flottante + hero) et l'infobulle du tray. */
export function pushOrbState(state: OrbVisualState): void {
  useOrb.getState().setState(state);
  void emitTo("orb", ORB_STATE_EVENT, state).catch(() => undefined);
  void invoke("set_tray_state", { state }).catch(() => undefined);
}
