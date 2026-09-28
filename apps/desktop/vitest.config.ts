import { defineConfig } from "vitest/config";

// Tests des libs front pures (post-traitement, historique, recorder, client HTTP).
// Environnement Node : les globals DOM utilisés (FormData, Blob, AbortController,
// DOMException) existent nativement ; MediaRecorder est stubé par test au besoin.
// Config isolée (on ne fusionne pas vite.config) pour ne pas charger le plugin React.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
