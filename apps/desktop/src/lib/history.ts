import Database from "@tauri-apps/plugin-sql";

export interface DictationRow {
  id: number;
  text: string;
  duration_sec: number;
  created_at: number;
  /** 1 = épinglée (remontée en tête de liste). */
  pinned: number;
}

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  dbPromise ??= Database.load("sqlite:asasvoice.db");
  return dbPromise;
}

/** Ajoute une dictée à l'historique (created_at = maintenant, en ms). */
export async function addDictation(text: string, durationSec: number): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT INTO dictations (text, duration_sec, created_at) VALUES ($1, $2, $3)", [
    text,
    durationSec,
    Date.now(),
  ]);
}

/**
 * Échappe les jokers LIKE (`% _ \`) pour une recherche littérale (avec ESCAPE '\').
 * Sans ça, taper « 100% » ou « _ » filtrerait n'importe quoi.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Liste les dictées (épinglées d'abord, puis plus récentes), filtrées par texte. */
export async function listDictations(search: string): Promise<DictationRow[]> {
  const db = await getDb();
  const term = search.trim();
  if (term) {
    const literal = escapeLikePattern(term);
    return db.select<DictationRow[]>(
      "SELECT * FROM dictations WHERE text LIKE $1 ESCAPE '\\' ORDER BY pinned DESC, created_at DESC LIMIT 500",
      [`%${literal}%`],
    );
  }
  return db.select<DictationRow[]>(
    "SELECT * FROM dictations ORDER BY pinned DESC, created_at DESC LIMIT 500",
  );
}

/** Met à jour le texte d'une dictée (édition en ligne). */
export async function updateDictationText(id: number, text: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE dictations SET text = $1 WHERE id = $2", [text, id]);
}

/** Épingle / désépingle une dictée. */
export async function setDictationPinned(id: number, pinned: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE dictations SET pinned = $1 WHERE id = $2", [pinned ? 1 : 0, id]);
}

/** Supprime une dictée par son id. */
export async function deleteDictation(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM dictations WHERE id = $1", [id]);
}
