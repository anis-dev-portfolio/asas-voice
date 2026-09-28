import { useEffect, useState, type UIEvent } from "react";
import { BackendBanner } from "./components/BackendBanner";
import { Sidebar } from "./components/Sidebar";
import { Toaster } from "./components/Toaster";
import { Toolbar } from "./components/Toolbar";
import { DictationScreen } from "./screens/DictationScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { EnginesScreen } from "./screens/EnginesScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { Onboarding } from "./screens/Onboarding";
import { useDictation } from "./lib/useDictation";
import { startMainVisibilitySync, startOrbVisibilitySync } from "./lib/windowSync";
import { useSettings } from "./store/settings";
import { startSystemMonitor } from "./store/system";
import { useUi, type Screen } from "./store/ui";

const SCREEN_TITLE: Record<Screen, string> = {
  dictation: "Dictée",
  history: "Historique",
  engines: "Moteurs",
  settings: "Réglages",
};

/** Au-delà de ce défilement, le grand titre cède la place au titre condensé de la barre. */
const CONDENSE_AT = 34;

/**
 * Coque Asas Voice : barre latérale pleine hauteur (marque, navigation, état), barre
 * d'outils translucide au-dessus du contenu qui défile, 4 écrans. La hardiesse va dans
 * l'orbe ; tout le reste est calme. Au premier lancement, l'onboarding remplace la coque.
 */
function App() {
  const controls = useDictation(); // raccourci global + clic sur l'orbe
  const theme = useSettings((s) => s.theme);
  const onboardingComplete = useSettings((s) => s.onboardingComplete);
  const screen = useUi((s) => s.screen);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Surveillance (santé, clés, micros), visibilité des fenêtres, orbe flottante.
  useEffect(() => {
    const stops = [startSystemMonitor(), startMainVisibilitySync(), startOrbVisibilitySync()];
    return () => stops.forEach((stop) => stop());
  }, []);

  // Changement d'écran : on repart du haut, grand titre visible.
  useEffect(() => setScrolled(false), [screen]);

  const onScroll = (e: UIEvent<HTMLElement>): void => {
    const next = e.currentTarget.scrollTop > CONDENSE_AT;
    if (next !== scrolled) setScrolled(next);
  };

  if (!onboardingComplete) {
    return (
      <div className="window window--bare is-opening">
        <Toolbar title={null} scrolled={false} />
        <Onboarding />
        <Toaster />
      </div>
    );
  }

  return (
    <div className="window is-opening">
      <Sidebar />
      <div className="stage">
        <Toolbar title={screen === "dictation" ? null : SCREEN_TITLE[screen]} scrolled={scrolled} />
        <main className="content" onScroll={onScroll}>
          <BackendBanner />
          <div className="screen-host" key={screen}>
            {screen === "dictation" && <DictationScreen controls={controls} />}
            {screen === "history" && <HistoryScreen />}
            {screen === "engines" && <EnginesScreen />}
            {screen === "settings" && <SettingsScreen />}
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}

export default App;
