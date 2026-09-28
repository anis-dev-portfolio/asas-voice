import { afterEach, describe, expect, it, vi } from "vitest";
import { pickSupportedMimeType } from "./recorder";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickSupportedMimeType", () => {
  it("renvoie undefined si MediaRecorder est absent (repli)", () => {
    // En environnement Node, MediaRecorder n'existe pas par défaut.
    expect(pickSupportedMimeType()).toBeUndefined();
  });

  it("préfère audio/webm;codecs=opus quand tout est supporté", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    expect(pickSupportedMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("retombe sur audio/webm si opus n'est pas supporté", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (type: string) => type === "audio/webm",
    });
    expect(pickSupportedMimeType()).toBe("audio/webm");
  });
});
