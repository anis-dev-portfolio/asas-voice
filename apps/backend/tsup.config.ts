import { defineConfig, type Options } from "tsup";

// Bundle le serveur en un seul fichier. @asas-voice/shared (source TS) est inliné via
// noExternal pour que le bundle tourne sans dépendre du workspace.
//   - ESM (dist/server.js)  → `node dist/server.js` et `pnpm dev` (Node natif).
//   - CJS (dist/server.cjs) → empaqueté en .exe autonome par @yao-pkg/pkg (le sidecar).
// On inline TOUTES les deps (dont fastify/mistral) pour que pkg n'ait qu'un seul fichier
// à embarquer — sinon pkg doit résoudre node_modules à l'exécution, fragile dans un exe.
const shared: Options = {
  entry: ["src/server.ts"],
  target: "node20",
  platform: "node",
  noExternal: [/.*/],
};

export default defineConfig([
  {
    ...shared,
    format: ["esm"],
    clean: true,
    // Les deps inlinées (fastify…) sont du CJS : dans un bundle ESM leurs `require()`
    // de modules Node natifs ("events"…) crashent sans ce shim createRequire.
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  },
  {
    ...shared,
    format: ["cjs"],
    clean: false, // ne pas effacer le bundle ESM produit juste avant
  },
]);
