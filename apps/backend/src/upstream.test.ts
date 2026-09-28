import { describe, expect, it } from "vitest";
import { extractRetryAfter, getProp, readHeader } from "./upstream";

describe("extractRetryAfter", () => {
  it("lit Retry-After depuis un objet Headers (fetch)", () => {
    const err = { headers: new Headers({ "retry-after": "7" }) };
    expect(extractRetryAfter(err)).toBe(7);
  });

  it("lit Retry-After depuis un simple record", () => {
    const err = { headers: { "retry-after": "12" } };
    expect(extractRetryAfter(err)).toBe(12);
  });

  it("lit Retry-After depuis rawResponse.headers", () => {
    const err = { rawResponse: { headers: new Headers({ "retry-after": "3" }) } };
    expect(extractRetryAfter(err)).toBe(3);
  });

  it("lit Retry-After depuis response.headers", () => {
    const err = { response: { headers: { "retry-after": "5" } } };
    expect(extractRetryAfter(err)).toBe(5);
  });

  it("arrondit une valeur fractionnaire au supérieur", () => {
    expect(extractRetryAfter({ headers: { "retry-after": "2.4" } })).toBe(3);
  });

  it("renvoie undefined si absent", () => {
    expect(extractRetryAfter({ headers: new Headers() })).toBeUndefined();
    expect(extractRetryAfter({})).toBeUndefined();
    expect(extractRetryAfter(null)).toBeUndefined();
  });

  it("ignore une valeur non numérique (format date HTTP)", () => {
    const err = { headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } };
    expect(extractRetryAfter(err)).toBeUndefined();
  });

  it("ignore une valeur négative", () => {
    expect(extractRetryAfter({ headers: { "retry-after": "-1" } })).toBeUndefined();
  });
});

describe("getProp", () => {
  it("renvoie la propriété d'un objet, undefined sinon", () => {
    expect(getProp({ a: 1 }, "a")).toBe(1);
    expect(getProp({ a: 1 }, "b")).toBeUndefined();
    expect(getProp(null, "a")).toBeUndefined();
    expect(getProp("str", "length")).toBeUndefined();
  });
});

describe("readHeader", () => {
  it("gère Headers, record et absence", () => {
    expect(readHeader(new Headers({ "x-test": "v" }), "x-test")).toBe("v");
    expect(readHeader({ "x-test": "v" }, "x-test")).toBe("v");
    expect(readHeader({ "x-num": 42 }, "x-num")).toBe("42");
    expect(readHeader(undefined, "x-test")).toBeUndefined();
  });
});
