/*
 * makeOrb — rendu canvas de l'orbe d'Asas Voice : un INSTRUMENT, pas une bulle.
 *
 *  - Cœur liquide : une membrane physique (orb/physics.ts) déformée par la voix bande par
 *    bande (graves en bas, aigus en haut), attirée par le curseur, qui traîne derrière la
 *    fenêtre qu'on déplace et rebondit. Dégradé spectral pêche → violet, éclairé en haut à
 *    gauche, liseré net : une matière précise, pas un flou.
 *  - Anneau de mesure : 60 graduations. Au repos, un cadran discret (4 repères cardinaux).
 *    À l'écoute, un analyseur de spectre circulaire avec crêtes mémorisées. Pendant la
 *    transcription, une comète fait le tour. À la confirmation, un balayage + une onde.
 *    En cas d'erreur, l'anneau vire à l'ambre et le cœur secoue la tête.
 *  - Lancer (collage au curseur) : l'orbe « envoie » le texte vers l'endroit où il arrive —
 *    jet de matière dans cette direction, recul du cœur, graduations qui s'embrasent, puis
 *    confirmation qui rayonne depuis ce point. La comète elle-même est dessinée par Rust.
 *  - Matière : liquide intérieur (deux nappes qui tournent quand l'orbe travaille),
 *    lumière transmise en bas, ombre de volume, reflet net — un verre, pas un dégradé plat.
 *
 * Sobriété (l'orbe tourne 24 h/24) :
 *  - au repos et posée, l'orbe est un instrument IMMOBILE : la boucle s'arrête, zéro
 *    image, zéro réveil. Elle ne repart que s'il se passe quelque chose (curseur qui
 *    approche, fenêtre déplacée, voix, changement d'état) — puis se rendort une fois posée.
 *    (`idleFps` > 0 permet, si besoin, une respiration lente au repos.)
 *  - setActive(false) (fenêtre cachée) coupe TOUT : aucun minuteur, aucune image ;
 *  - halo et reflet pré-rendus (un drawImage au lieu de dégradés recalculés), graduations
 *    regroupées en quelques tracés, DPR plafonné à 2 ;
 *  - prefers-reduced-motion : une image fixe par changement d'état, aucune boucle.
 *
 * L'orbe ne crée AUCUN flux micro : les trames audio lui sont poussées via setFrame().
 */
import { VOICE_BANDS, type OrbVisualState, type VoiceFrame } from "@asas-voice/shared";
import {
  follow,
  MAX_STEPS,
  Membrane,
  NODES,
  sampleBands,
  spectralPosition,
  Spring2D,
  STEP,
} from "./physics";

export type OrbState = OrbVisualState;
export type OrbTheme = "dark" | "light";

export interface OrbHandle {
  /** Pousse une trame audio live (niveau + bandes), typiquement ~30 fps pendant l'écoute. */
  setFrame(frame: VoiceFrame): void;
  /** Change l'état visuel de l'orbe. */
  setState(state: OrbState): void;
  /**
   * Démarre/arrête le rendu (false = fenêtre cachée : plus rien ne tourne). Avec
   * `animate`, l'arrêt joue d'abord une sortie (l'orbe se rétracte et s'efface) et finit
   * sur un canvas vide ; la réapparition repart de là où la sortie en était.
   */
  setActive(active: boolean, animate?: boolean): void;
  /**
   * Position du curseur relative au centre du canvas, normalisée par la demi-largeur
   * (x→droite, y→bas ; peut dépasser ±1 quand le curseur approche de l'extérieur).
   * null = curseur loin (l'attraction se relâche).
   */
  setPointer(nx: number | null, ny: number | null): void;
  /** Vitesse de déplacement de la fenêtre (largeurs de canvas / s) : traînée + ballottement. */
  setMotion(vx: number, vy: number): void;
  /** Adapte les couleurs de l'anneau au fond (sombre / clair). */
  setTheme(theme: OrbTheme): void;
  /**
   * Lance le texte dans une direction (vecteur unitaire, y vers le bas) : jet de matière,
   * recul, graduations qui s'embrasent de ce côté.
   */
  launch(dx: number, dy: number): void;
  /** Libère minuteurs et observers. */
  destroy(): void;
}

export interface OrbOptions {
  /** Rayon de repos du cœur, en fraction du côté du canvas (défaut 0,165). */
  coreRatio?: number;
  /** Cadence au repos, en images/s (défaut 0 : immobile, aucune image au repos). */
  idleFps?: number;
  theme?: OrbTheme;
  /**
   * Orbe flottante posée sur n'importe quel fond (document blanc, éditeur sombre) :
   * ombre portée douce et graduations cernées d'un fin halo sombre pour rester lisibles.
   */
  floating?: boolean;
}

const TAU = Math.PI * 2;
const TICKS = 60;
/** Rayon de l'anneau de mesure, en rayons de repos. */
const RING = 1.55;
/** Durées des états transitoires (ms). */
const CONFIRM_MS = 760;
const ERROR_MS = 1000;
const INTRO_MS = 620;
/** Sortie (masquage animé) : plus brève que l'entrée, comme une fenêtre macOS. */
export const OUTRO_MS = 240;
const LAUNCH_MS = 640;
/** Cadence plafond en activité (écrans 120/144 Hz : inutile de dessiner plus). */
const ACTIVE_MIN_FRAME_MS = 15.5;

// ---- Palette (dérivée des tokens de la DA ; le canvas ne lit pas les variables CSS) ----
const CORE_STOPS: [number, string][] = [
  [0, "#fff0dc"],
  [0.26, "#ffa47a"],
  [0.6, "#a56bff"],
  [1, "#4b36b8"],
];
interface TickPalette {
  idle: [number, number, number];
  hot: [number, number, number];
  warn: [number, number, number];
  baseAlpha: number;
}
const TICK_PALETTE: Record<OrbTheme, TickPalette> = {
  dark: { idle: [196, 186, 255], hot: [255, 196, 158], warn: [240, 194, 116], baseAlpha: 0.26 },
  light: { idle: [92, 76, 170], hot: [226, 104, 64], warn: [196, 132, 30], baseAlpha: 0.34 },
};
/** Nombre de paliers de luminosité des graduations (un tracé par palier). */
const LEVELS = 6;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Écart angulaire signé replié dans -π..π. */
function angDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function makeOrb(canvas: HTMLCanvasElement, opts: OrbOptions = {}): OrbHandle {
  const maybeCtx = canvas.getContext("2d", { alpha: true });
  if (!maybeCtx) throw new Error("Canvas 2D context indisponible.");
  // Type non-nullable explicite : la narrowing n'est pas conservée dans les closures.
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const coreRatio = opts.coreRatio ?? 0.165;
  const idleFps = opts.idleFps ?? 0;
  const idleFrameMs = idleFps > 0 ? 1000 / idleFps : 0;
  const floating = opts.floating ?? false;
  let theme: OrbTheme = opts.theme ?? "dark";
  const reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Géométrie ----
  let w = 0;
  let h = 0;
  let dpr = 1;
  let r0 = 20; // rayon de repos du cœur (px CSS)
  let auraSprite: HTMLCanvasElement | null = null;
  let specSprite: HTMLCanvasElement | null = null;
  let shadeSprite: HTMLCanvasElement | null = null;
  let warmSprite: HTMLCanvasElement | null = null;
  let coolSprite: HTMLCanvasElement | null = null;
  let causticSprite: HTMLCanvasElement | null = null;
  let shadowSprite: HTMLCanvasElement | null = null;

  // ---- Physique ----
  const membrane = new Membrane();
  const center = new Spring2D();
  const nodeBand = new Float32Array(NODES);
  for (let i = 0; i < NODES; i++) nodeBand[i] = spectralPosition(membrane.angle[i]!);
  const tickAngle = new Float32Array(TICKS);
  const tickBand = new Float32Array(TICKS);
  const tickCos = new Float32Array(TICKS);
  const tickSin = new Float32Array(TICKS);
  for (let j = 0; j < TICKS; j++) {
    // Graduation 0 en haut, sens horaire (lecture de cadran).
    const a = -Math.PI / 2 + (j / TICKS) * TAU;
    tickAngle[j] = a;
    tickBand[j] = spectralPosition(a);
    tickCos[j] = Math.cos(a);
    tickSin[j] = Math.sin(a);
  }
  const tickVal = new Float32Array(TICKS);
  const tickPeak = new Float32Array(TICKS);
  const tickLight = new Float32Array(TICKS);

  // ---- Entrées ----
  let state: OrbState = "idle";
  const bandsTarget = new Float32Array(VOICE_BANDS);
  const bands = new Float32Array(VOICE_BANDS);
  let levelTarget = 0;
  let level = 0;
  let listen = 0; // 0..1, lissé : l'orbe « se tend » quand elle écoute
  let ptrX: number | null = null; // px CSS relatifs au centre
  let ptrY: number | null = null;
  let presence = 0;
  let lastPtrAngle = 0; // conservé quand le curseur s'en va : le reflet s'éteint sur place
  let motionTX = 0;
  let motionTY = 0;
  let motionX = 0;
  let motionY = 0;
  // Position d'équilibre courante du centre (penché vers le curseur, traînée).
  let centerTX = 0;
  let centerTY = 0;

  // ---- Horloges ----
  let clock = 0; // s, horloge d'animation
  let acc = 0; // accumulateur du pas fixe
  let last = performance.now();
  let lastDraw = 0;
  let confirmAt = -1;
  let errorAt = -1;
  let introAt = performance.now();
  let outroAt = -1;
  let launchAt = -1;
  let lastLaunch = -1;
  let launchAngle = -Math.PI / 2;
  // Phase du liquide intérieur : avance vite quand l'orbe travaille, à peine au repos.
  let flowPhase = 0.6;

  // ---- Boucle ----
  let active = false;
  let rafId: number | null = null;
  let timerId: number | null = null;

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width || canvas.clientWidth || 200;
    const ch = rect.height || canvas.clientHeight || 200;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    w = cw;
    h = ch;
    r0 = Math.min(w, h) * coreRatio;
    buildSprites();
  }

  /** Halo et reflet pré-rendus : un drawImage par image au lieu de dégradés recalculés. */
  function buildSprites(): void {
    const auraR = Math.ceil(r0 * 2.9);
    const aura = document.createElement("canvas");
    aura.width = aura.height = Math.max(2, Math.round(auraR * 2 * dpr));
    const actx = aura.getContext("2d");
    if (actx) {
      const c = aura.width / 2;
      const g = actx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, "rgba(255,164,122,0.34)");
      g.addColorStop(0.3, "rgba(214,120,220,0.2)");
      g.addColorStop(0.55, "rgba(150,100,255,0.09)");
      g.addColorStop(1, "rgba(150,100,255,0)");
      actx.fillStyle = g;
      actx.fillRect(0, 0, aura.width, aura.height);
    }
    auraSprite = aura;

    const spec = document.createElement("canvas");
    const s = Math.max(2, Math.round(r0 * 0.9 * dpr));
    spec.width = s;
    spec.height = s;
    const sctx = spec.getContext("2d");
    if (sctx) {
      const c = s / 2;
      const g = sctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, "rgba(255,250,242,0.62)");
      g.addColorStop(0.5, "rgba(255,246,236,0.2)");
      g.addColorStop(1, "rgba(255,246,236,0)");
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, s, s);
    }
    specSprite = spec;

    // Ombre de volume : éclairée en haut à gauche, le bord opposé s'assombrit (sphère).
    shadeSprite = radialSprite(r0 * 2.2, [
      [0, "rgba(22,10,58,0)"],
      [0.5, "rgba(22,10,58,0)"],
      [0.78, "rgba(22,10,58,0.22)"],
      [1, "rgba(22,10,58,0.5)"],
    ]);
    // Nappes du liquide intérieur (chaude et froide) et lumière transmise en bas.
    warmSprite = radialSprite(r0 * 1.6, [
      [0, "rgba(255,142,196,0.55)"],
      [0.55, "rgba(255,142,196,0.16)"],
      [1, "rgba(255,142,196,0)"],
    ]);
    coolSprite = radialSprite(r0 * 1.6, [
      [0, "rgba(96,110,255,0.5)"],
      [0.55, "rgba(96,110,255,0.14)"],
      [1, "rgba(96,110,255,0)"],
    ]);
    causticSprite = radialSprite(r0 * 1.2, [
      [0, "rgba(255,214,176,0.62)"],
      [0.5, "rgba(255,190,160,0.2)"],
      [1, "rgba(255,190,160,0)"],
    ]);
    shadowSprite = floating
      ? radialSprite(r0 * 2.4, [
          [0, "rgba(8,6,18,0.34)"],
          [0.45, "rgba(8,6,18,0.16)"],
          [1, "rgba(8,6,18,0)"],
        ])
      : null;
  }

  /** Disque dégradé pré-rendu (diamètre en px CSS). */
  function radialSprite(diameter: number, stops: [number, string][]): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = Math.max(2, Math.round(diameter * dpr));
    const g2 = c.getContext("2d");
    if (g2) {
      const m = c.width / 2;
      const g = g2.createRadialGradient(m, m, 0, m, m, m);
      for (const [at, color] of stops) g.addColorStop(at, color);
      g2.fillStyle = g;
      g2.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }

  // ------------------------------------------------------------------ simulation

  /** Temps écoulé (ms) depuis un horodatage, -1 si inactif. */
  function since(at: number, now: number): number {
    return at < 0 ? -1 : now - at;
  }

  function simulate(dt: number, now: number): void {
    clock += dt;

    // Lissage des entrées audio (attaque vive, relâche douce).
    const listening = state === "listening";
    level = follow(level, listening ? levelTarget : 0, dt, 22, 6);
    for (let b = 0; b < VOICE_BANDS; b++) {
      bands[b] = follow(bands[b]!, listening ? bandsTarget[b]! : 0, dt, 26, 7);
    }
    listen = follow(listen, listening ? 1 : 0, dt, 9, 4);
    const working = state === "transcribing" ? 1 : 0;
    flowPhase += dt * (0.12 + 0.9 * listen + 1.5 * working + 0.8 * Math.min(1, level));
    presence = follow(presence, ptrX !== null ? 1 : 0, dt, 10, 5);
    motionX = follow(motionX, motionTX, dt, 18, 18);
    motionY = follow(motionY, motionTY, dt, 18, 18);
    // La vitesse de déplacement s'éteint d'elle-même si plus rien n'arrive.
    motionTX *= Math.exp(-dt * 8);
    motionTY *= Math.exp(-dt * 8);

    // ---- Cibles de la membrane ----
    const voice = 0.2 + 0.1 * Math.min(1, level);
    const thinking = state === "transcribing" ? 1 : 0;
    // Curseur : proximité 1 au contact du bord, 0 à ~3,5 rayons.
    let proximity = 0;
    let ptrAngle = 0;
    let ptrDist = 0;
    if (ptrX !== null && ptrY !== null) {
      ptrDist = Math.hypot(ptrX, ptrY);
      proximity = clamp01(1 - (ptrDist - r0) / (r0 * 2.6));
      ptrAngle = Math.atan2(ptrY, ptrX);
    }
    const pull = presence * proximity;
    const speed = Math.hypot(motionX, motionY);
    const stretch = Math.min(0.14, speed * 0.05);
    const dir = Math.atan2(motionY, motionX);

    const { target, angle } = membrane;
    for (let i = 0; i < NODES; i++) {
      const a = angle[i]!;
      let t =
        voice * sampleBands(bands, nodeBand[i]!) * (0.78 + 0.22 * Math.sin(3 * a + clock * 7));
      if (thinking) t += 0.032 * Math.sin(2 * a - clock * 3.6);
      if (pull > 0.001) {
        const dd = angDiff(a, ptrAngle);
        t += pull * 0.16 * Math.exp(-(dd * dd) / (2 * 0.46 * 0.46));
      }
      if (stretch > 0.001) t += stretch * Math.cos(2 * (a - dir));
      target[i] = t;
    }

    // ---- Cible du centre : penche vers le curseur, traîne derrière la fenêtre ----
    let tx = 0;
    let ty = 0;
    if (pull > 0.001 && ptrDist > 1e-3) {
      const reach = Math.min(1, ptrDist / (r0 * 0.5));
      tx += (ptrX! / ptrDist) * 0.13 * pull * reach;
      ty += (ptrY! / ptrDist) * 0.13 * pull * reach;
    }
    tx += Math.max(-0.35, Math.min(0.35, -motionX * 0.045));
    ty += Math.max(-0.35, Math.min(0.35, -motionY * 0.045));

    centerTX = tx;
    centerTY = ty;

    // ---- Pas fixes ----
    acc = Math.min(acc + dt, STEP * MAX_STEPS);
    while (acc >= STEP) {
      membrane.step(STEP);
      center.step(tx, ty, STEP);
      acc -= STEP;
    }

    // ---- Graduations : spectre + crêtes mémorisées ----
    for (let j = 0; j < TICKS; j++) {
      const v = listening ? Math.min(1, sampleBands(bands, tickBand[j]!) * 1.15) : 0;
      tickVal[j] = follow(tickVal[j]!, v, dt, 30, 6);
      tickPeak[j] = Math.max(tickVal[j]!, tickPeak[j]! - dt * 0.55);
    }

    // États transitoires terminés → retour au repos.
    if (confirmAt >= 0 && now - confirmAt > CONFIRM_MS) confirmAt = -1;
    if (errorAt >= 0 && now - errorAt > ERROR_MS) errorAt = -1;
    if (launchAt >= 0 && now - launchAt > LAUNCH_MS) launchAt = -1;
  }

  /** Vrai s'il se passe quelque chose qui mérite la pleine cadence. */
  function busy(now: number): boolean {
    if (state !== "idle") return true;
    if (outroAt >= 0) return true;
    if (confirmAt >= 0 || errorAt >= 0 || launchAt >= 0) return true;
    if (now - introAt < INTRO_MS) return true;
    // Curseur présent mais immobile : une fois la matière posée, on se rendort aussi.
    if (Math.abs(presence - (ptrX !== null ? 1 : 0)) > 0.01) return true;
    if (Math.abs(motionTX) + Math.abs(motionTY) > 0.01 || Math.hypot(motionX, motionY) > 0.01)
      return true;
    if (level > 0.004 || listen > 0.004) return true;
    return membrane.energy() > 1e-5 || center.energy(centerTX, centerTY) > 1e-6;
  }

  // ------------------------------------------------------------------ rendu

  function draw(now: number): void {
    const cx = w / 2;
    const cy = h / 2;

    // Allumage : ressort qui dépasse légèrement puis se pose.
    const ie = (now - introAt) / INTRO_MS;
    const spring = reduceMotion || ie >= 1 ? 1 : 1 - 0.3 * Math.exp(-5 * ie) * Math.cos(8 * ie);
    // Sortie : l'orbe se rétracte vers son centre et s'efface (accélère en partant).
    const out = outroProgress(now);
    const intro = spring * (1 - 0.22 * out);
    const introAlpha = (reduceMotion ? 1 : clamp01(ie * 3)) * (1 - out);

    const breath = reduceMotion || idleFps === 0 ? 0 : 0.022 * Math.sin(clock * 1.25);
    const R = r0 * intro * (1 + breath + 0.05 * listen + 0.16 * Math.min(1.2, level));
    const ox = cx + center.x * r0;
    const oy = cy + center.y * r0;

    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = introAlpha;

    // ---- Halo (pré-rendu), plus présent quand l'orbe travaille ----
    if (auraSprite) {
      const energy = Math.max(
        listen * (0.55 + 0.45 * Math.min(1, level)),
        state === "transcribing" ? 0.5 : 0,
      );
      const half = Math.min(w, h) / 2;
      const ar = Math.min(R * 2.9, half);
      ctx.globalAlpha = introAlpha * (0.5 + 0.5 * energy);
      ctx.drawImage(auraSprite, ox - ar, oy - ar, ar * 2, ar * 2);
      ctx.globalAlpha = introAlpha;
    }

    // Ombre portée (orbe flottante) : ancre l'objet sur un fond clair.
    if (shadowSprite) {
      const sw = R * 2.5;
      const sh = R * 1.3;
      ctx.globalAlpha = introAlpha * (0.9 - 0.3 * listen);
      ctx.drawImage(shadowSprite, ox - sw / 2, oy + R * 0.62 - sh / 2, sw, sh);
      ctx.globalAlpha = introAlpha;
    }

    drawTicks(now, cx, cy, intro);
    drawCore(ox, oy, R, introAlpha, now);
    drawTransients(now, cx, cy, R, intro);

    ctx.globalAlpha = 1;
  }

  function drawTicks(now: number, cx: number, cy: number, intro: number): void {
    const pal = TICK_PALETTE[theme];
    const ringR = r0 * RING * intro;
    const unit = r0 / 22; // graduations proportionnelles à la taille de l'orbe
    const lineW = Math.max(1, r0 * 0.058);

    // Lumière de chaque graduation = max(spectre, comète, balayage, curseur).
    const cometOn = state === "transcribing";
    const comet = -Math.PI / 2 + (clock * TAU) / 1.15;
    const ce = since(confirmAt, now);
    const sweep = ce >= 0 ? (ce / (CONFIRM_MS * 0.55)) * TAU : -1;
    const ee = since(errorAt, now);
    // Erreur : l'anneau vire à l'ambre d'un coup, puis s'éteint (lisible même en un coup d'œil).
    const warn = ee < 0 ? 0 : ee < 90 ? ee / 90 : clamp01(1 - (ee - 90) / (ERROR_MS - 90));
    const hover = presence;
    const ptrAngle = lastPtrAngle;
    const le = since(launchAt, now);
    const flare = le < 0 ? 0 : Math.pow(1 - clamp01(le / LAUNCH_MS), 1.4);
    // La confirmation qui suit un lancer rayonne depuis la direction du texte.
    const sweepFrom = lastLaunch >= 0 && now - lastLaunch < 900 ? launchAngle : null;

    for (let j = 0; j < TICKS; j++) {
      let l = tickVal[j]!;
      const a = tickAngle[j]!;
      if (cometOn) {
        // Tête vive, traîne qui s'efface derrière (sens horaire).
        const behind = -angDiff(a, comet); // > 0 derrière la tête
        if (behind >= -0.12 && behind < 1.6)
          l = Math.max(l, behind < 0 ? 1 + behind * 8 : 1 - behind / 1.6);
      }
      if (sweep >= 0) {
        // Depuis le haut (sens horaire), ou depuis la direction du lancer (des deux côtés).
        const travelled =
          sweepFrom === null ? (a + Math.PI / 2 + TAU) % TAU : Math.abs(angDiff(a, sweepFrom)) * 2;
        const lag = sweep - travelled;
        if (lag >= 0) l = Math.max(l, clamp01(1 - lag / 2.2) * clamp01(1.4 - ce / CONFIRM_MS));
      }
      if (flare > 0.01) {
        const dd = angDiff(a, launchAngle);
        l = Math.max(l, flare * Math.exp(-(dd * dd) / (2 * 0.3 * 0.3)));
      }
      if (hover > 0.01) {
        const dd = angDiff(a, ptrAngle);
        l = Math.max(l, hover * 0.55 * Math.exp(-(dd * dd) / (2 * 0.32 * 0.32)));
      }
      if (warn > 0.01) l = Math.max(l, 0.42 * warn);
      tickLight[j] = clamp01(l);
    }

    ctx.lineCap = "round";
    // Orbe flottante : un fin halo sombre sous chaque graduation, lisible sur fond blanc.
    if (floating) {
      ctx.beginPath();
      for (let j = 0; j < TICKS; j++) {
        const l = tickLight[j]!;
        const cardinal = j % 15 === 0;
        const len = ((cardinal ? 4 : 2.2) + l * 8.5) * unit;
        const c = tickCos[j]!;
        const s = tickSin[j]!;
        ctx.moveTo(cx + c * ringR, cy + s * ringR);
        ctx.lineTo(cx + c * (ringR + len), cy + s * (ringR + len));
      }
      ctx.lineWidth = lineW + Math.max(0.7, r0 * 0.035);
      ctx.strokeStyle = "rgba(14,10,30,0.16)";
      ctx.stroke();
    }
    ctx.lineWidth = lineW;
    const base = pal.baseAlpha + 0.14 * listen;
    for (let lv = 0; lv < LEVELS; lv++) {
      const k = lv / (LEVELS - 1);
      const col = warn > 0.01 ? pal.warn : pal.hot;
      const r = Math.round(mix(pal.idle[0], col[0], warn > 0.01 ? Math.max(k, warn) : k));
      const g = Math.round(mix(pal.idle[1], col[1], warn > 0.01 ? Math.max(k, warn) : k));
      const b = Math.round(mix(pal.idle[2], col[2], warn > 0.01 ? Math.max(k, warn) : k));
      let drew = false;
      ctx.beginPath();
      for (let j = 0; j < TICKS; j++) {
        const l = tickLight[j]!;
        if (Math.min(LEVELS - 1, Math.floor(l * LEVELS)) !== lv) continue;
        const cardinal = j % 15 === 0;
        const len = ((cardinal ? 4 : 2.2) + l * 8.5) * unit;
        const c = tickCos[j]!;
        const s = tickSin[j]!;
        ctx.moveTo(cx + c * ringR, cy + s * ringR);
        ctx.lineTo(cx + c * (ringR + len), cy + s * (ringR + len));
        drew = true;
      }
      if (!drew) continue;
      const alpha = lv === 0 ? base : mix(base, 0.96, k);
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.stroke();
    }

    // Repères cardinaux légèrement plus présents au repos (lecture de cadran).
    if (listen < 0.5 && !cometOn) {
      ctx.beginPath();
      for (let j = 0; j < TICKS; j += 15) {
        if (tickLight[j]! > 0.1) continue;
        const c = tickCos[j]!;
        const s = tickSin[j]!;
        ctx.moveTo(cx + c * ringR, cy + s * ringR);
        ctx.lineTo(cx + c * (ringR + 4 * unit), cy + s * (ringR + 4 * unit));
      }
      const [r, g, b] = pal.idle;
      ctx.strokeStyle = `rgba(${r},${g},${b},${pal.baseAlpha + 0.2})`;
      ctx.stroke();
    }

    // Crêtes mémorisées (écoute) : un point précis au-dessus de chaque graduation.
    if (listen > 0.05) {
      const [r, g, b] = pal.hot;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.8 * listen})`;
      ctx.beginPath();
      const dot = Math.max(0.8, lineW * 0.62);
      for (let j = 0; j < TICKS; j++) {
        const p = tickPeak[j]!;
        if (p < 0.08) continue;
        const cardinal = j % 15 === 0;
        const rr = ringR + ((cardinal ? 4 : 2.2) + p * 8.5 + 2.4) * unit;
        const x = cx + tickCos[j]! * rr;
        const y = cy + tickSin[j]! * rr;
        ctx.moveTo(x + dot, y);
        ctx.arc(x, y, dot, 0, TAU);
      }
      ctx.fill();
    }
  }

  function drawCore(ox: number, oy: number, R: number, alpha: number, now: number): void {
    const { d, cos, sin } = membrane;
    // Contour lissé : quadratiques passant par les milieux des nœuds (aucune arête).
    ctx.beginPath();
    const px = (i: number): number => ox + cos[i]! * R * (1 + d[i]!);
    const py = (i: number): number => oy + sin[i]! * R * (1 + d[i]!);
    const lastI = NODES - 1;
    ctx.moveTo((px(lastI) + px(0)) / 2, (py(lastI) + py(0)) / 2);
    for (let i = 0; i < NODES; i++) {
      const n = i === lastI ? 0 : i + 1;
      ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(n)) / 2, (py(i) + py(n)) / 2);
    }
    ctx.closePath();

    // Volume : source de lumière en haut à gauche, ombre propre en bas à droite.
    const lx = ox - R * 0.3 + center.x * R * 0.4;
    const ly = oy - R * 0.36 + center.y * R * 0.4;
    const fill = ctx.createRadialGradient(lx, ly, R * 0.04, ox, oy, R * 1.28);
    for (const [at, color] of CORE_STOPS) fill.addColorStop(at, color);
    ctx.fillStyle = fill;
    ctx.fill();

    // ---- Intérieur (découpé à la membrane) : liquide, lumière transmise, volume ----
    ctx.save();
    ctx.clip();
    const work = Math.max(listen, state === "transcribing" ? 1 : 0);
    if (warmSprite && coolSprite) {
      // Deux nappes qui tournent l'une autour de l'autre, plus présentes quand l'orbe travaille.
      const orbit = R * (0.34 + 0.08 * work);
      const bw = R * (1.5 + 0.2 * Math.min(1, level));
      ctx.globalAlpha = alpha * (0.42 + 0.4 * work);
      ctx.drawImage(
        warmSprite,
        ox + Math.cos(flowPhase) * orbit - bw / 2,
        oy + Math.sin(flowPhase * 0.83) * orbit * 0.8 - bw / 2,
        bw,
        bw,
      );
      ctx.drawImage(
        coolSprite,
        ox + Math.cos(flowPhase + Math.PI) * orbit - bw / 2,
        oy + Math.sin(flowPhase * 0.83 + Math.PI) * orbit * 0.8 + R * 0.2 - bw / 2,
        bw,
        bw,
      );
    }
    if (causticSprite) {
      // Lumière qui traverse le liquide et ressort en bas, à l'opposé de la source.
      const cw = R * 1.3;
      const ch = R * 0.7;
      ctx.globalAlpha = alpha * (0.55 + 0.25 * work);
      ctx.drawImage(
        causticSprite,
        ox + R * 0.12 - center.x * R * 0.3 - cw / 2,
        oy + R * 0.62 - center.y * R * 0.3 - ch / 2,
        cw,
        ch,
      );
    }
    if (shadeSprite) {
      const sr = R * 2.3;
      ctx.globalAlpha = alpha;
      ctx.drawImage(shadeSprite, lx + R * 0.18 - sr / 2, ly + R * 0.2 - sr / 2, sr, sr);
    }
    ctx.restore();
    ctx.globalAlpha = alpha;

    // Liseré net : c'est lui qui donne la « précision » de la matière.
    const rim = ctx.createLinearGradient(ox - R, oy - R, ox + R, oy + R);
    rim.addColorStop(0, "rgba(255,240,226,0.7)");
    rim.addColorStop(0.55, "rgba(255,240,226,0.12)");
    rim.addColorStop(1, "rgba(255,240,226,0.03)");
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(0.9, R * 0.045);
    ctx.stroke();

    // Reflet spéculaire (pré-rendu), qui glisse légèrement avec la masse.
    if (specSprite) {
      const sx = ox - R * 0.36 + center.x * R * 0.25;
      const sy = oy - R * 0.44 + center.y * R * 0.25;
      const sw = R * 0.78;
      const sh = R * 0.5;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-0.5);
      ctx.drawImage(specSprite, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    // Reflet net (la fenêtre du studio) : c'est lui qui dit « verre », pas « dégradé ».
    const le = since(launchAt, now);
    const kick = le < 0 ? 0 : 1 - clamp01(le / 280);
    ctx.save();
    ctx.translate(ox - R * 0.4 + center.x * R * 0.2, oy - R * 0.5 + center.y * R * 0.2);
    ctx.rotate(-0.62);
    ctx.fillStyle = `rgba(255,252,247,${0.72 + 0.28 * kick})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.17, R * 0.085, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Écoute : un cœur chaud qui respire avec la voix.
    if (listen > 0.02 && specSprite) {
      const hr = R * (0.55 + 0.35 * Math.min(1, level));
      ctx.globalAlpha = alpha * listen * (0.35 + 0.4 * Math.min(1, level));
      ctx.drawImage(specSprite, ox - hr, oy - hr * 0.8, hr * 2, hr * 2);
      ctx.globalAlpha = alpha;
    }
  }

  function drawTransients(now: number, cx: number, cy: number, R: number, intro: number): void {
    const ce = since(confirmAt, now);
    if (ce >= 0) {
      // Onde de confirmation : un cercle fin qui s'élargit et s'efface.
      const e = clamp01(ce / (CONFIRM_MS * 0.9));
      const ease = 1 - Math.pow(1 - e, 3);
      const rr = mix(R * 1.05, r0 * RING * intro * 1.25, ease);
      ctx.strokeStyle = `rgba(255,214,186,${0.55 * (1 - e)})`;
      ctx.lineWidth = Math.max(1, r0 * 0.05) * (1 - e * 0.6);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.stroke();
    }
  }

  /** Avancement adouci de la sortie (0 = pleinement là, 1 = effacée). */
  function outroProgress(now: number): number {
    if (outroAt < 0) return 0;
    const e = clamp01((now - outroAt) / OUTRO_MS);
    return e * e * (3 - 2 * e);
  }

  /** Fin de sortie : canvas vide (Windows réaffichera cette image au prochain affichage). */
  function finishOutro(): void {
    outroAt = -1;
    active = false;
    stopLoop();
    ctx.clearRect(0, 0, w, h);
  }

  // ------------------------------------------------------------------ boucle

  function frame(now: number): void {
    rafId = null;
    timerId = null;
    if (!active) return;
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    simulate(dt, now);
    if (outroAt >= 0 && now - outroAt >= OUTRO_MS) {
      finishOutro();
      return;
    }
    draw(now);
    lastDraw = now;
    schedule();
  }

  function schedule(): void {
    if (!active || reduceMotion || rafId !== null || timerId !== null) return;
    const now = performance.now();
    if (busy(now)) {
      rafId = requestAnimationFrame((t) => {
        // Plafond ~60 i/s sur les écrans à haute fréquence.
        if (t - lastDraw < ACTIVE_MIN_FRAME_MS) {
          rafId = null;
          schedule();
          return;
        }
        frame(t);
      });
    } else if (idleFrameMs > 0) {
      // Respiration lente optionnelle : un minuteur, aucune image entre deux battements.
      timerId = window.setTimeout(() => frame(performance.now()), idleFrameMs);
    }
    // Sinon : posée et au repos → plus rien ne tourne jusqu'au prochain événement.
  }

  /** Repasse immédiatement en pleine cadence (un événement vient d'arriver). */
  function wake(): void {
    if (!active || reduceMotion) return;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    schedule();
  }

  function renderStatic(): void {
    // Image fixe (reduced-motion ou rendu ponctuel) : valeurs d'état sans animation.
    const now = performance.now();
    listen = state === "listening" ? 1 : 0;
    for (let j = 0; j < TICKS; j++) {
      tickVal[j] = state === "listening" ? 0.3 : 0;
      tickPeak[j] = 0;
    }
    draw(now);
  }

  function stopLoop(): void {
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (timerId !== null) clearTimeout(timerId);
    rafId = null;
    timerId = null;
  }

  const ro = new ResizeObserver(() => {
    resize();
    if (reduceMotion) renderStatic();
    else wake();
  });
  ro.observe(canvas);
  resize();

  return {
    setFrame(frame: VoiceFrame): void {
      if (reduceMotion) return;
      levelTarget = Math.max(0, Math.min(1.4, frame.level || 0));
      for (let b = 0; b < VOICE_BANDS; b++) bandsTarget[b] = clamp01(frame.bands[b] ?? 0);
      wake();
    },
    setState(next: OrbState): void {
      // Confirmation et erreur se rejouent même répétées ; les autres états sont idempotents.
      if (next === state && next !== "confirmed" && next !== "error") return;
      state = next;
      const now = performance.now();
      if (next === "confirmed") {
        confirmAt = now;
        errorAt = -1;
        membrane.impulse(1.4); // petit « pop » de satisfaction
      } else if (next === "error") {
        errorAt = now;
        confirmAt = -1;
        center.vx += 3.2; // secoue la tête : non.
      } else if (next === "listening") {
        errorAt = -1;
        tickPeak.fill(0);
      }
      if (reduceMotion) renderStatic();
      else wake();
    },
    setActive(on: boolean, animate = false): void {
      const now = performance.now();
      if (!on) {
        if (!active || outroAt >= 0) return;
        if (animate && !reduceMotion) {
          // La boucle continue jusqu'à la fin de la sortie, puis s'arrête d'elle-même.
          outroAt = now;
          wake();
        } else if (animate) {
          finishOutro();
        } else {
          active = false;
          stopLoop();
        }
        return;
      }
      if (outroAt >= 0) {
        // Rappelée pendant sa sortie : elle revient depuis son opacité courante, sans saut.
        const shown = 1 - outroProgress(now);
        outroAt = -1;
        introAt = now - (shown / 3) * INTRO_MS;
        wake();
        return;
      }
      if (active) return;
      active = true;
      last = now;
      introAt = now;
      if (reduceMotion) renderStatic();
      else schedule();
    },
    setPointer(nx: number | null, ny: number | null): void {
      if (reduceMotion) return;
      if (nx === null || ny === null) {
        ptrX = ptrY = null;
      } else {
        ptrX = nx * (w / 2);
        ptrY = ny * (h / 2);
        lastPtrAngle = Math.atan2(ptrY, ptrX);
      }
      wake();
    },
    setMotion(vx: number, vy: number): void {
      if (reduceMotion) return;
      // Borne pour qu'un pic de mesure ne produise pas une secousse absurde.
      motionTX = Math.max(-30, Math.min(30, vx || 0));
      motionTY = Math.max(-30, Math.min(30, vy || 0));
      wake();
    },
    setTheme(next: OrbTheme): void {
      theme = next;
      if (reduceMotion) renderStatic();
      else wake();
    },
    launch(dx: number, dy: number): void {
      if (reduceMotion || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const n = Math.hypot(dx, dy);
      if (n < 1e-3) return;
      const now = performance.now();
      launchAt = now;
      lastLaunch = now;
      launchAngle = Math.atan2(dy, dx);
      // Jet de matière vers le texte, puis la membrane se referme en vagues.
      membrane.impulseToward(launchAngle, 3.4, 0.42);
      // Recul : le cœur part dans l'autre sens (action / réaction), puis revient.
      center.vx -= (dx / n) * 2.4;
      center.vy -= (dy / n) * 2.4;
      wake();
    },
    destroy(): void {
      active = false;
      stopLoop();
      ro.disconnect();
    },
  };
}
