import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, DesignSystemProvider, SwitchField } from "..";

describe("design system accessibility", () => {
  it("applies an explicit theme without mutating document globals", () => {
    const { container } = render(
      <DesignSystemProvider theme="dark">
        <p>Content</p>
      </DesignSystemProvider>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-theme", "dark");
    expect(container.firstElementChild).toHaveClass("muses-root");
  });

  it("keeps keyboard focus on semantic controls", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <DesignSystemProvider>
        <SwitchField
          checked={false}
          label="Enable effect"
          onCheckedChange={onCheckedChange}
        />
        <Button>Continue</Button>
      </DesignSystemProvider>,
    );

    await user.tab();
    expect(screen.getByRole("switch", { name: "Enable effect" })).toHaveFocus();
    await user.keyboard(" ");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    await user.tab();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveFocus();
  });
});
