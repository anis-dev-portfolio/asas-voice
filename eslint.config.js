// Configuration ESLint « flat » (v9) — couvre tout le monorepo (TypeScript partout).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/src-tauri/target/**", "**/src-tauri/gen/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Scripts de build/outillage Node (JS pur, dont le rendu des icônes) : globals Node.
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "apps/desktop/design/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  // Désactive les règles de style qui entrent en conflit avec Prettier.
  prettier,
);
