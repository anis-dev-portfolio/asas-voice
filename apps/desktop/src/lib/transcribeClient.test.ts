import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "@asas-voice/shared";
import { postAudioForTranscription, TranscribeError } from "./transcribeClient";

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Installe un fetch mocké typé (url, init) → renvoie le mock pour inspecter les appels. */
function mockFetchResolving(response: Response) {
  const fn = vi.fn<FetchImpl>(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function formOf(fetchMock: ReturnType<typeof mockFetchResolving>): FormData {
  return fetchMock.mock.calls[0]?.[1]?.body as FormData;
}

const blob = new Blob(["fake-audio"], { type: "audio/webm" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postAudioForTranscription — construction de la requête", () => {
  it("envoie l'en-tête client et le blob, renvoie la transcription", async () => {
    const fetchMock = mockFetchResolving(
      jsonResponse(true, 200, { text: "bonjour", durationSec: 1.5 }),
    );

    const result = await postAudioForTranscription(blob, { language: "fr" });

    expect(result).toEqual({ text: "bonjour", durationSec: 1.5 });
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toContain("/transcribe");
    expect((call?.[1]?.headers as Record<string, string>)[CLIENT_HEADER]).toBe(CLIENT_HEADER_VALUE);
    const form = formOf(fetchMock);
    expect(form.get("language")).toBe("fr");
    expect(form.get("quality")).toBeNull(); // plus de faux choix de « qualité »
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("borne le vocabulaire à 100 termes et ignore les vides", async () => {
    const fetchMock = mockFetchResolving(jsonResponse(true, 200, { text: "x", durationSec: 0 }));

    const vocabulary = [...Array(150).keys()].map((n) => `terme${n}`);
    vocabulary.push("   "); // terme vide → filtré
    await postAudioForTranscription(blob, { language: "fr", vocabulary });

    const raw = formOf(fetchMock).get("vocabulary");
    const parsed = JSON.parse(raw as string) as string[];
    expect(parsed).toHaveLength(100);
    expect(parsed).not.toContain("");
  });

  it("n'ajoute pas de champ vocabulary quand la liste est vide", async () => {
    const fetchMock = mockFetchResolving(jsonResponse(true, 200, { text: "x", durationSec: 0 }));
    await postAudioForTranscription(blob, { language: "fr", vocabulary: [] });
    expect(formOf(fetchMock).get("vocabulary")).toBeNull();
  });
});

describe("postAudioForTranscription — erreurs", () => {
  it("remonte le message ET le code d'erreur du backend sur réponse non-ok", async () => {
    mockFetchResolving(
      jsonResponse(false, 502, { error: { code: "invalid_api_key", message: "Clé refusée" } }),
    );
    const err = await postAudioForTranscription(blob, { language: "fr" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscribeError);
    expect((err as TranscribeError).message).toBe("Clé refusée");
    expect((err as TranscribeError).code).toBe("invalid_api_key");
    expect((err as TranscribeError).status).toBe(502);
  });

  it("service local arrêté (fetch rejette) → service_unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchImpl>(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const err = await postAudioForTranscription(blob, { language: "fr" }).catch((e: unknown) => e);
    expect((err as TranscribeError).code).toBe("service_unreachable");
  });

  it("traduit un AbortError (timeout) en message clair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchImpl>(() => Promise.reject(new DOMException("aborted", "AbortError"))),
    );
    const err = await postAudioForTranscription(blob, { language: "fr" }).catch((e: unknown) => e);
    expect((err as TranscribeError).code).toBe("timeout");
    expect((err as TranscribeError).message).toMatch(/expiré/);
  });
});
