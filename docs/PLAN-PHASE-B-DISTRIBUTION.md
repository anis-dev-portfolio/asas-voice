# Plan Phase B — Distribution (Asas Voice)

> **Pour une prochaine session Claude Code.** Auto-suffisant : ne dépend d'aucune conversation.
> Lis d'abord [`AUDIT-2026-07-17.md`](./AUDIT-2026-07-17.md) (§3 packaging) et
> [`PLAN-FINALISATION-APP.md`](./PLAN-FINALISATION-APP.md) (le logiciel est fini à ~100 %, seule la
> QA manuelle F5 reste côté humain).
>
> **Objectif unique : rendre Asas Voice DISTRIBUABLE proprement sous Windows.** À la fin de cette
> phase, un inconnu peut télécharger l'installeur depuis un lien, l'installer **sans avertissement
> SmartScreen effrayant**, et l'app peut **se mettre à jour toute seule**. Pas de paiement, pas de
> licence, pas de site marchand ici — ça, c'est la Phase C.

---

## Ce que Phase B livre (definition of done)

La phase est terminée quand **tout** ce qui suit est vrai :

1. ✅ L'app **et le sidecar backend et l'installeur** sont **signés Authenticode** (signature valide,
   éditeur affiché, horodatage). Installation sur un Windows vierge **sans blocage SmartScreen**
   (ou réputation en cours de constitution si cert OV).
2. ✅ **Auto-updater fonctionnel** : une version `0.1.0` installée détecte, télécharge et applique une
   `0.1.1` de bout en bout (artefacts de mise à jour **signés** par la clé updater).
3. ✅ **Pipeline de release reproductible** : un `git tag vX.Y.Z` produit automatiquement l'installeur
   signé + les artefacts updater + le `latest.json` publiés (plus de build manuel périmé).
4. ✅ **Installeur de qualité** : langue **FR**, EULA affichée, mode d'installation défini, branding,
   comportement WebView2 explicite. Aucun résidu « Voxa », versions unifiées.
5. ✅ **Validation finale** sur une machine/VM Windows propre : download → install → dictée → update → désinstallation propre.

### Périmètre EXCLU (ne pas faire ici)
- ❌ Paiement, licence/activation, comptes, site marchand → **Phase C**.
- ❌ CGV, politique de confidentialité, mentions légales, structure juridique → **Phase D**.
- ❌ Portage macOS/Linux (l'app est Windows-first ; signature/notarisation Apple = autre chantier).
- ❌ Backend cloud / SaaS → **Phase E**.

---

## ⚠️ Prérequis HUMAINS bloquants (à lancer AVANT le code — délais de plusieurs jours)

Ces éléments **ne peuvent pas être faits par Claude Code** : ils demandent un achat, une identité
vérifiée, des comptes. À déclencher tout de suite car ils conditionnent B1/B2/B4.

- **[HUMAIN] P-1 — Certificat de signature de code.** Décision + acquisition (voir **B0** pour le
  comparatif). Compter plusieurs jours de vérification d'identité. **Sans lui, B1 est bloqué.**
- **[HUMAIN] P-2 — Hébergement des mises à jour.** Choisir où seront servis `latest.json` + artefacts :
  **GitHub Releases** (recommandé, gratuit, intégré à `tauri-action`) ou un bucket S3/serveur perso.
- **[HUMAIN] P-3 — Dépôt distant + secrets CI.** Un remote GitHub (le repo est local aujourd'hui) pour
  héberger les Actions et les *secrets* (clé updater, identifiants de signature).
- **[HUMAIN] P-4 — Identité éditeur.** Le nom qui apparaîtra comme « éditeur » signé doit être cohérent
  avec la future structure (cf. Phase D). Vaut mieux le figer maintenant (le certificat le gravera).

> Claude Code peut **tout préparer** (config, workflows, scripts, code updater) et **tout tester** avec
> une clé updater + éventuellement un **certificat auto-signé de test**. Le certificat de confiance
> réel et sa manipulation (token matériel / HSM cloud) restent une action humaine.

---

## Méthode de travail (à respecter)

1. Lire l'audit §3 + ce plan, puis `git status` (doit être propre — sinon committer avant).
2. **Petits commits** par tâche (B1, B2, …), messages FR, préfixes `feat`/`fix`/`chore`/`ci`.
3. Après chaque tâche : `pnpm typecheck` + `pnpm lint` restent verts ; `cargo check` OK.
4. **Ne jamais committer de secret** : clé privée updater, `.pfx`, mots de passe → *secrets* CI /
   variables d'env locales uniquement. Vérifier le `.gitignore`.
5. Valider chaque brique de façon isolée (signer un binaire de test, simuler une update locale) avant
   d'assembler dans la CI.
6. Cocher les cases de ce fichier au fur et à mesure.
7. Terminer par la **validation finale B6** sur environnement Windows propre.

Terminer chaque commit de code par :
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

> Note build (rappel finalisation) : si `cargo`/`tauri-build` renvoie `PermissionDenied`, un
> `asas-voice-backend.exe` **orphelin** verrouille `target` → `taskkill //PID <pid> //F`.

---

## Workstream B0 — Décision & mise en place du certificat

- [ ] **B0.1** — **Choisir la stratégie de signature** parmi :
  - **Azure Trusted Signing** (Microsoft) — cloud, ~10 $/mois, pas de token matériel, chaîne reconnue
    SmartScreen. Éligibilité : organisation (ou validation individuelle). **Recommandé si éligible** :
    le moins cher et le plus simple à automatiser en CI via `signCommand`.
  - **Certificat OV** sur HSM cloud (SSL.com/Sectigo/DigiCert) — moins cher qu'EV, mais réputation
    SmartScreen à construire (les 1ers téléchargements peuvent afficher un avertissement un temps).
  - **Certificat EV** — le plus cher, mais **réputation SmartScreen immédiate**. Token matériel / HSM.
  > ⚠️ Depuis 2023, les certificats OV/EV imposent la clé privée sur **matériel FIPS** (token/HSM) —
  > plus de simple fichier `.pfx` local. C'est ce qui rend Azure Trusted Signing intéressant.
  - **Livrable de B0.1** : une note `docs/SIGNING.md` figeant le choix, le coût, la procédure d'accès.
- [ ] **B0.2** — **Mettre en place l'accès signing en local** (Claude peut préparer) : documenter la
  commande `signtool`/`Trusted Signing` qui sera appelée, et créer un **certificat auto-signé de test**
  pour valider toute la chaîne B1 **sans attendre** le certificat réel.
- [ ] **B0.3** — **Vérifier le `.gitignore`** : `*.pfx`, `*.p12`, `*.key`, clés privées updater, `.env`
  de CI — rien de sensible ne doit pouvoir être committé.

---

## Workstream B1 — Signature Authenticode (P0)

État actuel : `tauri.conf.json` **n'a aucune section `bundle.windows`** → binaires non signés.

- [ ] **B1.1** — **Configurer la signature dans `tauri.conf.json`** sous `bundle.windows` :
  - soit `certificateThumbprint` + `digestAlgorithm: "sha256"` + `timestampUrl` (cert dans le magasin
    Windows),
  - soit `signCommand` (recommandé pour Azure Trusted Signing / HSM cloud — commande custom qui signe
    le fichier passé en argument).
  - Toujours un **timestamp** (RFC 3161) pour que la signature reste valide après expiration du cert.
- [ ] **B1.2** — **S'assurer que le SIDECAR est signé lui aussi.** Le `.exe` backend (~62 Mo,
  `binaries/asas-voice-backend-*.exe`) est embarqué : il doit être signé **avant** le bundling (sinon
  un exécutable non signé se retrouve dans une app signée → mauvais signal + risque antivirus). Adapter
  `scripts/build-sidecar.mjs` pour signer l'exe produit, ou ajouter une étape de signature dédiée.
- [ ] **B1.3** — **Vérifier** avec `signtool verify /pa /v` (ou équivalent) que : l'app `asas-voice.exe`,
  le sidecar, et les installeurs **NSIS + MSI** sont tous signés et horodatés, éditeur correct.
- [ ] **B1.4** — **Test SmartScreen** (avec le vrai cert, quand dispo) : installer sur un Windows vierge
  et confirmer l'absence de blocage (ou réputation en cours si OV). **Critère B1** : chaîne de signature
  complète et vérifiée.

---

## Workstream B2 — Auto-updater Tauri (P0)

État actuel : `tauri-plugin-updater` **absent** de `Cargo.toml`, aucune section `plugins.updater`,
aucune permission updater dans `capabilities/default.json`.

- [ ] **B2.1** — **Ajouter le plugin** : `tauri-plugin-updater` dans `Cargo.toml` (dépendance Rust) +
  `@tauri-apps/plugin-updater` (front). Enregistrer le plugin dans `lib.rs` (`.plugin(tauri_plugin_updater::Builder::new().build())`).
- [ ] **B2.2** — **Générer la paire de clés updater** : `pnpm tauri signer generate` → clé **publique**
  dans `tauri.conf.json`, clé **privée** + mot de passe **en secrets** (jamais dans le dépôt).
- [ ] **B2.3** — **Configurer `plugins.updater`** dans `tauri.conf.json` : `pubkey`, `endpoints`
  (URL du `latest.json`, cf. P-2), et `bundle.createUpdaterArtifacts: true` pour générer les artefacts
  signés (`.sig`).
- [ ] **B2.4** — **Ajouter la permission** `updater:default` (et ce qui est requis) dans
  `capabilities/default.json`.
- [ ] **B2.5** — **Implémenter le flux UI de mise à jour** : vérification au démarrage (et/ou bouton
  « Rechercher les mises à jour » dans Réglages), notification discrète, téléchargement + install +
  relance. Gérer les erreurs (hors ligne, échec) proprement, dans l'esprit défensif du reste de l'app.
- [ ] **B2.6** — **Tester une update de bout en bout en local** : publier un `latest.json` pointant vers
  une `0.1.1` factice signée, lancer une `0.1.0`, vérifier détection → download → install → relance.
  **Critère B2** : mise à jour appliquée sans intervention manuelle, signature vérifiée.

---

## Workstream B3 — Installeur de qualité (P2)

État actuel : `targets: "all"` génère NSIS + MSI **par défaut**, non personnalisés, **MSI en-US** pour
un public FR, `webviewInstallMode` non défini.

- [ ] **B3.1** — **Langue FR** : configurer `bundle.windows.nsis.languages` (et/ou WiX) sur le français.
- [ ] **B3.2** — **EULA / licence affichée** à l'installation (`nsis.license` / `wix.license`). Texte
  minimal pour l'instant (le vrai juridique = Phase D), mais la mécanique doit être en place.
- [ ] **B3.3** — **Mode d'installation** : privilégier **per-user** (`nsis.installMode: "currentUser"`)
  pour éviter l'élévation admin — cohérent avec autostart utilisateur et une install grand public.
- [ ] **B3.4** — **`webviewInstallMode`** explicite (`bundle.windows.webviewInstallMode`) : décider
  `embedBootstrapper`/`offlineInstaller` selon la cible réseau (offline = installeur plus lourd mais
  autonome sans Internet). Documenter le choix.
- [ ] **B3.5** — **Branding installeur** : icône, image d'en-tête/sidebar NSIS, nom/éditeur corrects.
- [ ] **B3.6** — **Exclure de la distribution les scripts de dev** (`scripts/start-backend.cmd`,
  `Lancer-Asas-Voice.vbs`) — vérifier qu'ils ne sont pas embarqués (déjà assainis en F4.3).

---

## Workstream B4 — Versioning & release reproductible + CI/CD (P0/P1)

État actuel : aucune CI (`.github/` absent). Le sidecar est gitignoré, dépend de `rustc`/`pnpm`/`pkg`
locaux. Les builds de release sont 100 % manuels (d'où les artefacts périmés constatés à l'audit).

- [ ] **B4.1** — **Source unique de version + script de bump** : garantir que `package.json` (racine +
  apps), `tauri.conf.json` et `Cargo.toml` restent alignés à chaque release (script `chore` ou champ
  unique). Repartir de `0.1.0`.
- [ ] **B4.2** — **Workflow GitHub Actions de release** (`.github/workflows/release.yml`) déclenché sur
  tag `v*` : install deps → **build sidecar** → **build Tauri** → **signature** (B1) → **artefacts
  updater** (B2) → **publication GitHub Releases** + mise à jour du `latest.json`. Utiliser
  `tauri-apps/tauri-action`.
- [ ] **B4.3** — **Injecter les secrets** dans la CI : identifiants de signature (ou config Azure Trusted
  Signing) + clé privée updater + mot de passe. Jamais en clair.
- [ ] **B4.4** — **Rebuild propre & vérif taille** : le nouvel installeur doit peser ~**25-40 Mo**
  (preuve que le sidecar de 62 Mo est bien embarqué et compressé). Purger tout artefact « Voxa » restant.
- [ ] **B4.5** — **Documenter la procédure de release** dans `docs/RELEASE.md` (tag → CI → vérif →
  annonce). **Critère B4** : un tag produit une release signée, publiée et auto-updatable, sans manip manuelle.

---

## Workstream B5 — Durcissement distribution (P1, optionnel/si le temps)

- [ ] **B5.1** — **Antivirus / faux positifs** : les exes empaquetés (pkg + enigo qui simule le clavier)
  peuvent déclencher des heuristiques. Après signature, tester via un scan multi-moteurs et documenter.
  La signature réduit fortement le risque ; surveiller les premiers retours.
- [ ] **B5.2** — **Icône/métadonnées de version** de l'exe (CompanyName, ProductName, FileDescription)
  cohérentes et renseignées.
- [ ] **B5.3** — **Checksums** (SHA-256) publiés à côté des installeurs pour vérification manuelle.

---

## Workstream B6 — Validation finale (release candidate)

Sur une **machine / VM Windows propre** (idéalement sans outils de dev), avec le **vrai certificat** :

- [ ] Télécharger l'installeur **depuis le lien de distribution** (pas depuis le dossier de build).
- [ ] Installer → **aucun blocage SmartScreen** (ou avertissement OV attendu), éditeur affiché correct.
- [ ] Lancer → onboarding → **dictée réelle** → collage au curseur (le sidecar signé démarre bien).
- [ ] **Mise à jour** : depuis cette version, détecter et appliquer une version supérieure publiée.
- [ ] **Désinstallation propre** (pas de sidecar orphelin, pas de résidu ; le Job Object doit tuer le backend).
- [ ] Rejouer la **checklist QA F5** du plan de finalisation si elle n'a pas encore été validée.

**Quand B0→B6 sont cochés : Asas Voice est distribuable. Passer à la Phase C (commercialisation).**

---

## Ordre d'exécution recommandé

```
[HUMAIN] P-1..P-4 (lancer immédiatement, en parallèle)
        │
B0 (décision cert + cert de test)
        │
B1 (signature, validée avec cert de test)  ──►  B2 (updater, testé en local)
        │                                              │
        └──────────────► B3 (installeur FR/EULA) ◄─────┘
                                │
                        B4 (versioning + CI/CD : automatise B1+B2+B3)
                                │
                        B5 (durcissement, optionnel)
                                │
                        B6 (validation finale avec le VRAI certificat)
```

Rationale : lancer les achats/comptes humains tout de suite (délais), coder et **tester toute la
chaîne avec un certificat auto-signé de test** pour ne pas être bloqué, puis brancher le vrai
certificat au moment de la CI et de la validation finale.
