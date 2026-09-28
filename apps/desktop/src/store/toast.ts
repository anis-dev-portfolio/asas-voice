import { create } from "zustand";

export type ToastTone = "ok" | "info" | "warn";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  dismiss: (id: number) => void;
}

const DURATION_MS = 2600;
const MAX_TOASTS = 3;
let nextId = 1;

/** Confirmations brèves (« Copié », « Clé vérifiée »…) : chaque action visible a un retour. */
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Affiche un toast qui disparaît seul. */
export function toast(message: string, tone: ToastTone = "ok"): void {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, message, tone }].slice(-MAX_TOASTS) }));
  window.setTimeout(() => useToasts.getState().dismiss(id), DURATION_MS);
}
