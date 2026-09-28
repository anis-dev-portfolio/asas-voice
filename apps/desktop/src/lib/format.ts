/** Formats d'affichage (français), purs et testés. */

/** « 1,4 s », « 320 ms » : une durée courte lisible. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 950) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}

/** « 3,2 s » à partir de secondes (durée d'audio). */
export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  return `${sec.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}

/** Nombre de mots d'un texte (séparés par des espaces). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/** « 1 mot », « 12 mots ». */
export function formatWords(n: number): string {
  return `${n} ${n > 1 ? "mots" : "mot"}`;
}

/** « à l'instant », « il y a 3 min », « il y a 2 h », sinon la date. */
export function formatRelative(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < 45_000) return "à l'instant";
  const min = Math.round(diff / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(diff / 3_600_000);
  if (h < 24) return `il y a ${h} h`;
  return new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Heure « 14:32 ». */
export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Libellé de jour pour grouper l'historique : « Aujourd'hui », « Hier », « lundi 22 septembre ». */
export function dayLabel(at: number, now: number = Date.now()): string {
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Regroupe des éléments datés par jour, dans l'ordre reçu (déjà trié). */
export function groupByDay<T>(
  items: T[],
  dateOf: (item: T) => number,
  now: number = Date.now(),
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(dateOf(item), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
