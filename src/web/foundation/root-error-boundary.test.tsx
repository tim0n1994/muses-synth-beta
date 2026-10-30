// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RootErrorBoundary } from "./root-error-boundary.js";

function BrokenView(): React.JSX.Element {
  throw new Error("private rendering detail");
}

describe("RootErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a safe local fallback without exposing the thrown message", () => {
    render(
      <RootErrorBoundary>
        <BrokenView />
      </RootErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Muses could not render this view.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "private rendering detail",
    );
    expect(screen.getByRole("button", { name: "Retry view" })).toBeEnabled();
  });
});
