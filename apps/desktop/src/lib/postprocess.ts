/*
 * Post-traitement client du texte transcrit :
 *  - commandes vocales d'édition (P2.6) : « nouvelle ligne », « point », « virgule »,
 *    « supprime ça »… reconnues côté client pour passer de la dictée au contrôle vocal.
 *  - mise en forme automatique (P2.4) : ponctuation/espaces propres + majuscules.
 *
 * Tout est en français (langue d'usage). L'ordre compte : commandes d'abord,
 * puis nettoyage des espaces, puis majuscules.
 */

interface CommandRule {
  /** Motif à reconnaître (insensible casse/accents, sur frontière de mot). */
  pattern: RegExp;
  /** Remplacement (symbole ou saut de ligne). */
  replace: string;
}

// \b ne gère pas bien les accents : on encadre par début/espace et fin/espace/ponctuation.
function phrase(words: string): RegExp {
  return new RegExp(`(^|\\s)(?:${words})(?=$|\\s|[.,!?;:])`, "giu");
}

const COMMAND_RULES: CommandRule[] = [
  { pattern: phrase("nouveau paragraphe"), replace: "\n\n" },
  {
    pattern: phrase("nouvelle ligne|à la ligne|a la ligne|saut de ligne|retour à la ligne"),
    replace: "\n",
  },
  { pattern: phrase("points? de suspension|trois points"), replace: "…" },
  { pattern: phrase("point d['’]interrogation"), replace: "?" },
  { pattern: phrase("point d['’]exclamation"), replace: "!" },
  { pattern: phrase("points? d['’]exclamation"), replace: "!" },
  { pattern: phrase("deux[- ]points"), replace: ":" },
  { pattern: phrase("point[- ]virgule"), replace: ";" },
  { pattern: phrase("virgule"), replace: "," },
  // « point » seul est une commande, mais pas dans « point de vue », « point du jour »,
  // « point d'accès »… (lookahead négatif sur de/du/des — mots entiers — et d').
  { pattern: phrase("point final|point(?!\\s+(?:(?:de|du|des)(?=$|\\s)|d[’']))"), replace: "." },
  { pattern: phrase("ouvre(?:z)? la parenthèse|ouvre(?:z)? parenthèse"), replace: " (" },
  { pattern: phrase("ferme(?:z)? la parenthèse|ferme(?:z)? parenthèse"), replace: ")" },
  { pattern: phrase("ouvre(?:z)? les guillemets"), replace: " «" },
  { pattern: phrase("ferme(?:z)? les guillemets"), replace: "»" },
  { pattern: phrase("tiret"), replace: "-" },
];

// « mot supprime ça » → retire le mot précédent ET la commande.
const DELETE_PREV = /(\S+)\s+(?:supprime|efface)\s+(?:ça|ca|cela)(?=$|\s|[.,!?;:])/giu;
// « supprime ça » isolé → retire juste la commande.
const DELETE_BARE = /(^|\s)(?:supprime|efface)\s+(?:ça|ca|cela)(?=$|\s|[.,!?;:])/giu;

/** Applique les commandes vocales d'édition au texte transcrit. */
export function applyVoiceCommands(text: string): string {
  let out = text;
  out = out.replace(DELETE_PREV, "");
  out = out.replace(DELETE_BARE, "$1");
  for (const rule of COMMAND_RULES) {
    out = out.replace(rule.pattern, (_m, lead: string) => {
      // Pas d'espace de tête devant une ponctuation collante ni un saut de ligne.
      const glued = /^[.,!?;:)…»]/.test(rule.replace) || rule.replace.startsWith("\n");
      return (glued ? "" : lead) + rule.replace;
    });
  }
  return out;
}

/** Nettoyage des espaces + majuscules de début de phrase. */
export function applyAutoFormat(text: string): string {
  let out = text;
  // Espaces multiples → un seul (hors sauts de ligne).
  out = out.replace(/[^\S\n]+/g, " ");
  // Pas d'espace résiduel autour d'un saut de ligne (laissé par « nouvelle ligne »).
  out = out.replace(/[^\S\n]*\n[^\S\n]*/g, "\n");
  // Pas d'espace avant une ponctuation collante.
  out = out.replace(/\s+([.,!?;:)…»])/g, "$1");
  // Un espace après . , ! ? : ; s'il manque (sauf fin / chiffre décimal).
  out = out.replace(/([.,!?;:])(?=[^\s\d.,!?;:)»])/g, "$1 ");
  // Espace après une parenthèse/guillemet ouvrants supprimé.
  out = out.replace(/([(«])\s+/g, "$1");
  out = out.trim();
  // Majuscule en début de texte et après . ! ? ou saut de ligne.
  out = out.replace(
    /(^|[.!?]\s+|\n\s*)(\p{Ll})/gu,
    (_m, lead: string, ch: string) => lead + ch.toUpperCase(),
  );
  return out;
}

/**
 * Pipeline complet selon les réglages.
 * @param voiceCommands applique les commandes d'édition vocale.
 * @param autoFormat applique la mise en forme automatique.
 */
export function postProcess(
  text: string,
  options: { voiceCommands: boolean; autoFormat: boolean },
): string {
  let out = text;
  if (options.voiceCommands) out = applyVoiceCommands(out);
  if (options.autoFormat) out = applyAutoFormat(out);
  return out;
}
