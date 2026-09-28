import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "@asas-voice/shared";
import type { BackendEnv } from "../env";
import { makeReply, makeRequest } from "../test-support";

// La couche STT est mockée : on teste la ROUTE (validation, mapping), pas Voxtral.
vi.mock("../stt", () => ({ transcribe: vi.fn() }));
import { transcribe } from "../stt";
import { extractUpstreamDetail, handleUpstreamError, transcribeRoutes } from "./transcribe";

function testEnv(overrides: Partial<BackendEnv> = {}): BackendEnv {
  return {
    port: 4321,
    mistralApiKey: "test-mistral-key",
    anthropicApiKey: undefined,
    transcriptionModel: "voxtral-mini-latest",
    ...overrides,
  };
}

interface Part {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  content?: Buffer;
}

/** Construit un corps multipart/form-data brut pour app.inject. */
function multipartBody(parts: Part[]): { body: Buffer; contentType: string } {
  const boundary = "----asasTestBoundary1234567890";
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"`;
    head += "\r\n";
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`;
    head += "\r\n";
    chunks.push(Buffer.from(head, "utf8"));
    chunks.push(p.content ?? Buffer.from(p.value ?? "", "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function makeApp(env: BackendEnv) {
  const app = Fastify();
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5, parts: 10 },
  });
  await transcribeRoutes(app, env);
  return app;
}

const audioPart: Part = {
  name: "file",
  filename: "clip.webm",
  contentType: "audio/webm",
  content: Buffer.from("fake-audio-bytes"),
};

describe("POST /transcribe — validation", () => {
  beforeEach(() => {
    vi.mocked(transcribe).mockReset();
    vi.mocked(transcribe).mockResolvedValue({ text: "bonjour", durationSec: 1.2 });
  });

  it("refuse une requête sans en-tête client (403)", async () => {
    const app = await makeApp(testEnv());
    const res = await app.inject({ method: "POST", url: "/transcribe" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
    await app.close();
  });

  it("refuse une valeur d'en-tête client incorrecte (403)", async () => {
    const app = await makeApp(testEnv());
    const res = await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: "mauvaise-valeur" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("renvoie 500 missing_api_key si la clé serveur est absente", async () => {
    const app = await makeApp(testEnv({ mistralApiKey: undefined }));
    const res = await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("missing_api_key");
    await app.close();
  });

  it("renvoie 400 si aucun fichier audio n'est fourni", async () => {
    const app = await makeApp(testEnv());
    const { body, contentType } = multipartBody([{ name: "language", value: "fr" }]);
    const res = await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_audio");
    await app.close();
  });

  it("rejette un type MIME non audio (415)", async () => {
    const app = await makeApp(testEnv());
    const { body, contentType } = multipartBody([
      { name: "file", filename: "notes.txt", contentType: "text/plain", content: Buffer.from("x") },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(415);
    await app.close();
  });

  it("transcrit un audio valide, transmet la langue et ignore un ancien champ « quality »", async () => {
    const app = await makeApp(testEnv());
    const { body, contentType } = multipartBody([
      audioPart,
      { name: "language", value: "fr" },
      { name: "quality", value: "fast" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: "bonjour", durationSec: 1.2 });
    const params = vi.mocked(transcribe).mock.calls[0]?.[1];
    expect(params?.language).toBe("fr");
    expect(params).not.toHaveProperty("quality");
    await app.close();
  });

  it("ignore une langue inconnue (détection auto)", async () => {
    const app = await makeApp(testEnv());
    const { body, contentType } = multipartBody([audioPart, { name: "language", value: "xx" }]);
    await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": contentType },
      payload: body,
    });
    expect(vi.mocked(transcribe).mock.calls[0]?.[1].language).toBeUndefined();
    await app.close();
  });

  it("borne le vocabulaire : rejette les termes > 128 caractères", async () => {
    const app = await makeApp(testEnv());
    const longTerm = "a".repeat(200);
    const vocab = JSON.stringify(["Voxtral", longTerm, "Fastify"]);
    const { body, contentType } = multipartBody([audioPart, { name: "vocabulary", value: vocab }]);
    await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": contentType },
      payload: body,
    });
    const bias = vi.mocked(transcribe).mock.calls[0]?.[1].biasTerms;
    expect(bias).toEqual(["Voxtral", "Fastify"]);
    await app.close();
  });

  it("découpe les expressions en mots (Voxtral refuse espaces et virgules) et dédoublonne", async () => {
    const app = await makeApp(testEnv());
    const vocab = JSON.stringify(["Asas Voice", "Weyda, Fastify", "asas", "Jean-Pierre", 42]);
    const { body, contentType } = multipartBody([audioPart, { name: "vocabulary", value: vocab }]);
    await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": contentType },
      payload: body,
    });
    const bias = vi.mocked(transcribe).mock.calls[0]?.[1].biasTerms;
    expect(bias).toEqual(["Asas", "Voice", "Weyda", "Fastify", "Jean-Pierre"]);
    for (const term of bias ?? []) expect(term).not.toMatch(/[\s,]/);
    await app.close();
  });

  it("ignore un vocabulaire JSON malformé", async () => {
    const app = await makeApp(testEnv());
    const { body, contentType } = multipartBody([
      audioPart,
      { name: "vocabulary", value: "{pas du json" },
    ]);
    await app.inject({
      method: "POST",
      url: "/transcribe",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": contentType },
      payload: body,
    });
    expect(vi.mocked(transcribe).mock.calls[0]?.[1].biasTerms).toBeUndefined();
    await app.close();
  });
});

/** Le mappeur lit `err.name` seulement si `err instanceof Error` → vraie Error. */
function namedError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

describe("handleUpstreamError — mapping des erreurs Voxtral", () => {
  it("timeout → 504 upstream_timeout", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, namedError("RequestTimeoutError"));
    expect(cap.statusCode).toBe(504);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("upstream_timeout");
  });

  it("RequestAbortedError → 504", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, namedError("RequestAbortedError"));
    expect(cap.statusCode).toBe(504);
  });

  it("ConnectionError → 502 upstream_error", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, namedError("ConnectionError"));
    expect(cap.statusCode).toBe(502);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("upstream_error");
  });

  it("clé invalide 401/403 → 502 invalid_api_key", () => {
    for (const statusCode of [401, 403]) {
      const cap = makeReply();
      handleUpstreamError(makeRequest(), cap.reply, { statusCode });
      expect(cap.statusCode).toBe(502);
      expect((cap.payload as { error: { code: string } }).error.code).toBe("invalid_api_key");
    }
  });

  it("audio indécodable code 3310 → 422 invalid_audio", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, {
      statusCode: 400,
      body: JSON.stringify({ code: "3310" }),
    });
    expect(cap.statusCode).toBe(422);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("invalid_audio");
  });

  it("invalid_request_file → 422 invalid_audio", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, {
      statusCode: 422,
      body: JSON.stringify({ type: "invalid_request_file" }),
    });
    expect(cap.statusCode).toBe(422);
  });

  it("invalid_model → 502 upstream_error avec le message upstream", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, {
      statusCode: 400,
      body: JSON.stringify({ type: "invalid_model", message: "modèle X inconnu" }),
    });
    expect(cap.statusCode).toBe(502);
    const payload = cap.payload as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("upstream_error");
    expect(payload.error.message).toContain("modèle X inconnu");
  });

  it("quota 429 → 429 rate_limited + Retry-After", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, {
      statusCode: 429,
      headers: new Headers({ "retry-after": "8" }),
    });
    expect(cap.statusCode).toBe(429);
    const payload = cap.payload as { error: { code: string; retryAfterSec?: number } };
    expect(payload.error.code).toBe("rate_limited");
    expect(payload.error.retryAfterSec).toBe(8);
    expect(cap.headers["retry-after"]).toBe("8");
  });

  it("erreur upstream générique → 502 avec message", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, {
      statusCode: 500,
      body: JSON.stringify({ message: "boom" }),
    });
    expect(cap.statusCode).toBe(502);
    expect((cap.payload as { error: { message: string } }).error.message).toContain("boom");
  });

  it("erreur inconnue (ni name ni status) → 500 internal_error", () => {
    const cap = makeReply();
    handleUpstreamError(makeRequest(), cap.reply, new Error("bizarre"));
    expect(cap.statusCode).toBe(500);
    expect((cap.payload as { error: { code: string } }).error.code).toBe("internal_error");
  });
});

describe("extractUpstreamDetail", () => {
  it("extrait type/code/message du body JSON", () => {
    const detail = extractUpstreamDetail({
      body: JSON.stringify({ type: "invalid_model", code: "1234", message: "oops" }),
    });
    expect(detail).toEqual({ type: "invalid_model", code: "1234", message: "oops" });
  });

  it("renvoie un objet vide si le body n'est pas du JSON", () => {
    expect(extractUpstreamDetail({ body: "not json" })).toEqual({});
    expect(extractUpstreamDetail({})).toEqual({});
  });
});
