import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import type { TranscriptionLanguage } from "@asas-voice/shared";
import { Group, Segmented, SettingRow, Switch } from "../components/controls";
import { ShortcutField } from "../components/ShortcutField";
import {
  BookIcon,
  KeyboardIcon,
  MicIcon,
  OrbIcon,
  PlayIcon,
  PowerIcon,
  TargetIcon,
  TextIcon,
} from "../components/icons";
import { VocabularyEditor } from "../components/VocabularyEditor";
import { VuMeter } from "../components/VuMeter";
import { previewDelivery } from "../lib/paste";
import { useMicrophones } from "../lib/useMicrophones";
import { useVuMeter } from "../lib/useVuMeter";
import { useSettings } from "../store/settings";
import { refreshMicState } from "../store/system";
import { toast } from "../store/toast";

const LANGUAGES: { value: TranscriptionLanguage; label: string }[] = [
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
  { value: "ar", label: "Arabe" },
  { value: "es", label: "Espagnol" },
  { value: "de", label: "Allemand" },
  { value: "it", label: "Italien" },
  { value: "auto", label: "Détection automatique" },
];

/** Commandes vocales reconnues (miroir de lib/postprocess, pour les rendre découvrables). */
const VOICE_COMMANDS: [string, string][] = [
  ["« virgule », « point », « deux points »", ", . :"],
  ["« point d'interrogation », « point d'exclamation »", "? !"],
  ["« nouvelle ligne », « à la ligne »", "retour à la ligne"],
  ["« nouveau paragraphe »", "ligne vide"],
  ["« ouvre / ferme la parenthèse »", "( )"],
  ["« ouvre / ferme les guillemets »", "« »"],
  ["« supprime ça »", "efface le mot précédent"],
];

/**
 * Aperçu de l'effet « livraison » : la comète part de l'orbe flottante et illumine, ligne
 * par ligne, le texte de démonstration — exactement ce qui se passe au curseur.
 */
function DeliveryPreview({ enabled }: { enabled: boolean }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [busy, setBusy] = useState(false);

  const play = async (): Promise<void> => {
    const el = textRef.current;
    if (!el || busy) return;
    setBusy(true);
    try {
      const win = getCurrentWindow();
      const [pos, scale] = await Promise.all([win.innerPosition(), win.scaleFactor()]);
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = Array.from(range.getClientRects()).map((r) => ({
        x: pos.x + r.left * scale,
        y: pos.y + r.top * scale,
        w: r.width * scale,
        h: r.height * scale,
      }));
      await previewDelivery(lines);
    } catch {
      toast("Aperçu indisponible", "warn");
    } finally {
      window.setTimeout(() => setBusy(false), 1400);
    }
  };

  return (
    <div className={`deliverydemo ${enabled ? "" : "is-off"}`}>
      <p className="deliverydemo__field">
        <span ref={textRef} className="deliverydemo__text">
          Bonjour Camille, je te confirme le rendez-vous de jeudi à 14 h.
        </span>
        <span className="deliverydemo__caret" aria-hidden="true" />
      </p>
      <button type="button" className="btn" onClick={() => void play()} disabled={!enabled || busy}>
        <PlayIcon />
        Voir l'aperçu
      </button>
    </div>
  );
}

/** Écran Réglages : dictée, micro, texte, vocabulaire, orbe, système. */
export function SettingsScreen() {
  const settings = useSettings();
  const { devices, permission, requestAccess, refresh } = useMicrophones();
  const [testing, setTesting] = useState(false);
  const level = useVuMeter(settings.selectedMicId, testing);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [showCommands, setShowCommands] = useState(false);

  useEffect(() => {
    void isEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(null));
  }, []);

  // Le test du micro s'arrête en quittant l'écran (useVuMeter libère le flux).
  useEffect(() => () => setTesting(false), []);

  async function toggleAutostart(next: boolean): Promise<void> {
    try {
      if (next) await enable();
      else await disable();
      setAutostart(await isEnabled());
      toast(
        next ? "Asas Voice démarrera avec Windows" : "Démarrage automatique désactivé",
        next ? "ok" : "info",
      );
    } catch {
      toast("Impossible de modifier le démarrage automatique", "warn");
    }
  }

  async function onRequestMic(): Promise<void> {
    await requestAccess();
    // Met à jour l'état « Prêt » (micro autorisé / détecté).
    await refreshMicState();
  }

  return (
    <div className="screen screen--settings">
      <header className="screen__head">
        <div>
          <h1 className="screen__title">Réglages</h1>
          <p className="screen__lede">Tout est enregistré automatiquement.</p>
        </div>
      </header>

      <Group id="g-dictee" title="Dictée" Icon={KeyboardIcon} tone="violet">
        <SettingRow label="Raccourci" hint="Fonctionne partout, même quand Asas Voice est réduite.">
          <ShortcutField />
        </SettingRow>
        <SettingRow
          label="Comportement"
          hint={
            settings.dictationMode === "hold"
              ? "Maintenez le raccourci pendant que vous parlez, relâchez pour terminer."
              : "Un appui démarre, un second appui termine — pratique pour les longues dictées."
          }
          stacked
        >
          <Segmented
            block
            ariaLabel="Comportement du raccourci"
            value={settings.dictationMode}
            onChange={settings.setDictationMode}
            options={[
              { value: "hold", label: "Maintenir pour parler" },
              { value: "toggle", label: "Appuyer pour démarrer / arrêter" },
            ]}
          />
        </SettingRow>
        <SettingRow
          label="Où va le texte"
          hint={
            settings.outputMode === "cursor"
              ? "Collé directement là où se trouve votre curseur."
              : "Copié dans le presse-papier : collez-le vous-même avec Ctrl + V."
          }
        >
          <Segmented
            ariaLabel="Sortie du texte"
            value={settings.outputMode}
            onChange={settings.setOutputMode}
            options={[
              { value: "cursor", label: "Au curseur" },
              { value: "clipboard", label: "Presse-papier" },
            ]}
          />
        </SettingRow>
      </Group>

      <Group id="g-micro" title="Microphone" Icon={MicIcon} tone="peach">
        {permission === "denied" && (
          <div className="row">
            <p className="fieldmsg fieldmsg--error">
              Windows bloque l'accès au micro. Ouvrez Paramètres › Confidentialité › Microphone,
              autorisez les applications de bureau, puis cliquez sur « Rafraîchir la liste ».
            </p>
          </div>
        )}
        <SettingRow label="Micro utilisé">
          <select
            className="select"
            value={settings.selectedMicId ?? ""}
            onChange={(e) => settings.setSelectedMic(e.currentTarget.value || null)}
            aria-label="Micro utilisé"
          >
            <option value="">Micro par défaut de Windows</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <div className="row row--stacked">
          <div className="mictest">
            <VuMeter level={level} active={testing} />
            <div className="mictest__actions">
              <button
                type="button"
                className={`btn ${testing ? "btn--live" : ""}`}
                onClick={() => setTesting((v) => !v)}
                aria-pressed={testing}
              >
                {testing ? "Arrêter le test" : "Tester le micro"}
              </button>
              {permission !== "granted" ? (
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => void onRequestMic()}
                >
                  Autoriser le micro
                </button>
              ) : (
                <button type="button" className="btn btn--quiet" onClick={() => void refresh()}>
                  Rafraîchir la liste
                </button>
              )}
            </div>
          </div>
        </div>
      </Group>

      <Group id="g-texte" title="Texte" Icon={TextIcon} tone="indigo">
        <SettingRow label="Langue parlée" hint="Indiquer la langue améliore la précision.">
          <select
            className="select"
            value={settings.language}
            onChange={(e) => settings.setLanguage(e.currentTarget.value as TranscriptionLanguage)}
            aria-label="Langue parlée"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <Switch
          checked={settings.autoFormat}
          onChange={settings.setAutoFormat}
          label="Ponctuation et majuscules automatiques"
          hint="Nettoie les espaces et met une majuscule en début de phrase."
        />
        <Switch
          checked={settings.voiceCommands}
          onChange={settings.setVoiceCommands}
          label="Commandes vocales"
          hint={
            <>
              Dites « virgule », « nouvelle ligne »… pour ponctuer à la voix.{" "}
              {settings.voiceCommands && (
                <button
                  type="button"
                  className="linkbtn"
                  aria-expanded={showCommands}
                  onClick={(e) => {
                    e.preventDefault();
                    setShowCommands((v) => !v);
                  }}
                >
                  {showCommands ? "Masquer la liste" : "Voir la liste"}
                </button>
              )}
            </>
          }
        />
        {settings.voiceCommands && showCommands && (
          <div className="row row--stacked">
            <table className="cmdtable">
              <tbody>
                {VOICE_COMMANDS.map(([say, gives]) => (
                  <tr key={say}>
                    <td>{say}</td>
                    <td className="cmdtable__out">{gives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Group>

      <Group
        id="g-vocab"
        title="Vocabulaire personnalisé"
        Icon={BookIcon}
        tone="rose"
        lede="Noms propres, marques, jargon : ces termes sont privilégiés à la reconnaissance."
      >
        <div className="row row--stacked">
          <VocabularyEditor />
        </div>
      </Group>

      <Group id="g-orbe" title="Orbe flottante" Icon={OrbIcon} tone="spectral">
        <SettingRow
          label="Affichage"
          hint={
            settings.orbVisibility === "always"
              ? "Toujours à l'écran, au-dessus des fenêtres. Glissez-la où vous voulez ; touchez-la pour ouvrir Asas Voice."
              : "Apparaît uniquement pendant une dictée, puis s'efface."
          }
        >
          <Segmented
            ariaLabel="Affichage de l'orbe"
            value={settings.orbVisibility}
            onChange={settings.setOrbVisibility}
            options={[
              { value: "always", label: "Toujours" },
              { value: "dictation", label: "Pendant la dictée" },
            ]}
          />
        </SettingRow>
        <Switch
          checked={settings.deliveryAnimation}
          onChange={settings.setDeliveryAnimation}
          label="Animation d'insertion"
          hint="Au collage, l'orbe lance le texte vers votre curseur et il s'illumine en violet. Purement visuel : le texte arrive exactement aussi vite, animation ou non."
        />
        <div className="row row--stacked">
          <DeliveryPreview enabled={settings.deliveryAnimation} />
        </div>
        <div className="row">
          <div className="row__text">
            <span className="row__label">Position</span>
            <span className="row__hint">Replace l'orbe en bas au centre de l'écran principal.</span>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void invoke("reset_orb_position")
                .then(() => toast("Orbe replacée en bas de l'écran"))
                .catch(() => toast("Impossible de replacer l'orbe", "warn"))
            }
          >
            <TargetIcon />
            Recentrer
          </button>
        </div>
      </Group>

      <Group id="g-systeme" title="Système" Icon={PowerIcon} tone="graphite">
        <Switch
          checked={autostart ?? false}
          onChange={(v) => void toggleAutostart(v)}
          disabled={autostart === null}
          label="Lancer au démarrage de Windows"
          hint="Démarre discrètement, réduite dans la barre des tâches : l'orbe et le raccourci sont prêts."
        />
        <SettingRow label="Apparence">
          <Segmented
            ariaLabel="Thème"
            value={settings.theme}
            onChange={settings.setTheme}
            options={[
              { value: "dark", label: "Sombre" },
              { value: "light", label: "Clair" },
            ]}
          />
        </SettingRow>
      </Group>
    </div>
  );
}
