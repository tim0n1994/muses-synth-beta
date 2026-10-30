import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";

import routeSource from "./route.tsx?raw";
import { signatureRoutes } from "./route.js";

describe("signature lazy route", () => {
  it("exposes a /signature route whose page is code-split (lazy)", async () => {
    const routes = signatureRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]!.path).toBe("/signature");

    render(<Suspense fallback={null}>{routes[0]!.element}</Suspense>);
    expect(
      await screen.findByRole("heading", { name: /vibe signature/i }),
    ).toBeInTheDocument();
  });

  it("declares the page with lazy() + dynamic import for code splitting", () => {
    expect(routeSource).toMatch(/\blazy\b/);
    expect(routeSource).toContain("import(");
  });
});
