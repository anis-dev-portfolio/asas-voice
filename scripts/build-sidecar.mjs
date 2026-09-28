// @ts-check
/**
 * Empaquette le backend Fastify en un .exe autonome (« sidecar » Tauri).
 *
 * Pipeline : tsup (bundle CJS auto-suffisant) → @yao-pkg/pkg (Node embarqué) → exe.
 * Le binaire est nommé `asas-voice-backend-<target-triple>` comme l'exige Tauri pour
 * un externalBin (il le copie à côté de l'app à la compilation et le résout en dev).
 *
 * Idempotent : on saute la reconstruction si l'exe est déjà plus récent que les sources
 * (mettre FORCE_SIDECAR=1 pour forcer). Cela garde `tauri dev` rapide.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = join(ROOT, "apps", "backend");
const BIN_DIR = join(ROOT, "apps", "desktop", "src-tauri", "binaries");
const BUNDLE = join(BACKEND, "dist", "server.cjs");
const SIDECAR_NAME = "asas-voice-backend";

/** Triple cible (ex. x86_64-pc-windows-msvc) — lue depuis rustc, repli sur Windows x64. */
function targetTriple() {
  try {
    const out = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
    const host = out.split(/\r?\n/).find((l) => l.startsWith("host:"));
    if (host) return host.slice("host:".length).trim();
  } catch {
    // rustc absent : on suppose la machine de dev (Windows x64).
  }
  return "x86_64-pc-windows-msvc";
}

/**
 * Cible pkg (node22-<os>-<arch>) dérivée de la triple.
 * node22 : @yao-pkg/pkg-fetch publie un binaire préfabriqué (node20 forçait une
 * compilation depuis les sources, qui échoue sous Windows faute d'outil `patch`).
 */
function pkgTarget(triple) {
  const os = triple.includes("windows")
    ? "win"
    : triple.includes("darwin") || triple.includes("apple")
      ? "macos"
      : "linux";
  const arch = triple.includes("aarch64") || triple.includes("arm64") ? "arm64" : "x64";
  return `node22-${os}-${arch}`;
}

/** mtime la plus récente d'un arbre de fichiers (récursif). */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

function sourcesNewestMtime() {
  let newest = 0;
  for (const p of [join(BACKEND, "src"), join(ROOT, "packages", "shared", "src")]) {
    if (existsSync(p)) newest = Math.max(newest, newestMtime(p));
  }
  for (const f of [join(BACKEND, "tsup.config.ts"), join(BACKEND, "package.json")]) {
    if (existsSync(f)) newest = Math.max(newest, statSync(f).mtimeMs);
  }
  return newest;
}

/**
 * Quote les arguments passés via un shell Windows.
 * Sans cela, un chemin contenant une espace (ex. « Projet IA ») est découpé en
 * plusieurs arguments par cmd.exe : pkg croit alors recevoir plusieurs entrées.
 */
function shellArgs(args) {
  if (process.platform !== "win32") return args;
  return args.map((a) => (a.includes(" ") ? `"${a}"` : a));
}

function main() {
  const triple = targetTriple();
  const ext = triple.includes("windows") ? ".exe" : "";
  const outFile = join(BIN_DIR, `${SIDECAR_NAME}-${triple}${ext}`);

  if (!process.env.FORCE_SIDECAR && existsSync(outFile)) {
    if (statSync(outFile).mtimeMs >= sourcesNewestMtime()) {
      console.log(`[sidecar] à jour, on saute : ${outFile}`);
      return;
    }
  }

  console.log("[sidecar] build du bundle backend (tsup)…");
  execFileSync("pnpm", shellArgs(["--filter", "@asas-voice/backend", "build"]), {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  mkdirSync(BIN_DIR, { recursive: true });
  console.log(`[sidecar] pkg → ${outFile}`);
  execFileSync(
    "pnpm",
    shellArgs(["exec", "pkg", BUNDLE, "--targets", pkgTarget(triple), "--output", outFile]),
    { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
  console.log(`[sidecar] OK : ${outFile}`);
}

main();
