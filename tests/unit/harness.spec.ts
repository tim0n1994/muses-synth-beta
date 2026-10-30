import { describe, expect, test } from "vitest";
import { validateStaticShellConfig } from "../helpers/config-security.js";
import { assertLoopbackUrl } from "../helpers/test-config.js";

describe("local-only harness", () => {
  test("accepts loopback and rejects cloud targets", () => {
    expect(
      assertLoopbackUrl("http://127.0.0.1:43119/v0", "test").hostname,
    ).toBe("127.0.0.1");
    expect(() => assertLoopbackUrl("https://example.com/v0", "test")).toThrow(
      /loopback/iu,
    );
    expect(() => assertLoopbackUrl("file:///tmp/muses", "test")).toThrow(
      /http or ws/iu,
    );
  });
});

describe("static shell security oracle", () => {
  test("allows only the eight declarative component types", () => {
    const valid = {
      schemaVersion: "0.1",
      components: [
        { id: "state", type: "state.hero", props: {} },
        { id: "belief", type: "belief.distribution", props: {} },
      ],
    } as const;
    expect(validateStaticShellConfig(valid)).toEqual([]);
  });

  test("detects executable values and unknown components", () => {
    const invalid = {
      schemaVersion: "0.1",
      components: [
        {
          id: "bad",
          type: "custom.javascript",
          props: { onClick: "javascript:alert(1)" },
        },
      ],
    } as const;
    expect(validateStaticShellConfig(invalid)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/onClick/u),
        expect.stringMatching(/unknown/u),
      ]),
    );
  });
});
