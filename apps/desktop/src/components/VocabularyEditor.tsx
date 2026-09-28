import { useState } from "react";
import { CloseIcon, PlusIcon } from "./icons";
import { MAX_VOCABULARY, mergeTerms, splitTerms } from "../lib/vocabulary";
import { useSettings } from "../store/settings";

/**
 * Éditeur de vocabulaire personnalisé. Les termes sont passés en context biasing à la
 * transcription pour mieux reconnaître noms propres et jargon. Voxtral n'accepte que des
 * mots : une expression saisie est découpée en mots, et on le montre.
 */
export function VocabularyEditor() {
  const vocabulary = useSettings((s) => s.vocabulary);
  const setVocabulary = useSettings((s) => s.setVocabulary);
  const [input, setInput] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const add = (): void => {
    const words = splitTerms(input);
    if (words.length === 0) return;
    const next = mergeTerms(vocabulary, words);
    const added = next.length - vocabulary.length;
    setVocabulary(next);
    setInput("");
    if (words.length > 1) {
      setNote(`Ajouté mot par mot : ${words.join(" · ")}`);
    } else if (added === 0) {
      setNote(
        next.length >= MAX_VOCABULARY
          ? "Limite de 100 termes atteinte."
          : "Ce terme est déjà dans la liste.",
      );
    } else {
      setNote(null);
    }
  };

  const remove = (term: string): void => {
    setVocabulary(vocabulary.filter((t) => t !== term));
    setNote(null);
  };

  return (
    <div className="vocab">
      <form
        className="vocab__row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="textinput"
          type="text"
          placeholder="Ex. : Weyda, Asas, Jean-Pierre"
          value={input}
          maxLength={200}
          aria-label="Ajouter des termes"
          onChange={(e) => setInput(e.currentTarget.value)}
        />
        <button
          type="submit"
          className="btn"
          disabled={!input.trim() || vocabulary.length >= MAX_VOCABULARY}
        >
          <PlusIcon />
          Ajouter
        </button>
      </form>
      <p className="vocab__hint">
        Un mot par terme : une expression comme « Asas Voice » est ajoutée mot par mot (« Asas », «
        Voice »).
      </p>
      {note && <p className="fieldmsg">{note}</p>}

      {vocabulary.length > 0 && (
        <ul className="vocab__chips">
          {vocabulary.map((term) => (
            <li key={term} className="chip">
              <span className="selectable">{term}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={`Retirer ${term}`}
                onClick={() => remove(term)}
              >
                <CloseIcon width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="vocab__count num">
        {vocabulary.length}/{MAX_VOCABULARY} termes
      </span>
    </div>
  );
}
