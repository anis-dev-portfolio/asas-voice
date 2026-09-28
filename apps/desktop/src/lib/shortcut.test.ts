import { describe, expect, it } from "vitest";
import { prettyShortcut, shortcutFromEvent } from "./shortcut";

const ev = (
  code: string,
  mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {},
) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("prettyShortcut", () => {
  it("affiche les touches comme sur un clavier français", () => {
    expect(prettyShortcut("CommandOrControl+Space")).toBe("Ctrl + Espace");
    expect(prettyShortcut("CommandOrControl+Shift+D")).toBe("Ctrl + Maj + D");
    expect(prettyShortcut("Super+Alt+Enter")).toBe("Win + Alt + Entrée");
    expect(prettyShortcut("F9")).toBe("F9");
  });
});

describe("shortcutFromEvent", () => {
  it("combinaison avec modificateur → raccourci Tauri", () => {
    expect(shortcutFromEvent(ev("Space", { ctrlKey: true }))).toEqual({
      status: "ok",
      shortcut: "CommandOrControl+Space",
    });
  });
  it("touche seule refusée, sauf F1–F12", () => {
    expect(shortcutFromEvent(ev("KeyA")).status).toBe("needs-modifier");
    expect(shortcutFromEvent(ev("F9"))).toEqual({ status: "ok", shortcut: "F9" });
  });
  it("modificateur seul : on attend la suite", () => {
    expect(shortcutFromEvent(ev("ControlLeft", { ctrlKey: true })).status).toBe("pending");
  });
});
