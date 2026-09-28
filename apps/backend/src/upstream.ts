/**
 * Helpers défensifs pour interpréter les erreurs des SDK upstream (Mistral, Anthropic)
 * sans recourir à `any`. Partagés par les routes /transcribe et /postprocess.
 */

/** Accès défensif à une propriété d'une valeur de type `unknown`. */
export function getProp(value: unknown, key: string): unknown {
  if (typeof value === "object" && value !== null && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

/** Lit un en-tête (nom en minuscules) depuis un objet `Headers` (fetch) ou un simple record. */
export function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  const getter = getProp(headers, "get");
  if (typeof getter === "function") {
    const value = (getter as (n: string) => unknown).call(headers, name);
    if (typeof value === "string") return value;
  }
  const direct = getProp(headers, name);
  if (typeof direct === "string") return direct;
  if (typeof direct === "number") return String(direct);
  return undefined;
}

/**
 * Extrait le délai `Retry-After` (en secondes) d'une erreur upstream 429, si présent.
 * Les SDK exposent les en-têtes de plusieurs façons → on reste défensif. Un
 * `Retry-After` au format date HTTP donne NaN et est ignoré (undefined).
 */
export function extractRetryAfter(err: unknown): number | undefined {
  const sources = [
    getProp(err, "headers"),
    getProp(getProp(err, "rawResponse"), "headers"),
    getProp(getProp(err, "response"), "headers"),
  ];
  for (const headers of sources) {
    const raw = readHeader(headers, "retry-after");
    if (raw === undefined) continue;
    const sec = Number(raw);
    if (Number.isFinite(sec) && sec >= 0) return Math.ceil(sec);
  }
  return undefined;
}
