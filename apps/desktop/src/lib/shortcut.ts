/** Noms de touches tels qu'imprimés sur un clavier français (Windows). */
const KEY_LABELS: Record<string, string> = {
  CommandOrControl: "Ctrl",
  CmdOrCtrl: "Ctrl",
  Control: "Ctrl",
  Super: "Win",
  Shift: "Maj",
  Space: "Espace",
  Enter: "Entrée",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
};

/** Convertit un raccourci Tauri en libellé lisible (« CommandOrControl+Space » → « Ctrl + Espace »). */
export function prettyShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((key) => KEY_LABELS[key] ?? key)
    .join(" + ");
}

/** Codes des touches modificatrices seules (ignorées tant qu'une vraie touche n'est pas pressée). */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

/** Traduit un `KeyboardEvent.code` en touche de raccourci Tauri (null si non géré). */
function keyFromCode(code: string): string | null {
  if (code === "Space") return "Space";
  if (code === "Enter") return "Enter";
  if (code === "Backquote") return "`";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? null;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1] ?? null;
  const fn = /^F([0-9]{1,2})$/.exec(code);
  if (fn) return `F${fn[1]}`;
  const arrow = /^Arrow(Up|Down|Left|Right)$/.exec(code);
  if (arrow) return arrow[1] ?? null;
  return null;
}

/** Résultat d'une tentative de capture de raccourci. */
export type ShortcutCapture =
  /** Combinaison valide, prête à être enregistrée. */
  | { status: "ok"; shortcut: string }
  /** Touche seule (lettre, chiffre, Espace…) : il faut au moins un modificateur. */
  | { status: "needs-modifier" }
  /** Modificateur seul ou touche non gérée : continuer d'écouter. */
  | { status: "pending" };

/**
 * Construit un raccourci Tauri (ex. "CommandOrControl+Space") à partir d'un événement
 * clavier de capture. Une touche SEULE (hors F1–F12) est refusée : enregistrée en
 * raccourci GLOBAL, elle confisquerait cette touche dans tout le système.
 */
export function shortcutFromEvent(e: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): ShortcutCapture {
  if (MODIFIER_CODES.has(e.code)) return { status: "pending" };
  const key = keyFromCode(e.code);
  if (!key) return { status: "pending" };
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("CommandOrControl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const isFnKey = /^F[0-9]{1,2}$/.test(key);
  if (mods.length === 0 && !isFnKey) return { status: "needs-modifier" };
  return { status: "ok", shortcut: [...mods, key].join("+") };
}
