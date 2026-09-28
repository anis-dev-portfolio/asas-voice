import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { DictationRow } from "./history";

export type ExportFormat = "txt" | "md";

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString("fr-FR");
}

/** Construit le contenu d'export de l'historique (texte brut ou Markdown). */
export function buildExport(items: DictationRow[], format: ExportFormat): string {
  if (format === "md") {
    const lines = ["# Asas Voice — historique des dictées", ""];
    for (const it of items) {
      lines.push(`## ${fmtDate(it.created_at)}${it.pinned ? " · épinglée" : ""}`);
      lines.push("", it.text.trim(), "");
    }
    return lines.join("\n");
  }
  return items
    .map((it) => `${fmtDate(it.created_at)} (${it.duration_sec}s)\n${it.text.trim()}`)
    .join("\n\n———\n\n");
}

/** Repli : téléchargement navigateur si le dialogue natif est indisponible. */
function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exporte l'historique (liste déjà filtrée) via le dialogue natif « Enregistrer sous ».
 * L'écriture se fait côté Rust (commande save_text_file). Renvoie true si le fichier a été
 * écrit, false si l'utilisateur a annulé (ou s'il n'y a rien à exporter). Si le dialogue
 * est indisponible (hors Tauri), repli sur le téléchargement navigateur.
 * @throws si l'écriture du fichier échoue (disque plein, droits…).
 */
export async function exportHistory(items: DictationRow[], format: ExportFormat): Promise<boolean> {
  if (items.length === 0) return false;
  const content = buildExport(items, format);
  const defaultName = `asas-voice-historique.${format}`;
  let path: string | null;
  try {
    path = await save({
      defaultPath: defaultName,
      filters: [
        {
          name: format === "md" ? "Markdown" : "Texte",
          extensions: [format],
        },
      ],
    });
  } catch {
    // Dialogue indisponible : repli sur le téléchargement webview.
    downloadText(defaultName, content);
    return true;
  }
  if (!path) return false; // l'utilisateur a annulé
  await invoke("save_text_file", { path, content });
  return true;
}
