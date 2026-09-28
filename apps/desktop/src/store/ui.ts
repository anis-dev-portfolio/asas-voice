import { create } from "zustand";

/** Écrans de la fenêtre principale. */
export type Screen = "dictation" | "history" | "engines" | "settings";

interface UiState {
  screen: Screen;
  /** Fenêtre principale visible à l'écran (ni cachée dans le tray, ni réduite). */
  mainVisible: boolean;
  setScreen: (screen: Screen) => void;
  setMainVisible: (visible: boolean) => void;
}

/** État d'interface volatil : navigation + visibilité de la fenêtre (pause des animations). */
export const useUi = create<UiState>((set) => ({
  screen: "dictation",
  mainVisible: true,
  setScreen: (screen) => set({ screen }),
  setMainVisible: (mainVisible) => set({ mainVisible }),
}));
