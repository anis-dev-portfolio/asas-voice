# Asas Voice — design

## Direction : l'orbe-instrument, fini comme un logiciel de constructeur

L'identité repose sur **un seul objet** : l'orbe. Un cœur liquide au dégradé spectral
(pêche → rose → violet → indigo), éclairé en haut à gauche, dans un **anneau de 60
graduations** — un cadran de précision. Au repos, le cadran est calme (4 repères
cardinaux). À l'écoute, il devient un analyseur de spectre circulaire (graves en bas, aigus
en haut) avec crêtes mémorisées. Pendant la transcription, une comète fait le tour. À la
confirmation, un balayage et une onde ; en cas d'erreur, l'anneau vire à l'ambre et le cœur
« secoue la tête ».

La matière est un **verre** : deux nappes de liquide tournent à l'intérieur quand l'orbe
travaille, la lumière traverse et ressort en bas, le bord opposé à la source s'assombrit
(volume), un reflet net dit « verre » plutôt que « dégradé ». L'orbe flottante porte une ombre
douce et des graduations cernées d'un halo fin : lisible sur un document blanc comme sur un
éditeur sombre.

- Rendu : [`src/orb/orb.ts`](../src/orb/orb.ts) · physique (membrane à ressorts, testée) :
  [`src/orb/physics.ts`](../src/orb/physics.ts).
- Sobriété : immobile au repos (zéro image), plein régime seulement quand il se passe quelque
  chose, arrêt total fenêtre cachée.

## Signature : la livraison au curseur

Au collage, l'orbe **lance** le texte : jet de matière et recul du cœur dans la direction du
curseur, graduations qui s'embrasent de ce côté ; une comète (tête blanche, halo spectral,
traîne violette, étincelles pêche et lavande) suit une trajectoire bombée et se pose au point
d'insertion ; le texte collé s'illumine alors en **encre violette**, ligne par ligne, au
rythme de l'écriture, puis s'efface. La même encre apparaît sur « Dernière dictée » dans
l'app.

- Où est le texte : [`src-tauri/src/caret.rs`](../src-tauri/src/caret.rs) (UI Automation,
  MSAA, caret système) · géométrie et chronologie testées :
  [`src-tauri/src/delivery.rs`](../src-tauri/src/delivery.rs) · rendu natif :
  [`src-tauri/src/fx.rs`](../src-tauri/src/fx.rs).
- Zéro latence : le collage n'attend jamais l'effet. Désactivable (Réglages › Orbe flottante),
  coupé si Windows désactive les effets d'animation.
- Planche de réglage visuel : `cargo test --lib fx::tests::planche -- --ignored` →
  `src-tauri/target/fx-planche.png`.

## Interface

Finition de logiciel de constructeur, tout le reste discipliné :

- **Une seule famille** : Inter (variable, tailles optiques — les grands titres passent en coupe
  « Display »), graisses mesurées, approche serrée sur les titres.
- **Matières** : canvas encre (jamais de noir pur), groupes en verre à peine teinté avec un
  liseré de lumière sur l'arête haute, filets 0,5 px. Barre d'outils translucide sur le contenu
  qui défile ; le grand titre cède la place à un titre condensé.
- **Mouvement** : ressorts (`--spring`, `--spring-soft` via `linear()`), indicateur de
  navigation et curseurs de sélecteurs segmentés qui glissent, interrupteurs qui s'étirent à la
  pression, statut en fondu enchaîné, toasts en HUD.
- **Couleurs** : deux accents, chacun avec un rôle : **violet = structure et encre**
  (navigation, focus, sélection, texte livré), **pêche = voix** (écoute, spectre). Tuiles
  d'icônes colorées en en-tête de groupe.

Tokens : [`src/styles/tokens.css`](../src/styles/tokens.css) · styles :
[`src/styles/app.css`](../src/styles/app.css).

## Icônes

Sources générées : [`icon/generate.py`](./icon/generate.py) (SVG maître 1024, variante
simplifiée lisible à 16–64 px, marque, icônes de tray repos/écoute).

```bash
python apps/desktop/design/icon/generate.py
node apps/desktop/design/icon/render.mjs        # rastérise via Edge headless + assemble icon.ico
cd apps/desktop && pnpm tauri icon design/asas-voice-icon-master.png
cp design/icon/out/icon.ico src-tauri/icons/icon.ico   # .ico multi-variantes (petites tailles nettes)
```

`asas-voice-prototype-da.html` (racine du dépôt) reste la trace de la DA d'origine.
