import { defineConfig } from "vitest/config";

// Tests backend : environnement Node (Fastify + logique pure). On ne ramasse que
// les tests sous src/, jamais node_modules ni le bundle dist/.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
