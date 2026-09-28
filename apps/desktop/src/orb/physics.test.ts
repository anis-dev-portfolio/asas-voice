import { describe, expect, it } from "vitest";
import { follow, Membrane, NODES, sampleBands, spectralPosition, Spring2D, STEP } from "./physics";

function run(m: Membrane, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) m.step(STEP);
}

describe("Membrane", () => {
  it("se pose après une impulsion (amortie, stable)", () => {
    const m = new Membrane();
    m.impulse(2);
    expect(m.energy()).toBeGreaterThan(0.1);
    run(m, 3);
    expect(m.energy()).toBeLessThan(1e-6);
    expect(Math.max(...Array.from(m.d).map(Math.abs))).toBeLessThan(1e-3);
  });

  it("lance un jet de matière dans une direction, puis se referme", () => {
    const m = new Membrane();
    // Vers le bas (angle π/2, sens canvas) : le nœud du bas pousse, celui du haut à peine.
    m.impulseToward(Math.PI / 2, 3, 0.4);
    const bottom = NODES / 4;
    const top = (3 * NODES) / 4;
    expect(m.v[bottom]!).toBeCloseTo(3, 5);
    expect(Math.abs(m.v[top]!)).toBeLessThan(1e-6);
    run(m, 3);
    expect(m.energy()).toBeLessThan(1e-6);
  });

  it("propage une déformation locale aux voisins (vague)", () => {
    const m = new Membrane();
    m.v[0] = 5;
    run(m, 0.05);
    expect(Math.abs(m.d[4]!)).toBeGreaterThan(1e-4);
    // … et la déformation reste bornée.
    expect(Math.max(...Array.from(m.d).map(Math.abs))).toBeLessThan(1);
  });

  it("suit une cible et y reste sans diverger (pas de NaN, même sous excitation)", () => {
    const m = new Membrane();
    for (let frame = 0; frame < 600; frame++) {
      for (let i = 0; i < NODES; i++) m.target[i] = 0.2 * Math.sin(i * 0.7 + frame * 0.3);
      m.step(STEP);
    }
    for (const x of m.d) expect(Number.isFinite(x)).toBe(true);
    for (let i = 0; i < NODES; i++) m.target[i] = 0.1;
    run(m, 3);
    expect(m.d[10]).toBeCloseTo(0.1, 2);
  });
});

describe("Spring2D", () => {
  it("rebondit (sous-amorti) puis revient au repos", () => {
    const s = new Spring2D();
    s.vx = 3;
    let crossedBack = false;
    for (let i = 0; i < 120; i++) {
      s.step(0, 0, STEP);
      if (s.x < 0) crossedBack = true;
    }
    expect(crossedBack).toBe(true); // dépasse le repos : effet « gelée »
    for (let i = 0; i < 480; i++) s.step(0, 0, STEP);
    expect(s.energy()).toBeLessThan(1e-6);
  });
});

describe("helpers", () => {
  it("spectralPosition : graves en bas, aigus en haut, symétrique", () => {
    expect(spectralPosition(Math.PI / 2)).toBeCloseTo(0); // bas
    expect(spectralPosition(-Math.PI / 2)).toBeCloseTo(1); // haut
    expect(spectralPosition(0)).toBeCloseTo(0.5); // droite
    expect(spectralPosition(Math.PI)).toBeCloseTo(0.5); // gauche
    expect(spectralPosition(0.3)).toBeCloseTo(spectralPosition(Math.PI - 0.3));
  });

  it("sampleBands interpole et borne", () => {
    const bands = [0, 1];
    expect(sampleBands(bands, 0.5)).toBeCloseTo(0.5);
    expect(sampleBands(bands, 2)).toBe(1);
    expect(sampleBands([], 0.5)).toBe(0);
  });

  it("follow : attaque plus vive que la relâche, sans dépasser la cible", () => {
    const up = follow(0, 1, 0.1, 20, 2);
    const down = follow(1, 0, 0.1, 20, 2);
    expect(up).toBeGreaterThan(1 - down);
    expect(up).toBeLessThanOrEqual(1);
  });
});
