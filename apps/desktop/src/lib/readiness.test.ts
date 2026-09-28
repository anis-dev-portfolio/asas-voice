import { describe, expect, it } from "vitest";
import type { EngineCheck, HealthResponse } from "@asas-voice/shared";
import { computeReadiness, type ReadinessInput } from "./readiness";

const health: HealthResponse = {
  status: "ok",
  service: "asas-voice-backend",
  ready: true,
  hasAnthropicKey: false,
  uptimeSec: 3,
};

function check(id: EngineCheck["id"], status: EngineCheck["status"]): EngineCheck {
  return { id, status, message: "", checkedAt: 0 };
}

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    service: "up",
    health,
    transcriptionCheck: check("transcription", "ok"),
    correctionCheck: null,
    verifying: false,
    micPermission: "granted",
    micCount: 1,
    shortcutOk: true,
    correctionEnabled: false,
    ...overrides,
  };
}

const item = (r: ReturnType<typeof computeReadiness>, id: string) =>
  r.items.find((i) => i.id === id);

describe("computeReadiness", () => {
  it("tout va bien → Prêt", () => {
    const r = computeReadiness(input());
    expect(r.level).toBe("ready");
    expect(r.headline).toBe("Prêt");
    expect(item(r, "correction")?.state).toBe("off");
  });

  it("service arrêté → bloqué, la clé attend le service", () => {
    const r = computeReadiness(input({ service: "down", health: null }));
    expect(r.level).toBe("blocked");
    expect(r.headline).toBe("Service arrêté");
    expect(item(r, "transcription")?.state).toBe("pending");
  });

  it("clé absente → bloqué « Clé manquante » avec correctif vers Moteurs", () => {
    const r = computeReadiness(input({ health: { ...health, ready: false } }));
    expect(r.level).toBe("blocked");
    expect(r.headline).toBe("Clé manquante");
    expect(item(r, "transcription")?.fix).toBe("engines");
  });

  it("clé refusée par Mistral → bloqué « Clé refusée »", () => {
    const r = computeReadiness(
      input({ transcriptionCheck: check("transcription", "invalid_key") }),
    );
    expect(r.headline).toBe("Clé refusée");
  });

  it("modèle inaccessible → libellé exact", () => {
    const r = computeReadiness(
      input({ transcriptionCheck: check("transcription", "model_unavailable") }),
    );
    expect(r.headline).toBe("Modèle inaccessible");
  });

  it("réseau coupé → dégradé « Hors ligne », pas bloqué", () => {
    const r = computeReadiness(
      input({ transcriptionCheck: check("transcription", "unreachable") }),
    );
    expect(r.level).toBe("degraded");
    expect(r.headline).toBe("Hors ligne");
  });

  it("clé pas encore vérifiée → en cours de vérification", () => {
    const r = computeReadiness(input({ transcriptionCheck: null, verifying: true }));
    expect(r.level).toBe("checking");
    expect(item(r, "transcription")?.detail).toBe("Vérification…");
  });

  it("aucun micro ou accès refusé → bloqué", () => {
    expect(computeReadiness(input({ micCount: 0 })).headline).toBe("Aucun micro");
    expect(computeReadiness(input({ micPermission: "denied" })).headline).toBe("Accès refusé");
  });

  it("raccourci pris par une autre app → bloqué", () => {
    expect(computeReadiness(input({ shortcutOk: false })).headline).toBe("Raccourci indisponible");
  });

  it("correction activée sans clé Anthropic → dégradé seulement (texte livré brut)", () => {
    const r = computeReadiness(input({ correctionEnabled: true }));
    expect(r.level).toBe("degraded");
    expect(item(r, "correction")?.detail).toBe("Clé manquante");
  });

  it("correction activée et vérifiée → prêt", () => {
    const r = computeReadiness(
      input({
        correctionEnabled: true,
        health: { ...health, hasAnthropicKey: true },
        correctionCheck: check("correction", "ok"),
      }),
    );
    expect(r.level).toBe("ready");
  });

  it("une erreur bloquante l'emporte sur une vérification en cours", () => {
    const r = computeReadiness(
      input({ shortcutOk: false, transcriptionCheck: null, verifying: true }),
    );
    expect(r.level).toBe("blocked");
  });
});
