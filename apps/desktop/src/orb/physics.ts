/*
 * Physique de l'orbe — pure, sans DOM, testée.
 *
 * Le contour du cœur est une MEMBRANE : un anneau de nœuds, chacun avec un déplacement
 * radial (fraction du rayon de repos) et une vitesse. Trois forces :
 *  - rappel vers une cible (voix, curseur, ballottement) — raideur `stiffness` ;
 *  - tension entre voisins (laplacien discret) — les déformations se PROPAGENT en vagues
 *    autour de l'orbe au lieu d'apparaître sur place ;
 *  - amortissement — tout finit par se poser.
 * Intégration semi-implicite (Euler symplectique) à pas fixe : stable pour
 * ω·dt < 2, soit ici ω_max ≈ √(stiffness + 4·tension) ≈ 97 rad/s à 120 Hz (0,81).
 *
 * Le centre du cœur est un ressort 2D sous-amorti (penché vers le curseur, traîne
 * derrière la fenêtre qu'on déplace, secousse d'erreur) : c'est lui qui donne le rebond
 * « gélatineux ».
 */

export const NODES = 64;
/** Pas d'intégration fixe (s). */
export const STEP = 1 / 120;
/** Nombre max de pas rattrapés par image (au-delà, on abandonne le retard). */
export const MAX_STEPS = 32;

const STIFFNESS = 140;
const TENSION = 2300;
const DAMPING = 9;

const CENTER_K = 170;
const CENTER_D = 11; // ζ ≈ 0,42 : un rebond franc qui s'apaise vite

export class Membrane {
  /** Déplacement radial de chaque nœud (fraction du rayon de repos). */
  readonly d = new Float32Array(NODES);
  /** Vitesse radiale de chaque nœud. */
  readonly v = new Float32Array(NODES);
  /** Cible radiale de chaque nœud (écrite par l'appelant avant step()). */
  readonly target = new Float32Array(NODES);
  /** Angle (rad, sens canvas : 0 = droite, horaire) et trigonométrie pré-calculés. */
  readonly angle = new Float32Array(NODES);
  readonly cos = new Float32Array(NODES);
  readonly sin = new Float32Array(NODES);

  constructor() {
    for (let i = 0; i < NODES; i++) {
      const a = (i / NODES) * Math.PI * 2;
      this.angle[i] = a;
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
    }
  }

  /** Avance la simulation d'un pas fixe `dt`. */
  step(dt: number): void {
    const { d, v, target } = this;
    for (let i = 0; i < NODES; i++) {
      const prev = d[i === 0 ? NODES - 1 : i - 1]!;
      const next = d[i === NODES - 1 ? 0 : i + 1]!;
      const di = d[i]!;
      const lap = prev + next - 2 * di;
      const a = STIFFNESS * (target[i]! - di) + TENSION * lap - DAMPING * v[i]!;
      v[i] = v[i]! + a * dt;
    }
    for (let i = 0; i < NODES; i++) d[i] = d[i]! + v[i]! * dt;
  }

  /** Impulsion radiale uniforme (positive = vers l'extérieur). */
  impulse(amount: number): void {
    for (let i = 0; i < NODES; i++) this.v[i] = this.v[i]! + amount;
  }

  /**
   * Impulsion radiale localisée autour d'un angle (sens canvas), en cloche de largeur
   * `width` (rad) : un « jet » de matière dans une direction, qui se propage ensuite en
   * vagues autour de la membrane.
   */
  impulseToward(angle: number, amount: number, width: number): void {
    const TAU = Math.PI * 2;
    for (let i = 0; i < NODES; i++) {
      let d = (this.angle[i]! - angle) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      this.v[i] = this.v[i]! + amount * Math.exp(-(d * d) / (2 * width * width));
    }
  }

  /** Énergie (cinétique + écart à la cible) moyenne — sert à savoir si tout est posé. */
  energy(): number {
    let e = 0;
    for (let i = 0; i < NODES; i++) {
      const off = this.d[i]! - this.target[i]!;
      e += this.v[i]! * this.v[i]! + STIFFNESS * off * off;
    }
    return e / NODES;
  }

  reset(): void {
    this.d.fill(0);
    this.v.fill(0);
    this.target.fill(0);
  }
}

/** Ressort 2D sous-amorti (centre du cœur), en unités de rayon de repos. */
export class Spring2D {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;

  step(tx: number, ty: number, dt: number): void {
    this.vx += (CENTER_K * (tx - this.x) - CENTER_D * this.vx) * dt;
    this.vy += (CENTER_K * (ty - this.y) - CENTER_D * this.vy) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** Énergie par rapport à une position d'équilibre (tx, ty) — 0 quand tout est posé. */
  energy(tx = 0, ty = 0): number {
    const dx = this.x - tx;
    const dy = this.y - ty;
    return this.vx * this.vx + this.vy * this.vy + CENTER_K * (dx * dx + dy * dy);
  }

  reset(): void {
    this.x = this.y = this.vx = this.vy = 0;
  }
}

/** Lissage exponentiel indépendant de la cadence : attaque rapide, relâche douce. */
export function follow(
  current: number,
  target: number,
  dt: number,
  attack: number,
  release: number,
): number {
  const rate = target > current ? attack : release;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * Position « spectrale » d'un angle du canvas : 0 en BAS (graves), 1 en HAUT (aigus),
 * symétrique gauche/droite. L'orbe et son anneau se lisent comme un analyseur de
 * spectre circulaire posé sur ses graves.
 */
export function spectralPosition(angle: number): number {
  const TAU = Math.PI * 2;
  // u : 0 en haut, 0.5 en bas, sens horaire.
  const u = ((((angle + Math.PI / 2) % TAU) + TAU) % TAU) / TAU;
  const fromTop = u <= 0.5 ? u * 2 : (1 - u) * 2; // 0 haut → 1 bas
  return 1 - fromTop;
}

/** Échantillonne un tableau de bandes à une position fractionnaire 0..1 (interpolation linéaire). */
export function sampleBands(bands: ArrayLike<number>, pos: number): number {
  const n = bands.length;
  if (n === 0) return 0;
  const x = Math.min(1, Math.max(0, pos)) * (n - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = bands[i] ?? 0;
  const b = bands[Math.min(n - 1, i + 1)] ?? 0;
  return a + (b - a) * f;
}
