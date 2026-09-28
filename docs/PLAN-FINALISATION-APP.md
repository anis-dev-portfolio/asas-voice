# Plan de finalisation — Logiciel Asas Voice (85 % → 100 %)

> **Pour la prochaine session Claude Code.** Ce document est auto-suffisant : il ne dépend
> d'aucune conversation antérieure. Lis d'abord l'audit : [`AUDIT-2026-07-17.md`](./AUDIT-2026-07-17.md).
>
> **Objectif unique de ce plan : amener LE LOGICIEL à 100 %.** Pas la distribution, pas la vente.
> Quand ce plan est terminé, Asas Voice est un logiciel Windows *fini* : complet, robuste, testé,
> vérifié de bout en bout — prêt à entrer dans la phase distribution/commercialisation (séparée).

---

## État d'avancement — session 2026-07-17

Réalisé et **vérifié** (`pnpm typecheck` + `pnpm lint` + `pnpm test` : 74 tests ;
`cargo check` + `cargo test` : 2 tests — tous verts) :

- **F0** ✅ WIP figé en commits cohérents · versions unifiées 0.1.0 · installeurs périmés
  purgés · baseline verte.
- **F1** ✅ backend durci : `/postprocess` (try/catch, timeout, borne d'entrée, en-tête,
  modèle `claude-haiku-4-5`), 429→`rate_limited`+Retry-After (2 routes), graceful shutdown,
  `/health` enrichi, fournisseurs STT fantômes retirés (Voxtral seul).
- **F2** ✅ bandeau « backend introuvable » + relance (F2.1, commande Rust `restart_backend`
  compilée) · durée max 55 s (F2.2) · gardes MediaRecorder/AudioContext (F2.3) · **export
  via dialogue natif « Enregistrer sous » (F2.4, tauri-plugin-dialog + `save_text_file`)** ·
  revue états écrans (F2.5, déjà mûrs).
- **F3** ✅ Vitest backend (mapping erreurs, validation) + libs front (postprocess, history,
  recorder, transcribeClient, export) · **tests Rust `save_text_file` (F3.4)** ·
  `pnpm -r test` vert (F3.5).
- **F4** ✅ scripts dev assainis/documentés (F4.3) · README à jour (F4.4).

Reste à faire — **demande l'app GUI en marche (humain)** :

- **F4.1** VAD / mode continu intelligent (stretch, amélioration, pas une lacune).
- **F4.2** passe visuelle clair/sombre sur tous les écrans.
- **F5** QA de bout en bout : lancer `pnpm dev:desktop` et cocher la checklist ci-dessous
  (dictée push-to-talk réelle, collage au curseur, tray, etc.).

> Note build : si `cargo`/`tauri-build` renvoie `PermissionDenied`, c'est un
> `asas-voice-backend.exe` **orphelin** qui verrouille `target` → `taskkill //PID <pid> //F`.

---

## Session 2026-09-24 — fiabilité visible, refonte de l'identité, sobriété 24/7

Réalisé et **vérifié** (typecheck + lint + 135 tests JS + 6 tests Rust + clippy ; app lancée,
chaque écran inspecté ; vérification réelle des clés et transcription réelle via le service) :

- **Faux choix supprimé** : « Standard / Précision » envoyait le même modèle. Il n'existe qu'un
  modèle de transcription Mistral (`voxtral-mini-latest`) → écran **Moteurs** honnête.
- **Vérification réelle des clés** : `GET /engines`, `POST /engines/verify` (`models.retrieve`
  Mistral + Anthropic, gratuit). Codes `invalid_api_key` distincts. Libellé « Claude Sonnet »
  corrigé (c'est Haiku 4.5 qui tourne).
- **Bug vocabulaire** : Voxtral refuse (HTTP 400) tout terme avec espace/virgule → toute dictée
  échouait dès qu'une expression était enregistrée. Découpage en mots (backend + UI +
  migration réglages v3).
- **Bug raccourci** : course enregistrement/désenregistrement → faux « raccourci déjà pris ».
  Opérations sérialisées.
- **État « Prêt »** calculé (`lib/readiness.ts`) + **chaîne de dictée** étape par étape + toasts.
- **Orbe** réécrite : membrane physique, anneau de mesure (spectre), états lisibles ; immobile au
  repos, pause réelle fenêtre cachée ; clic-traversant hors du disque ; position mémorisée
  multi-écran ; mode « pendant la dictée ».
- **CPU au repos** (fenêtre dans le tray) : ~53–61 % d'un cœur avant → voir mesure finale.
- Démarrage Windows réduit dans le tray ; tray : clic gauche = ouvrir, icône allumée à l'écoute.
- Nouvelle icône (orbe-instrument) : `apps/desktop/design/icon/`.

## Session 2026-09-25 — finition « grande marque » + effet de livraison au curseur

Réalisé et **vérifié** (typecheck + lint + 80 tests JS + 16 tests Rust + clippy ; UI capturée en
sombre / clair / fenêtre étroite ; effet natif testé en collage réel dans RichEdit et Edge) :

- **Effet « livraison »** (`src-tauri/src/fx.rs`, `caret.rs`, `delivery.rs`) : au collage, une
  comète part de l'orbe vers le point d'insertion, puis le texte collé s'illumine en violet
  ligne par ligne. Texte localisé par UI Automation (rectangles exacts), sinon caret MSAA /
  système + estimation. Fenêtre native superposée (tiny-skia + UpdateLayeredWindow), sans
  webview, inexistante au repos. **Zéro latence** : sonde pendant la pause existante, comète au
  signal Ctrl+V (`paste_text` rend la main en ~80 ms comme avant). Réglage + aperçu.
- **Orbe** : réaction au lancer (jet de matière, recul, graduations), liquide intérieur, lumière
  transmise, ombre de volume, reflet net ; orbe flottante lisible sur fond blanc (ombre portée,
  halo fin sous les graduations).
- **Interface** : Inter (tailles optiques) en famille unique, barre latérale pleine hauteur à
  indicateur glissant, barre d'outils translucide à titre condensé, réglages en groupes,
  contrôles à ressort (segmentés, interrupteurs), historique groupé, toasts HUD, fenêtre
  agrandissable.

> Attention (dev) : Smart App Control peut bloquer un sidecar ou un binaire de test fraîchement
> compilé (« os error 4551 ») — l'app se lance alors avec « Service arrêté ».

> Astuce QA : `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 pnpm dev:desktop`
> permet de piloter/capturer les webviews via CDP sans toucher à la souris. En dev, le
> localStorage (origine `localhost:1420`) est distinct de l'app installée (`tauri.localhost`),
> mais la base SQLite de l'historique est partagée.

---

## Définition de « 100 % » (critère d'arrêt)

Le logiciel est à 100 % quand **tout** ce qui suit est vrai :

1. ✅ `pnpm typecheck` **et** `pnpm lint` passent sans erreur.
2. ✅ **Aucun** chantier non-committé qui traîne (WIP figé dans des commits propres).
3. ✅ **Chaque faiblesse technique listée dans l'audit est fermée** (backend + app), hors périmètre exclu.
4. ✅ Un **filet de tests** existe et passe (`pnpm test`) : backend (mapping d'erreurs, validation),
   libs frontend critiques, helpers Rust testables. Le chemin critique de dictée est couvert.
5. ✅ Le **flux complet a été vérifié manuellement** de bout en bout (voir checklist QA finale).
6. ✅ Versions unifiées, aucun résidu « Voxa », artefacts périmés purgés.

### Périmètre EXCLU de ce plan (ne pas faire ici)
- ❌ Signature de code, auto-updater, CI/CD, installeur personnalisé → **Phase B (distribution)**.
- ❌ Paiement, licence/activation, site, comptes, légal/RGPD → **Phases C/D (commercialisation)**.
- ❌ Portage **macOS / Linux** → hors v1. On assume **Windows-first**. Ne pas retirer les no-op
  `#[cfg(windows)]` existants, mais ne pas investir dans le portage non plus.

---

## Méthode de travail (à respecter)

1. **Commencer par lire l'audit** puis `git status` / `git diff` pour comprendre le WIP en cours.
2. **Figer le WIP AVANT toute nouvelle modif** (workstream F0) — ne pas construire sur du sable.
3. **Petits commits** par tâche (F1, F2, …), messages en français, préfixe `feat`/`fix`/`test`/`chore`.
4. Après chaque tâche : `pnpm typecheck` + `pnpm lint` doivent rester verts.
5. Pour valider un comportement runtime, utiliser la skill **/verify** (piloter le flux réel,
   pas seulement les tests) et **/run** pour lancer l'app.
6. Cocher les cases de ce fichier au fur et à mesure (le garder à jour).
7. Terminer par la **checklist QA finale** (dictée réelle de bout en bout).

Terminer chaque commit de code par :
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Workstream F0 — Hygiène & point de départ (à faire EN PREMIER)

- [ ] **F0.1** — Committer proprement le WIP existant (66 fichiers, +2583 lignes ; fichiers non-suivis :
  `apps/desktop/src/screens/Onboarding.tsx`, `apps/desktop/src/lib/config.ts`,
  `apps/backend/src/routes/postprocess.ts`, `scripts/`). Découper en commits cohérents si possible
  (backend Phase 1 / écrans / config). **Critère** : `git status` propre, rien d'important non-suivi.
- [ ] **F0.2** — Unifier la version : `package.json` racine `0.0.0` → `0.1.0` ; `apps/backend/package.json`
  `0.0.0` → `0.1.0` ; vérifier cohérence avec `tauri.conf.json` / `Cargo.toml` (`0.1.0`).
- [ ] **F0.3** — Purger les artefacts périmés et résidus « Voxa » :
  `apps/desktop/src-tauri/target/release/bundle/**/Voxa_*` (et rebuild propre plus tard, en Phase B).
- [ ] **F0.4** — Baseline verte : `pnpm typecheck` + `pnpm lint` OK avant de continuer.

---

## Workstream F1 — Robustesse backend (fermer les écarts de l'audit)

- [ ] **F1.1** — **Fiabiliser `/postprocess`** (priorité haute). Fichier `apps/backend/src/routes/postprocess.ts:49-54` :
  - Entourer l'appel `client.messages.create` d'un `try/catch` renvoyant un `ApiError` **structuré**
    (respecter le contrat de `packages/shared/src/index.ts`), comme le fait déjà `/transcribe`.
  - Ajouter un **timeout** sur l'appel Anthropic.
  - **Borner la taille du texte d'entrée** (rejeter au-delà d'un seuil raisonnable, ex. équivalent
    de la limite de sortie 2048 tokens).
  - **Critère** : une clé Anthropic invalide ou un texte trop long renvoie un JSON `ApiError` propre, pas un 500 nu.
- [ ] **F1.2** — **Aligner la validation d'en-tête `/postprocess`** sur `/transcribe` : comparer la
  *valeur* de `x-asas-client` à `CLIENT_HEADER_VALUE` (aujourd'hui seule la présence est vérifiée,
  `postprocess.ts:26-32`).
- [ ] **F1.3** — **Mapper le quota / HTTP 429** en réponse dédiée (avec `Retry-After` si présent) sur
  `/transcribe` (`transcribe.ts:138-142`) **et** `/postprocess`. Message actionnable pour l'UI.
- [ ] **F1.4** — **Graceful shutdown** : handlers `SIGTERM` / `SIGINT` → `app.close()` dans `server.ts`
  (le sidecar est tué par le Job Object Windows, mais un arrêt propre évite de couper une requête en vol).
- [ ] **F1.5** — **`/health` significatif** : refléter la présence de clé et/ou ajouter un `/ready`
  distinct qui teste vraiment l'état (aujourd'hui `server.ts:64` renvoie toujours `ok`). Adapter
  `useBackendHealth.ts` côté app si le contrat change.
- [ ] **F1.6** — **Moderniser le modèle de post-traitement** : `postprocess.ts:5` utilise
  `claude-sonnet-4-6` (daté). **Charger la skill `claude-api`** pour choisir l'ID de modèle actuel
  correct (ex. famille Sonnet/Haiku récente) et le prix/limites. Ne pas deviner l'ID à la main.
- [ ] **F1.7** — **Décider des stubs** `openrouter` / `deepinfra` (`stt.ts:79-81`) : soit les
  **implémenter**, soit les **retirer** proprement du type `SttProvider` (`env.ts:15`) pour ne pas
  exposer des fournisseurs non fonctionnels. Par défaut pour un logiciel *fini* : **retirer** (garder
  Voxtral seul) sauf besoin produit explicite.
- [ ] **F1.8** — *(optionnel, si le temps)* rate-limiting local léger (`@fastify/rate-limit`) — faible
  priorité en contexte sidecar mono-utilisateur.

---

## Workstream F2 — Robustesse app & cas de bord (UX finie)

- [ ] **F2.1** — **Surfacer un vrai état UI « backend introuvable »**. Aujourd'hui l'échec de lancement
  du sidecar n'est qu'un `eprintln!` (`lib.rs:167,197`) + point « Hors ligne » dans la titlebar.
  Ajouter un bandeau/écran explicite (« Le service de transcription n'a pas démarré — relancer »)
  avec action de relance. S'appuyer sur `useBackendHealth.ts`.
- [ ] **F2.2** — **Garde-fou durée max d'enregistrement** côté client : arrêter automatiquement (et
  prévenir l'utilisateur) avant la limite backend de 60 s, pour éviter une erreur en bout de chaîne.
  Fichier autour de `recorder.ts` / `useDictation.ts`.
- [ ] **F2.3** — **Couvrir l'absence de `MediaRecorder` / `AudioContext`** : message clair au lieu d'une
  exception non gérée (`recorder.ts:9-12`, `startRecording`). Peu probable sous WebView2 mais un
  logiciel fini le gère.
- [ ] **F2.4** — **Export avec dialogue de destination natif** : aujourd'hui `export.ts` télécharge via
  anchor sans choisir l'emplacement. Utiliser le dialog Tauri (`@tauri-apps/plugin-dialog` `save`)
  pour une vraie expérience desktop. Ajouter la permission dans les capabilities si nécessaire.
- [ ] **F2.5** — **Revue des messages d'erreur / états vides / états de chargement** : passer en revue
  chaque écran (Dictation, History, Settings, Onboarding, Models) pour cohérence de ton, états vides
  soignés, et feedback sur chaque action longue. (Beaucoup est déjà bon — c'est une passe de finition.)

---

## Workstream F3 — Filet de tests (LA lacune n°1, 2/10 → viser un socle solide)

> But : couvrir le **chemin critique** et les zones à fort risque de régression, pas 100 % de lignes.

- [ ] **F3.1** — **Mettre en place le runner** : Vitest sur `apps/backend` et `apps/desktop` (+ éventuellement
  `packages/shared`). Ajouter un script `test` à chaque `package.json` et un `pnpm test` racine
  (`pnpm -r test`). Configurer pour ne pas ramasser les tests de `node_modules`.
- [ ] **F3.2** — **Tests backend** (le meilleur ROI) :
  - Mapping d'erreurs upstream (`handleUpstreamError` / `extractUpstreamDetail`) : 3310→422, 401/403→502,
    timeout→504, connexion→502, invalid_model→502, **429→réponse dédiée** (F1.3).
  - Validation multipart : buffer vide→400, MIME hors whitelist→415, trop gros→413, vocabulaire
    malformé ignoré, bornage à 100 termes / 128 car.
  - Validation d'en-tête `x-asas-client` sur les deux routes (dont F1.2).
  - `/postprocess` : erreur Anthropic → `ApiError` structuré (F1.1), texte trop long rejeté.
- [ ] **F3.3** — **Tests libs frontend** :
  - `lib/postprocess.ts` : commandes vocales FR (ponctuation, « nouvelle ligne », « supprime ça »,
    lookahead « point de vue ») + autoformat (espaces/majuscules). Riche en logique pure → facile à tester.
  - `lib/history.ts` : échappement des jokers LIKE dans la recherche.
  - `lib/recorder.ts` : `pickSupportedMimeType` (repli).
  - `lib/transcribeClient.ts` : construction de la requête (langue, qualité, vocabulaire borné), gestion timeout.
- [ ] **F3.4** — **Tests Rust** (`cargo test` dans `src-tauri`) sur les helpers testables (parsing/format,
  logique de sélection). La logique de focus/`AttachThreadInput` est difficile à tester unitairement —
  la couvrir plutôt via la QA manuelle (F5). Ne pas s'acharner.
- [ ] **F3.5** — Vérifier que `pnpm test` passe et l'intégrer au réflexe (avant chaque commit de logique).

---

## Workstream F4 — Finition « produit fini » (polish)

- [ ] **F4.1** — *(optionnel / stretch)* **Mode continu intelligent** : ajouter une détection de fin de
  parole (VAD) ou un arrêt auto, plutôt que de reposer uniquement sur le clic manuel. À ne faire que
  si F0-F3 sont bouclés — c'est une amélioration, pas une lacune.
- [ ] **F4.2** — Cohérence visuelle finale : vérifier thèmes clair/sombre, orbe, transitions, sur tous
  les écrans. S'appuyer sur la skill **@asas-ui** si une passe design est utile.
- [ ] **F4.3** — Nettoyage : retirer/adapter les scripts de dev qui ne doivent pas semer la confusion
  (`scripts/start-backend.cmd` pointe vers un `dist/server.js` obsolète ; `Lancer-Asas-Voice.vbs`
  lance l'exe de dev). Les documenter comme « dev only » ou les corriger.
- [ ] **F4.4** — Mettre à jour le `README.md` (section utilisation/roadmap) pour refléter l'état réel
  une fois les workstreams terminés.

---

## Workstream F5 — QA finale (vérification de bout en bout)

Lancer l'app réelle (skill **/run**) et cocher manuellement :

- [ ] Premier lancement → onboarding complet (clé Mistral saisie → sidecar redémarre → clé confirmée).
- [ ] Dictée push-to-talk : maintenir le raccourci, parler, relâcher → texte **collé au curseur** dans
  une autre app (ex. Bloc-notes, navigateur, Word).
- [ ] Repli presse-papier quand le focus ne peut pas être restauré → message clair + texte dans l'historique.
- [ ] Silence → « Aucune parole détectée », rien ajouté à l'historique.
- [ ] Backend coupé manuellement → bandeau « backend introuvable » (F2.1) + relance OK.
- [ ] Clé invalide → message d'erreur propre (pas de crash).
- [ ] Enregistrement très long → arrêt auto (F2.2), pas d'erreur backend.
- [ ] Historique : recherche, édition inline, épingle, export (dialogue natif F2.4), suppression 2-clics.
- [ ] Réglages : changement micro + VU-mètre, capture raccourci, langue, autoformat, commandes vocales,
  vocabulaire (context biasing effectif), autostart, thème.
- [ ] Post-traitement Claude activé → correction appliquée ; clé Anthropic invalide → dégradation
  silencieuse (le texte brut passe quand même).
- [ ] Tray : fermeture → réduction ; raccourci toujours actif ; « Afficher » / « Quitter ».
- [ ] Mode continu (toggle) fonctionne.

**Quand toutes les cases de F0→F5 sont cochées et que la QA passe : le logiciel est à 100 %.**
Passer alors à la **Phase B (distribution)** décrite dans l'audit.

---

## Ordre d'exécution recommandé

```
F0 (hygiène)  →  F1 (backend)  →  F3.1-F3.2 (tests backend)  →  F2 (app)  →
F3.3-F3.4 (tests front/rust)  →  F4 (polish)  →  F5 (QA finale)
```

Rationale : figer d'abord, durcir le backend (le maillon le plus faible), tester dans la foulée
pendant que le contexte est frais, puis remonter vers l'app et la finition, et clore par la QA réelle.
