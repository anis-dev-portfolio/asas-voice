import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "@asas-voice/shared";
import type { BackendEnv } from "../env";

// Les SDK sont remplacés par des doubles : on teste la classification et la route,
// jamais un vrai appel réseau.
const mistralRetrieve = vi.fn();
const anthropicRetrieve = vi.fn();
vi.mock("../stt", () => ({
  mistralClient: () => ({ models: { retrieve: mistralRetrieve } }),
}));
vi.mock("./postprocess", async (importOriginal) => {
  const original = await importOriginal<typeof import("./postprocess")>();
  return {
    ...original,
    anthropicClient: () => ({ models: { retrieve: anthropicRetrieve } }),
  };
});

import {
  classifyAnthropicError,
  classifyMistralError,
  describeEngines,
  engineRoutes,
  verifyCorrection,
  verifyTranscription,
} from "./engines";

function testEnv(overrides: Partial<BackendEnv> = {}): BackendEnv {
  return {
    port: 4321,
    mistralApiKey: "test-mistral-key",
    anthropicApiKey: "test-anthropic-key",
    transcriptionModel: "voxtral-mini-latest",
    ...overrides,
  };
}

function namedError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe("classifyMistralError", () => {
  it("réseau / délai → unreachable", () => {
    for (const name of ["ConnectionError", "RequestTimeoutError", "RequestAbortedError"]) {
      expect(classifyMistralError(namedError(name)).status).toBe("unreachable");
    }
  });
  it("401 / 403 → invalid_key", () => {
    expect(classifyMistralError({ statusCode: 401 }).status).toBe("invalid_key");
    expect(classifyMistralError({ statusCode: 403 }).status).toBe("invalid_key");
  });
  it("404 → model_unavailable, 429 → rate_limited", () => {
    expect(classifyMistralError({ statusCode: 404 }).status).toBe("model_unavailable");
    expect(classifyMistralError({ statusCode: 429 }).status).toBe("rate_limited");
  });
  it("autre statut → error avec le code HTTP dans le message", () => {
    const v = classifyMistralError({ statusCode: 500 });
    expect(v.status).toBe("error");
    expect(v.message).toContain("HTTP 500");
  });
});

describe("classifyAnthropicError", () => {
  it("timeout et connexion → unreachable", () => {
    expect(
      classifyAnthropicError(new Anthropic.APIConnectionTimeoutError({ message: "t" })).status,
    ).toBe("unreachable");
    expect(classifyAnthropicError(new Anthropic.APIConnectionError({ message: "c" })).status).toBe(
      "unreachable",
    );
  });
  it("401 / 403 → invalid_key ; 404 → model_unavailable ; 429 → rate_limited", () => {
    const h = new Headers();
    expect(
      classifyAnthropicError(new Anthropic.AuthenticationError(401, undefined, "x", h)).status,
    ).toBe("invalid_key");
    expect(
      classifyAnthropicError(new Anthropic.PermissionDeniedError(403, undefined, "x", h)).status,
    ).toBe("invalid_key");
    expect(classifyAnthropicError(new Anthropic.NotFoundError(404, undefined, "x", h)).status).toBe(
      "model_unavailable",
    );
    expect(
      classifyAnthropicError(new Anthropic.RateLimitError(429, undefined, "x", h)).status,
    ).toBe("rate_limited");
  });
  it("erreur inconnue → error", () => {
    expect(classifyAnthropicError(new Error("boom")).status).toBe("error");
  });
});

describe("verifyTranscription / verifyCorrection", () => {
  beforeEach(() => {
    mistralRetrieve.mockReset();
    anthropicRetrieve.mockReset();
  });

  it("clé absente → missing_key sans appel réseau", async () => {
    const t = await verifyTranscription(testEnv({ mistralApiKey: undefined }));
    const c = await verifyCorrection(testEnv({ anthropicApiKey: undefined }));
    expect(t.status).toBe("missing_key");
    expect(c.status).toBe("missing_key");
    expect(mistralRetrieve).not.toHaveBeenCalled();
    expect(anthropicRetrieve).not.toHaveBeenCalled();
  });

  it("succès → ok + modèle résolu + latence", async () => {
    mistralRetrieve.mockResolvedValue({ id: "voxtral-mini-2602" });
    anthropicRetrieve.mockResolvedValue({ id: "claude-haiku-4-5-20251001" });
    const t = await verifyTranscription(testEnv());
    const c = await verifyCorrection(testEnv());
    expect(t).toMatchObject({
      id: "transcription",
      status: "ok",
      resolvedModel: "voxtral-mini-2602",
    });
    expect(c).toMatchObject({
      id: "correction",
      status: "ok",
      resolvedModel: "claude-haiku-4-5-20251001",
    });
    expect(typeof t.latencyMs).toBe("number");
    // Le modèle demandé est bien celui de la configuration.
    expect(mistralRetrieve.mock.calls[0]?.[0]).toEqual({ modelId: "voxtral-mini-latest" });
    expect(anthropicRetrieve.mock.calls[0]?.[0]).toBe("claude-haiku-4-5");
  });

  it("clé refusée → invalid_key", async () => {
    mistralRetrieve.mockRejectedValue({ statusCode: 401 });
    const t = await verifyTranscription(testEnv());
    expect(t.status).toBe("invalid_key");
  });
});

describe("routes /engines", () => {
  beforeEach(() => {
    mistralRetrieve.mockReset().mockResolvedValue({ id: "voxtral-mini-2602" });
    anthropicRetrieve.mockReset().mockResolvedValue({ id: "claude-haiku-4-5-20251001" });
  });

  async function makeApp(env: BackendEnv) {
    const app = Fastify();
    await engineRoutes(app, env);
    return app;
  }

  it("GET /engines décrit les moteurs réels", async () => {
    const app = await makeApp(testEnv({ anthropicApiKey: undefined }));
    const res = await app.inject({ method: "GET", url: "/engines" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(describeEngines(testEnv({ anthropicApiKey: undefined })));
    expect(res.json().transcription.model).toBe("voxtral-mini-latest");
    expect(res.json().correction.configured).toBe(false);
    await app.close();
  });

  it("POST /engines/verify exige l'en-tête client", async () => {
    const app = await makeApp(testEnv());
    const res = await app.inject({ method: "POST", url: "/engines/verify", payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("POST /engines/verify vérifie uniquement les moteurs demandés", async () => {
    const app = await makeApp(testEnv());
    const res = await app.inject({
      method: "POST",
      url: "/engines/verify",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
      payload: { engines: ["transcription"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transcription.status).toBe("ok");
    expect(body.correction).toBeUndefined();
    expect(anthropicRetrieve).not.toHaveBeenCalled();
    await app.close();
  });

  it("POST /engines/verify sans liste → les deux moteurs", async () => {
    const app = await makeApp(testEnv());
    const res = await app.inject({
      method: "POST",
      url: "/engines/verify",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
      payload: {},
    });
    const body = res.json();
    expect(body.transcription.status).toBe("ok");
    expect(body.correction.status).toBe("ok");
    await app.close();
  });
});
