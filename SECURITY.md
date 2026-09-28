# Sécurité — ce qui est implémenté, et où

Asas Voice est une app desktop (Tauri) qui envoie la voix à deux API d'IA (Mistral Voxtral pour la transcription, Anthropic Claude pour la correction). Les risques visés : fuite des clés API, abus du backend local par une page web, dérive des coûts d'API. Chaque point renvoie au fichier qui l'implémente.

## Clés API : jamais sur disque, jamais dans l'interface

- Rangées dans le **coffre de l'OS** (Windows Credential Manager, crate `keyring`) — `apps/desktop/src-tauri/src/lib.rs:29-56`, `apps/desktop/src-tauri/Cargo.toml:37`.
- Lues côté Rust et passées au backend embarqué **par variable d'environnement** au démarrage du processus — `apps/desktop/src-tauri/src/lib.rs:186-191`. La webview (React) ne les reçoit jamais.
- Vérification d'une clé auprès du fournisseur sans la renvoyer : le backend ne répond qu'un verdict (`ok`, `invalid_key`, `rate_limited`…) — `apps/backend/src/routes/engines.ts`, contrat dans `packages/shared/src/index.ts`.
- Aucun secret versionné : `apps/backend/.env` ignoré, seul `.env.example` (noms de variables) est suivi.

## Backend local : fermé aux autres sites web

- Écoute **uniquement sur 127.0.0.1** — `apps/backend/src/server.ts:96`.
- **CORS** limité aux origines de l'app — `apps/backend/src/server.ts:15`.
- **Anti DNS-rebinding** : toute requête dont l'en-tête `Host` n'est pas `127.0.0.1` / `localhost` est rejetée (un site malveillant qui ferait pointer son domaine vers 127.0.0.1 est bloqué) — `apps/backend/src/server.ts:29-34`.
- **En-tête client obligatoire** (`X-Asas-Client`) sur toutes les routes POST : il force un préflight CORS, qu'aucune autre origine ne passe — sinon n'importe quelle page pourrait déclencher des transcriptions et vider le quota. `packages/shared/src/index.ts:45-46` ; contrôles `apps/backend/src/routes/transcribe.ts:202`, `postprocess.ts:120`, `engines.ts:183` ; testé dans `transcribe.test.ts:84` et `postprocess.test.ts:33`.

## Coûts et limites d'API

- Audio plafonné à 25 Mo (`apps/backend/src/server.ts:54`) ; texte à corriger plafonné à 8 000 caractères → `413` (`apps/backend/src/routes/postprocess.ts:24`, `:136-138`).
- Délais maximum : 15 s pour la correction (`postprocess.ts:17`), 8 s pour la vérification des clés (`engines.ts:27`).
- Quota du fournisseur atteint (`429`) : réponse dédiée avec `Retry-After` relayé à l'app — `apps/backend/src/routes/transcribe.ts:124-131`, `apps/backend/src/upstream.ts:29`.

## App desktop

- **CSP** stricte de la webview : `default-src 'self'`, connexions limitées au backend local — `apps/desktop/src-tauri/tauri.conf.json:30`.
- **Permissions Tauri** listées explicitement (fenêtre, raccourci global, ouverture d'URL…) — `apps/desktop/src-tauri/capabilities/default.json`.

## Tests

`pnpm test` : 136 tests Vitest (backend 56 : mapping d'erreurs, validation, en-tête client, 429 ; desktop 80 : libs front, migration des réglages, physique de l'orbe) · `cargo test` dans `apps/desktop/src-tauri` : 16 tests Rust.

## Limites connues (honnêtement)

- **Pas de défense dédiée contre l'injection de consignes** : le texte dicté est envoyé tel quel à Claude comme message utilisateur, sous un prompt système de correction (`apps/backend/src/routes/postprocess.ts:27`). Une dictée contenant des instructions pourrait être « obéie » au lieu d'être corrigée. Risque limité (l'utilisateur ne peut attaquer que son propre texte), mais non traité.
- **Pas de rate limiting applicatif** du backend local (il n'écoute que la machine de l'utilisateur ; les quotas sont ceux des fournisseurs).
- **Pas de CI, pas de signature de code** : l'app n'est pas distribuée (usage personnel quotidien sous Windows).
