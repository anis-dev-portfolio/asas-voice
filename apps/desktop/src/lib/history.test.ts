import { describe, expect, it, vi } from "vitest";

// history.ts importe le plugin SQL Tauri au niveau module : on le neutralise pour
// tester la seule logique pure (échappement LIKE) hors runtime Tauri.
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: class {
    static load(): Promise<unknown> {
      return Promise.resolve({});
    }
  },
}));

import { escapeLikePattern } from "./history";

describe("escapeLikePattern", () => {
  it("échappe le joker % ", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
  });

  it("échappe le joker _", () => {
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("échappe le backslash", () => {
    expect(escapeLikePattern("c\\d")).toBe("c\\\\d");
  });

  it("laisse un terme sans joker intact", () => {
    expect(escapeLikePattern("bonjour")).toBe("bonjour");
  });

  it("échappe plusieurs jokers dans un même terme", () => {
    expect(escapeLikePattern("%_\\")).toBe("\\%\\_\\\\");
  });
});
