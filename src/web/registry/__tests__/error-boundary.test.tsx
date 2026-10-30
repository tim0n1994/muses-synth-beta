import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../../design-system";
import { RegistryErrorBoundary } from "../RegistryErrorBoundary";

function ThrowingComponent(): never {
  throw new Error("test failure");
}

describe("RegistryErrorBoundary", () => {
  it("isolates a component render failure", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onError = vi.fn();

    render(
      <DesignSystemProvider>
        <RegistryErrorBoundary
          componentId="broken"
          onError={onError}
          requestedType="state.hero"
        >
          <ThrowingComponent />
        </RegistryErrorBoundary>
        <p>Sibling survives</p>
      </DesignSystemProvider>,
    );

    expect(screen.getByText("Sibling survives")).toBeInTheDocument();
    expect(
      screen.getByText("Reason: component.render-error"),
    ).toBeInTheDocument();
    expect(onError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
