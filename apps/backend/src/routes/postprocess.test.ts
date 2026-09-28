import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "@asas-voice/shared";
import type { BackendEnv } from "../env";
import { makeReply, makeRequest } from "../test-support";
import { handlePostprocessError, postprocessRoutes } from "./postprocess";

function testEnv(overrides: Partial<BackendEnv> = {}): BackendEnv {
  return {
    port: 4321,
    mistralApiKey: "test-mistral-key",
    anthropicApiKey: "test-anthropic-key",
    transcriptionModel: "voxtral-mini-latest",
    ...overrides,
  };
}

async function makeApp(env: BackendEnv) {
  const app = Fastify();
  await postprocessRoutes(app, env);
  return app;
}

const okHeaders = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };

describe("POST /postprocess — validation (avant appel Claude)", () => {
  it("refuse une valeur d'en-tête client incorrecte (403)", async () => {
    const app = await makeApp(testEnv());
    const res = await app.inject({
      method: "POST",
      url: "/postprocess",
      headers: { [CLIENT_HEADER]: "mauvaise-valeur" },
      payload: { text: "salut" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
    await app.close();
  });

  it("renvoie 503 si la clé Anthropic est absente", async () => {
    const app = await makeApp(testEnv({ anthropicApiKey: undefined }));
    const res = await app.inject({
      method: "POST",
      url: "/postprocess",
      headers: okHeaders,
      payload: { text: "salut" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("no_anthropic_key");
    await app.close();
  });

  it("renvoie 400 si le texte est vide", async () => {
    const app = await makeApp(testEnv());
    const res = await app.inject({
      method: "POST",
      url: "/postprocess",
      headers: okHeaders,
      payload: { text: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("missing_text");
    await app.close();
  });

  it("rejette un texte trop long (413 text_too_long)", async () => {
    const app = await makeApp(testEnv());
    const res = await app.inject({
      method: "POST",
      url: "/postprocess",
      headers: okHeaders,
      payload: { text: "a".repeat(9000) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("text_too_long");
    await app.close();
  });
});

describe("handlePostprocessError — mapping des erreurs Anthropic", () => {
  it("timeout → 504 upstream_timeout", () => {
    const cap = makeReply();
    handlePostprocessError(
      makeRequest(),
      cap.reply,
      new Anthropic.APIConnectionTimeoutError({ message: "timeout" }),
    );
    expect(cap.statusCode).toBe(504);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("upstream_timeout");
  });

  it("connexion impossible → 502 upstream_error", () => {
    const cap = makeReply();
    handlePostprocessError(
      makeRequest(),
      cap.reply,
      new Anthropic.APIConnectionError({ message: "conn" }),
    );
    expect(cap.statusCode).toBe(502);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("upstream_error");
  });

  it("clé invalide 401 → 502 invalid_api_key", () => {
    const cap = makeReply();
    handlePostprocessError(
      makeRequest(),
      cap.reply,
      new Anthropic.APIError(401, undefined, "unauthorized", new Headers()),
    );
    expect(cap.statusCode).toBe(502);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("invalid_api_key");
  });

  it("quota 429 → 429 rate_limited + Retry-After", () => {
    const cap = makeReply();
    handlePostprocessError(
      makeRequest(),
      cap.reply,
      new Anthropic.APIError(429, undefined, "rate", new Headers({ "retry-after": "9" })),
    );
    expect(cap.statusCode).toBe(429);
    const payload = cap.payload as { error: { code: string; retryAfterSec?: number } };
    expect(payload.error.code).toBe("rate_limited");
    expect(payload.error.retryAfterSec).toBe(9);
    expect(cap.headers["retry-after"]).toBe("9");
  });

  it("autre statut HTTP → 502 upstream_error", () => {
    const cap = makeReply();
    handlePostprocessError(
      makeRequest(),
      cap.reply,
      new Anthropic.APIError(500, undefined, "boom", new Headers()),
    );
    expect(cap.statusCode).toBe(502);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("upstream_error");
  });

  it("erreur non-Anthropic → 500 internal_error", () => {
    const cap = makeReply();
    handlePostprocessError(makeRequest(), cap.reply, new Error("bizarre"));
    expect(cap.statusCode).toBe(500);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("internal_error");
  });
});
