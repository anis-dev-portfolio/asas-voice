# Asas Voice

Logiciel de **dictée vocale** desktop (codename _Asas Voice_). Phase 0 = MVP push-to-talk pour
usage personnel ; deviendra un SaaS par abonnement en Phase 1+ (l'architecture est donc
propre dès maintenant).

> **Copie de démonstration.** Ce dépôt est une copie du code préparée pour évaluation :
> **historique git réinitialisé** (développement réel : 37 commits depuis le 14/06/2026) ;
> un document de stratégie commerciale retiré. **Statut** : utilisé au quotidien par son
> auteur sous Windows, **non distribué** (pas d'installeur signé ni de CI).
> Sécurité et limites : **[SECURITY.md](SECURITY.md)**.

> 🔒 **Règle de sécurité.** La clé API Voxtral (Mistral) n'est **jamais** committée ni
> exposée à la webview (renderer). Toute transcription passe par le **backend** qui seul la
> détient. L'utilisateur la saisit à l'onboarding ; elle est rangée dans le **coffre de l'OS**
> (Windows Credential Manager via le crate `keyring`), jamais en clair sur le disque. Le
> backend tourne en local, lancé automatiquement par l'app (**sidecar** embarqué) — la clé
> lui est passée en variable d'environnement au démarrage, lue depuis le coffre.

## Stack

- **App desktop** : [Tauri v2](https://v2.tauri.app/) (Rust) + React 19 + TypeScript strict (Vite).
- **Backend** : Node + [Fastify](https://fastify.dev/) + TypeScript ; proxy vers Voxtral Mini.
- **Monorepo** : pnpm workspaces. Cible : Windows (macOS plus tard).

## Structure

```
asas-voice/
├── apps/
│   ├── desktop/      # App Tauri v2 (frontend React dans src/, Rust dans src-tauri/)
│   └── backend/      # API Fastify (proxy Voxtral, détient la clé)
├── packages/
│   └── shared/       # Types TS partagés (TranscriptionResult, ApiError, …)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Prérequis

- [Node.js](https://nodejs.org/) ≥ 20 et [pnpm](https://pnpm.io/) ≥ 10
- [Rust](https://www.rust-lang.org/tools/install) (toolchain stable) + les
  [dépendances système Tauri](https://v2.tauri.app/start/prerequisites/) (sous Windows :
  **WebView2** — déjà présent sur Windows 11 — et les **Build Tools C++**).

## Installation

```bash
pnpm install
```

## Configurer la clé Voxtral

Plus besoin d'éditer un `.env` à la main : au **premier lancement**, l'onboarding demande la
clé API Mistral et la range dans le coffre de l'OS. On peut la changer/effacer ensuite dans
**Réglages → Clé de transcription**.

> Pour le **dev backend** (hot-reload), un `.env` reste possible : `cp apps/backend/.env.example
apps/backend/.env` puis renseigner `MISTRAL_API_KEY=…`, et lancer `pnpm dev:backend`.

## Lancer en développement

Un seul process suffit : l'app lance elle-même le backend (sidecar).

```bash
# Ouvre la fenêtre Tauri, lance Vite, compile et démarre le backend embarqué.
pnpm dev:desktop
```

> Au premier `tauri dev`/`tauri build`, le backend est compilé en `.exe` autonome (via
> `scripts/build-sidecar.mjs` → tsup + @yao-pkg/pkg) dans `apps/desktop/src-tauri/binaries/`.
> Le script saute la reconstruction si l'exe est déjà à jour (`FORCE_SIDECAR=1` pour forcer).
>
> **Hot-reload du backend** : lance `pnpm dev:backend` dans un terminal à part — l'app détecte
> qu'un backend occupe déjà le port 4321 et ne lance pas de sidecar concurrent.

Vérifier le backend : `GET http://127.0.0.1:4321/health` → `{ "status": "ok", "service":
"asas-voice-backend", "ready": true, "hasAnthropicKey": false, "uptimeSec": 12 }`
(`ready` = clé Mistral présente ; `hasAnthropicKey` = post-traitement Claude disponible).

## Utilisation

1. **Dicter** : maintiens **Ctrl + Espace** (configurable), parle, relâche — ou, en mode
   « Appuyer pour démarrer / arrêter », un appui démarre et un second termine. Le texte est
   **collé au curseur** dans l'app active (ou copié, selon « Où va le texte »). Cliquer l'orbe
   de l'écran Dictée démarre/arrête aussi une dictée (texte copié).
2. **État « Prêt »** : le verdict en pied de barre latérale et la **chaîne de dictée** (Micro →
   Transcription → Correction IA → Insertion) ne montrent que des états **vérifiés** : service
   local, clé Mistral contrôlée auprès de Mistral, micro détecté, raccourci enregistré. Après
   chaque dictée, chaque étape affiche sa durée et, en cas d'échec, l'étape exacte en cause.
3. **Moteurs** : la transcription (Voxtral Mini Transcribe, `voxtral-mini-latest` — le seul
   modèle de transcription de Mistral) et la correction IA optionnelle (Claude Haiku 4.5, clé
   Anthropic). « Vérifier maintenant » interroge réellement le fournisseur (gratuit, sans rien
   transcrire). Les clés sont rangées dans le coffre Windows.
4. **Historique** : chaque dictée est stockée localement (SQLite), groupée par jour — recherche,
   édition en ligne, épingle, **export** (`.txt` / `.md`), suppression en 2 clics.
5. **Réglages** : raccourci et comportement, sortie, micro (+ test), langue, mise en forme,
   commandes vocales (liste consultable), **vocabulaire** (un mot par terme : Voxtral refuse les
   expressions, qui sont donc découpées en mots), orbe flottante, démarrage avec Windows, thème.
6. **Orbe flottante** : toujours visible ou seulement pendant la dictée. Immobile au repos (aucun
   calcul), elle réagit au curseur qui approche, se déplace à la souris (position mémorisée par
   écran) et affiche le spectre de la voix pendant l'écoute. Seul le disque de l'orbe capte la
   souris : ses coins transparents laissent passer les clics.
   **Animation d'insertion** (Réglages › Orbe flottante, activée par défaut) : au collage, l'orbe
   lance le texte vers le curseur (comète) et le texte collé s'illumine en violet, ligne par
   ligne, avant de s'effacer. Purement visuel : le collage n'attend jamais l'animation. Un bouton
   « Voir l'aperçu » la montre sans dicter. Désactivée si Windows coupe les effets d'animation.
7. **Tray** : fermer la fenêtre la **réduit dans la barre des tâches** (le raccourci reste actif) ;
   clic gauche sur l'icône = ouvrir ; clic droit = « Recentrer l'orbe » / « Quitter ». L'icône
   s'allume pendant l'écoute. Au démarrage de Windows, l'app se lance réduite.
8. **Service arrêté** : un bandeau explicite propose de le relancer et confirme l'issue.

## Scripts utiles (racine)

- `pnpm typecheck` — vérifie les types de tous les packages.
- `pnpm lint` — ESLint sur tout le monorepo.
- `pnpm test` — tests unitaires (Vitest) : mapping d'erreurs & validation backend, libs front.
  Côté Rust : `cargo test` dans `apps/desktop/src-tauri`.
- `pnpm format` — Prettier (écriture).
- `pnpm build` — build des packages (frontend + backend).

## Feuille de route (Phase 0) — terminée

- **T1** Scaffolding monorepo ✅
- **T2** Backend proxy Voxtral (`POST /transcribe`) ✅
- **T3** Sélection du micro + VU-mètre ✅
- **T4** Raccourci global + enregistrement push-to-talk ✅
- **T5** Paste-at-cursor (presse-papier + Ctrl+V simulé) ✅
- **T6** Historique local (SQLite) ✅
- **T7** Réglages (raccourci, langue, démarrage au boot, tray) ✅

### Piste premium desktop (en cours)

- **Jalon A — Utilisable en un clic** : backend **embarqué (sidecar)** + **onboarding** 1er
  lancement (clé API dans le coffre OS, micro, raccourci, test de dictée). ✅
- **Jalon B — Fiabilité** : paste-at-cursor robuste, retours d'erreur clairs, backend offline
  géré (bandeau + relance), garde-fous dictée (durée max, MediaRecorder/AudioContext), filet
  de tests (Vitest). ✅
- **Jalon C — Finitions** : orbe (position persistée/multi-écran, confirmation visuelle), a11y.

**Distribution & vente (plus tard)** : signature de code + updater Tauri, CI/CD ; modèle
**BYOK** (l'utilisateur fournit sa clé) → licence perpétuelle puis, éventuellement, offre SaaS.
Voir [`docs/AUDIT-2026-07-17.md`](docs/AUDIT-2026-07-17.md) et
[`docs/PLAN-FINALISATION-APP.md`](docs/PLAN-FINALISATION-APP.md).

---

Code propriétaire, tous droits réservés. Accès en lecture accordé uniquement à des fins d'évaluation.
