import { create } from "zustand";
import {
  addDictation,
  deleteDictation,
  listDictations,
  setDictationPinned,
  updateDictationText,
  type DictationRow,
} from "../lib/history";

interface HistoryState {
  items: DictationRow[];
  search: string;
  setSearch: (search: string) => void;
  reload: () => Promise<void>;
  add: (text: string, durationSec: number) => Promise<void>;
  update: (id: number, text: string) => Promise<void>;
  togglePin: (id: number, pinned: boolean) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

/** Historique des dictées, adossé à SQLite (lib/history). */
export const useHistory = create<HistoryState>((set, get) => ({
  items: [],
  search: "",
  setSearch: (search) => {
    set({ search });
    void get().reload();
  },
  reload: async () => {
    try {
      set({ items: await listDictations(get().search) });
    } catch {
      // Base pas encore prête : ignoré, rechargé au prochain appel.
    }
  },
  add: async (text, durationSec) => {
    await addDictation(text, durationSec);
    await get().reload();
  },
  update: async (id, text) => {
    await updateDictationText(id, text);
    await get().reload();
  },
  togglePin: async (id, pinned) => {
    await setDictationPinned(id, pinned);
    await get().reload();
  },
  remove: async (id) => {
    await deleteDictation(id);
    await get().reload();
  },
}));
