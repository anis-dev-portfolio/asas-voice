@echo off
REM ============================ DEV ONLY ============================
REM Démarre le backend Asas Voice (Fastify, port 4321) en standalone.
REM L'application packagée lance déjà son backend embarqué (sidecar) : ce script
REM n'est utile qu'en dev/diagnostic pour faire tourner le backend seul.
REM
REM Prérequis : backend compilé -> pnpm --filter @asas-voice/backend build (produit dist\server.js).
REM Pour le hot-reload en dev, préférer : pnpm dev:backend
REM cwd = apps/backend pour que le .env (MISTRAL_API_KEY) soit bien chargé.
cd /d "%~dp0..\apps\backend"
if not exist "dist\server.js" (
  echo [Asas Voice] dist\server.js introuvable.
  echo   Compile d'abord le backend : pnpm --filter @asas-voice/backend build
  echo   Ou lance le dev hot-reload  : pnpm dev:backend
  exit /b 1
)
node dist\server.js
