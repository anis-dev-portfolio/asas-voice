import type { Readiness } from "../lib/readiness";
import { useUi } from "../store/ui";
import { ChevronRightIcon } from "./icons";

interface StatusPillProps {
  readiness: Readiness;
}

const LEVEL_LABEL: Record<Readiness["level"], string> = {
  ready: "Tout fonctionne",
  checking: "Vérification en cours",
  degraded: "Fonctionne, avec réserve",
  blocked: "Dictée indisponible",
};

/**
 * Verdict global (« Prêt », « Clé refusée »…) en pied de barre latérale. Cliquable quand
 * il y a quelque chose à corriger : mène directement à l'écran concerné.
 */
export function StatusPill({ readiness }: StatusPillProps) {
  const setScreen = useUi((s) => s.setScreen);
  const problem = readiness.items.find((i) => i.state === "error" || i.state === "warn");
  const fix = problem?.fix;
  const label = `État : ${readiness.headline}`;
  const actionable =
    Boolean(fix) && (readiness.level === "blocked" || readiness.level === "degraded");

  const content = (
    <>
      <span className={`statusdot statusdot--${readiness.level}`} aria-hidden="true" />
      <span className="status__text">
        <span className="status__headline">{readiness.headline}</span>
        <span className="status__detail">{LEVEL_LABEL[readiness.level]}</span>
      </span>
      {actionable && <ChevronRightIcon className="status__chevron" />}
    </>
  );

  if (actionable && fix) {
    return (
      <button
        type="button"
        className={`status status--${readiness.level} status--action`}
        onClick={() => setScreen(fix)}
        aria-label={`${label} — corriger`}
        title="Corriger"
      >
        {content}
      </button>
    );
  }
  return (
    <span className={`status status--${readiness.level}`} role="status" aria-label={label}>
      {content}
    </span>
  );
}
