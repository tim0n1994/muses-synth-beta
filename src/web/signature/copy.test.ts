import { describe, expect, it } from "vitest";

import { SIGNATURE_COPY_CATALOGS, SIGNATURE_COPY_KEYS } from "./copy.js";
import { LOCALES } from "../i18n/index.js";

describe("signature copy catalog (five languages)", () => {
  it("covers every supported locale with the same key set as en", () => {
    expect(Object.keys(SIGNATURE_COPY_CATALOGS).sort()).toEqual(
      [...LOCALES].sort(),
    );
    for (const locale of LOCALES) {
      const catalog = SIGNATURE_COPY_CATALOGS[locale];
      expect(Object.keys(catalog).sort()).toEqual(
        [...SIGNATURE_COPY_KEYS].sort(),
      );
    }
  });

  it("has non-empty values everywhere", () => {
    for (const locale of LOCALES) {
      for (const key of SIGNATURE_COPY_KEYS) {
        const value = SIGNATURE_COPY_CATALOGS[locale][key];
        expect(
          typeof value === "string" && value.length > 0,
          `${locale}:${key}`,
        ).toBe(true);
      }
    }
  });

  it("names the three templates in every locale", () => {
    for (const locale of LOCALES) {
      const catalog = SIGNATURE_COPY_CATALOGS[locale];
      expect(
        catalog["signature.template.minimalElectronic.name"].length,
      ).toBeGreaterThan(0);
      expect(catalog["signature.template.ambient.name"].length).toBeGreaterThan(
        0,
      );
      expect(
        catalog["signature.template.lofiJazz.name"].length,
      ).toBeGreaterThan(0);
    }
  });
});
