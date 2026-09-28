import { create } from "zustand";
import { VOICE_BANDS, type OrbVisualState, type VoiceFrame } from "@asas-voice/shared";

/**
 * Miroir local de l'état de l'orbe pour l'orbe « hero » de la fenêtre principale.
 * La fenêtre orbe flottante reçoit, elle, les mêmes valeurs par events Tauri.
 */
interface OrbStore {
  frame: VoiceFrame;
  state: OrbVisualState;
  setFrame: (frame: VoiceFrame) => void;
  setState: (state: OrbVisualState) => void;
}

export const SILENT_FRAME: VoiceFrame = {
  level: 0,
  bands: new Array<number>(VOICE_BANDS).fill(0),
};

export const useOrb = create<OrbStore>((set) => ({
  frame: SILENT_FRAME,
  state: "idle",
  setFrame: (frame) => set({ frame }),
  setState: (state) => set({ state }),
}));
