import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { HealthResponse } from "@asas-voice/shared";
import { readEnv } from "./env";
import { transcribeRoutes } from "./routes/transcribe";
import { postprocessRoutes } from "./routes/postprocess";
import { engineRoutes } from "./routes/engines";

// Seule la webview Tauri (prod) et le serveur Vite (dev) doivent pouvoir appeler ce
// backend local : http://tauri.localhost = origine de la webview en production sous
// Windows ; tauri://localhost = macOS/Linux ; http://localhost:1420 = Vite en dev.
// Tout autre site web ouvert dans le navigateur de l'utilisateur est rejeté — sinon
// n'importe quelle page pourrait POSTer sur /transcribe et drainer le quota Voxtral.
const ALLOWED_ORIGINS = ["http://tauri.localhost", "tauri://localhost", "http://localhost:1420"];

// Démarrage encapsulé dans une fonction async : pas de top-level await, pour que tsup
// puisse aussi émettre un bundle CJS (empaqueté en .exe autonome par pkg — le sidecar).
async function main(): Promise<void> {
  const env = readEnv();

  const app = Fastify({
    logger: true,
  });

  // Anti DNS-rebinding : un site malveillant peut faire pointer son domaine vers 127.0.0.1
  // et contourner CORS (même origine à ses yeux). Le Host de la requête trahit l'attaque :
  // on n'accepte que les hôtes loopback attendus, port compris.
  const allowedHosts = new Set(
    ["127.0.0.1", "localhost", "[::1]"].flatMap((h) => [h, `${h}:${env.port}`]),
  );
  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host?.trim().toLowerCase();
    if (!host || !allowedHosts.has(host)) {
      return reply.code(403).send({ error: { code: "forbidden", message: "Hôte non autorisé." } });
    }
  });

  await app.register(cors, {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "OPTIONS"],
    // L'en-tête custom « X-Asas-Client » est EXIGÉ par POST /transcribe (voir la route) :
    // il rend la requête « non simple » → le navigateur impose un préflight CORS, que
    // seules les origines ci-dessus passent. Cela bloque le DÉCLENCHEMENT cross-origin,
    // pas seulement la lecture de la réponse.
    allowedHeaders: ["Content-Type", "X-Asas-Client"],
  });

  // Réception du blob audio en multipart/form-data. Limites bornées sur tous les axes
  // (pas seulement la taille du fichier) pour éviter qu'une requête abuse du nombre ou
  // de la taille des champs.
  await app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 Mo : large pour un clip de dictée
      files: 1, // un seul fichier audio
      fields: 5, // language, vocabulary (+ marge pour d'anciens clients)
      fieldNameSize: 100,
      fieldSize: 1024 * 1024, // 1 Mo par champ texte (vocabulaire JSON)
      parts: 10,
    },
  });

  // Sonde de vivacité ET d'introspection : un 200 signifie « le process répond » ;
  // `ready` dit si /transcribe est réellement opérationnel (clé Mistral présente).
  // On garde toujours un 200 quand le process tourne pour ne pas faire clignoter la
  // titlebar « hors ligne » sur un backend démarré mais pas encore configuré.
  // Sondée toutes les quelques secondes par l'app : pas de log par requête (bruit inutile).
  app.get("/health", { logLevel: "warn" }, async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      service: "asas-voice-backend",
      ready: Boolean(env.mistralApiKey),
      hasAnthropicKey: Boolean(env.anthropicApiKey),
      uptimeSec: Math.floor(process.uptime()),
    };
  });

  // État de configuration NON sensible : indique seulement si une clé est présente côté
  // serveur (jamais la clé elle-même). L'onboarding s'en sert pour confirmer que le sidecar
  // a bien reçu la clé avant de proposer le test de dictée.
  app.get(
    "/config",
    { logLevel: "warn" },
    async (): Promise<{ hasKey: boolean; hasAnthropicKey: boolean }> => {
      return {
        hasKey: Boolean(env.mistralApiKey),
        hasAnthropicKey: Boolean(env.anthropicApiKey),
      };
    },
  );

  await transcribeRoutes(app, env);
  await postprocessRoutes(app, env);
  await engineRoutes(app, env);

  await app.listen({ port: env.port, host: "127.0.0.1" });
  app.log.info(`Asas Voice backend prêt sur http://127.0.0.1:${env.port}`);
  if (!env.mistralApiKey) {
    app.log.warn(
      "MISTRAL_API_KEY absente : /transcribe renverra une erreur tant qu'elle n'est pas configurée.",
    );
  }

  // Arrêt propre : le sidecar est tué par le Job Object Windows à la fermeture de l'app,
  // mais un SIGINT/SIGTERM (Ctrl+C en dev, arrêt orchestré) doit couper les requêtes en
  // vol proprement plutôt que d'être interrompu net.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Signal ${signal} reçu — arrêt propre du backend…`);
    app.close().then(
      () => process.exit(0),
      (err) => {
        app.log.error({ err }, "Échec de l'arrêt propre du backend");
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
