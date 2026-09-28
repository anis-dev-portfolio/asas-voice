import { invoke } from "@tauri-apps/api/core";

/** Mémorise (côté Rust) la fenêtre qui a le focus, pour y restaurer le focus avant de coller. */
export async function captureTarget(): Promise<void> {
  await invoke("capture_target");
}

/** Écrit le texte dans le presse-papier (commande Rust copy_text). */
export async function copyText(text: string): Promise<void> {
  await invoke("copy_text", { text });
}

/**
 * Restaure le focus de la fenêtre cible puis colle au curseur via Ctrl+V (commande Rust
 * paste_text). `animate` : effet « livraison » (orbe → curseur, texte illuminé), joué en
 * parallèle — le collage n'attend jamais l'animation.
 */
export async function pasteText(text: string, animate = false): Promise<void> {
  await invoke("paste_text", { text, animate });
}

/** Rectangle en pixels physiques de l'écran. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Joue l'effet « livraison » vers des lignes de texte données (aperçu dans Réglages). */
export async function previewDelivery(lines: ScreenRect[]): Promise<void> {
  await invoke("preview_delivery", { lines });
}
