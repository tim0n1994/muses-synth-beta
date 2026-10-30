import { describe, expect, it } from "vitest";
import { MAX_JSON_DEPTH } from "../constants";
import {
  CanonicalJsonError,
  canonicalJson,
  canonicalJsonByteLength,
  hashCanonicalJson,
  sha256Hex,
} from "../canonical-json";

describe("canonical JSON and SHA-256", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: [3, 1] } })).toBe(
      '{"a":{"x":[3,1],"y":2},"z":1}',
    );
  });

  it("normalizes negative zero and preserves finite JSON number rendering", () => {
    expect(
      canonicalJson({ negativeZero: -0, decimal: 1.25, exponent: 1e30 }),
    ).toBe('{"decimal":1.25,"exponent":1e+30,"negativeZero":0}');
  });

  it("produces deterministic hashes for equivalent recursive key orders", () => {
    const left = { b: 2, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 2 };
    expect(hashCanonicalJson(left)).toBe(hashCanonicalJson(right));
  });

  it("does not normalize array order", () => {
    expect(hashCanonicalJson([1, 2])).not.toBe(hashCanonicalJson([2, 1]));
  });

  it("matches standard SHA-256 vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("中")).toBe(
      "a567bdaa11367f260f0708391f4d10766b5962f565d9e432f17981a3584fe1e2",
    );
  });

  it("measures canonical UTF-8 bytes", () => {
    const canonical = '{"value":"中"}';
    expect(canonicalJsonByteLength({ value: "中" })).toBe(
      new TextEncoder().encode(canonical).byteLength,
    );
  });

  it("rejects non-JSON values", () => {
    const values: readonly unknown[] = [
      { value: undefined },
      { value: 1n },
      { value: () => true },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: new Date("2026-01-01T00:00:00.000Z") },
    ];
    for (const value of values) {
      expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
    }
  });

  it("rejects circular references", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it("rejects sparse arrays", () => {
    const value = new Array<unknown>(2);
    value[1] = true;
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it("rejects accessor and non-enumerable properties without invoking accessors", () => {
    const accessor: Record<string, unknown> = {};
    let invoked = false;
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "must not execute";
      },
    });
    const nonEnumerable: Record<string, unknown> = {};
    Object.defineProperty(nonEnumerable, "hidden", {
      enumerable: false,
      value: true,
    });

    expect(() => canonicalJson(accessor)).toThrow(CanonicalJsonError);
    expect(invoked).toBe(false);
    expect(() => canonicalJson(nonEnumerable)).toThrow(CanonicalJsonError);
  });

  it("rejects values deeper than the project maximum", () => {
    let value: unknown = null;
    for (let index = 0; index <= MAX_JSON_DEPTH; index += 1) {
      value = [value];
    }
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });
});
