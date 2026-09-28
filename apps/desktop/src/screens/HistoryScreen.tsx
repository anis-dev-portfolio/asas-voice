import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  EditIcon,
  ExportIcon,
  PinIcon,
  SearchIcon,
  TrashIcon,
} from "../components/icons";
import { copyText } from "../lib/paste";
import { exportHistory, type ExportFormat } from "../lib/export";
import { countWords, formatSeconds, formatTime, formatWords, groupByDay } from "../lib/format";
import type { DictationRow } from "../lib/history";
import { useHistory } from "../store/history";
import { toast } from "../store/toast";

interface ExportMenuProps {
  disabled: boolean;
  onExport: (format: ExportFormat) => void;
}

/** Menu « Exporter » : un bouton, deux formats. Se ferme au clic extérieur ou sur Échap. */
function ExportMenu({ disabled, onExport }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (format: ExportFormat): void => {
    setOpen(false);
    onExport(format);
  };

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ExportIcon />
        Exporter
        <ChevronDownIcon className="btn__chevron" />
      </button>
      {open && (
        <div className="menu__pop" role="menu">
          <button type="button" role="menuitem" className="menu__item" onClick={() => pick("txt")}>
            Texte brut <span className="menu__ext">.txt</span>
          </button>
          <button type="button" role="menuitem" className="menu__item" onClick={() => pick("md")}>
            Markdown <span className="menu__ext">.md</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Écran Historique : recherche, édition en ligne, copier, épingler, export. */
export function HistoryScreen() {
  const items = useHistory((s) => s.items);
  const search = useHistory((s) => s.search);
  const setSearch = useHistory((s) => s.setSearch);
  const reload = useHistory((s) => s.reload);
  const update = useHistory((s) => s.update);
  const togglePin = useHistory((s) => s.togglePin);
  const remove = useHistory((s) => s.remove);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  // Suppression en 2 clics : le 1er « arme » la corbeille (3 s), le 2e supprime.
  const [armedId, setArmedId] = useState<number | null>(null);
  const disarmTimer = useRef<number | null>(null);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(
    () => () => {
      if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    },
    [],
  );

  const pinned = useMemo(() => items.filter((i) => i.pinned === 1), [items]);
  const groups = useMemo(
    () =>
      groupByDay(
        items.filter((i) => i.pinned !== 1),
        (i) => i.created_at,
      ),
    [items],
  );

  const startEdit = (id: number, text: string): void => {
    setEditingId(id);
    setDraft(text);
  };

  const saveEdit = async (id: number): Promise<void> => {
    // Un texte vidé n'écrase pas la dictée : on annule l'édition.
    if (!draft.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await update(id, draft.trim());
      toast("Modification enregistrée");
    } catch {
      toast("Impossible d'enregistrer la modification", "warn");
    }
    setEditingId(null);
  };

  const handleDelete = (id: number): void => {
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    if (armedId === id) {
      setArmedId(null);
      void remove(id)
        .then(() => toast("Dictée supprimée", "info"))
        .catch(() => toast("Suppression impossible", "warn"));
      return;
    }
    setArmedId(id);
    disarmTimer.current = window.setTimeout(() => setArmedId(null), 3000);
  };

  const copy = (text: string): void => {
    void copyText(text)
      .then(() => toast("Copié dans le presse-papier"))
      .catch(() => toast("Impossible de copier", "warn"));
  };

  const doExport = (format: ExportFormat): void => {
    void exportHistory(items, format)
      .then((done) => {
        if (done) toast(`Historique exporté (.${format})`);
      })
      .catch(() => toast("Export impossible", "warn"));
  };

  const renderItem = (item: DictationRow) => {
    const editing = editingId === item.id;
    const armed = armedId === item.id;
    return (
      <li
        key={item.id}
        className={`entry ${item.pinned ? "is-pinned" : ""} ${editing ? "is-editing" : ""}`}
      >
        {editing ? (
          <textarea
            className="entry__edit selectable"
            value={draft}
            autoFocus
            aria-label="Texte de la dictée"
            rows={Math.min(10, Math.max(2, draft.split("\n").length + 1))}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditingId(null);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEdit(item.id);
            }}
          />
        ) : (
          <p className="entry__text selectable">{item.text}</p>
        )}
        <div className="entry__foot">
          <span className="meta num">
            {item.pinned === 1 && <PinIcon className="entry__pin" aria-label="Épinglée" />}
            {formatTime(item.created_at)} · {formatSeconds(item.duration_sec)} ·{" "}
            {formatWords(countWords(item.text))}
          </span>
          <div className="entry__actions">
            {editing ? (
              <>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label="Annuler"
                  title="Annuler (Échap)"
                  onClick={() => setEditingId(null)}
                >
                  <CloseIcon />
                </button>
                <button
                  type="button"
                  className="iconbtn iconbtn--on"
                  aria-label="Enregistrer"
                  title="Enregistrer (Ctrl + Entrée)"
                  onClick={() => void saveEdit(item.id)}
                >
                  <CheckIcon />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`iconbtn ${item.pinned ? "iconbtn--on" : ""}`}
                  aria-label={item.pinned ? "Désépingler" : "Épingler"}
                  title={item.pinned ? "Désépingler" : "Épingler en haut"}
                  aria-pressed={item.pinned === 1}
                  onClick={() => void togglePin(item.id, item.pinned !== 1)}
                >
                  <PinIcon />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label="Copier"
                  title="Copier"
                  onClick={() => copy(item.text)}
                >
                  <CopyIcon />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label="Modifier"
                  title="Modifier"
                  onClick={() => startEdit(item.id, item.text)}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className={`iconbtn iconbtn--danger ${armed ? "iconbtn--armed" : ""}`}
                  aria-label={armed ? "Confirmer la suppression" : "Supprimer"}
                  title={armed ? "Cliquez à nouveau pour supprimer" : "Supprimer"}
                  onClick={() => handleDelete(item.id)}
                >
                  <TrashIcon />
                  {armed && <span className="iconbtn__label">Confirmer</span>}
                </button>
              </>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="screen screen--history">
      <header className="screen__head">
        <div>
          <h1 className="screen__title">Historique</h1>
          <p className="screen__lede">
            {items.length === 0
              ? "Chaque dictée est gardée ici, sur ce PC uniquement."
              : `${items.length} dictée${items.length > 1 ? "s" : ""}${search ? " trouvée" + (items.length > 1 ? "s" : "") : ""} · stockées sur ce PC uniquement`}
          </p>
        </div>
        <ExportMenu disabled={items.length === 0} onExport={doExport} />
      </header>

      <label className="searchfield">
        <SearchIcon />
        <input
          type="search"
          placeholder="Rechercher un mot, une phrase…"
          value={search}
          aria-label="Rechercher dans l'historique"
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </label>

      {items.length === 0 ? (
        <div className="empty">
          <span className="empty__glyph" aria-hidden="true">
            <SearchIcon />
          </span>
          <p className="empty__title">
            {search ? "Aucune dictée ne correspond." : "Aucune dictée pour l'instant."}
          </p>
          <p className="empty__text">
            {search
              ? "Essayez un autre mot, ou effacez la recherche."
              : "Vos dictées s'ajoutent ici automatiquement, avec leur date et leur durée."}
          </p>
        </div>
      ) : (
        <div className="history">
          {pinned.length > 0 && (
            <section className="daygroup" aria-label="Épinglées">
              <h2 className="daygroup__title">Épinglées</h2>
              <ul className="entries">{pinned.map(renderItem)}</ul>
            </section>
          )}
          {groups.map((g) => (
            <section key={g.label} className="daygroup" aria-label={g.label}>
              <h2 className="daygroup__title">{g.label}</h2>
              <ul className="entries">{g.items.map(renderItem)}</ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
