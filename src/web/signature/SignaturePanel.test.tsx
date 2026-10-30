import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createMemoryDraftStorage } from "./storage.js";
import { createMemoryFeedbackJournal } from "./calibration-journal.js";
import { SignaturePanel } from "./SignaturePanel.js";

function makeProps() {
  const storage = createMemoryDraftStorage();
  const journal = createMemoryFeedbackJournal();
  const props = { storage, journal };
  return { props, storage, journal };
}

describe("SignaturePanel", () => {
  it("renders the heading and all three template choices", () => {
    const { props } = makeProps();
    render(<SignaturePanel {...props} />);
    expect(
      screen.getByRole("heading", { name: /vibe signature/i }),
    ).toBeInTheDocument();
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveTextContent(/Minimal electronic/i);
    expect(group).toHaveTextContent(/Ambient/i);
    expect(group).toHaveTextContent(/Lo-fi jazz/i);
  });

  it("shows the template defaults as the effective signature summary", () => {
    const { props } = makeProps();
    render(<SignaturePanel {...props} />);
    const summary = screen.getByTestId("signature-summary");
    expect(summary).toHaveTextContent(/118–138/);
    expect(summary).toHaveTextContent(/0\.70/);
  });

  it("picking another template updates the summary and persists the draft", async () => {
    const { props, storage } = makeProps();
    const user = userEvent.setup();
    render(<SignaturePanel {...props} />);
    await user.click(screen.getByRole("radio", { name: /Ambient/i }));
    expect(await screen.findByTestId("signature-summary")).toHaveTextContent(
      /60–80/,
    );
    const saved = storage.load();
    expect(saved?.templateId).toBe("ambient");
  });

  it("editing BPM bounds updates the summary and persists calibration", async () => {
    const { props, storage } = makeProps();
    const user = userEvent.setup();
    render(<SignaturePanel {...props} />);
    const minInput = screen.getByLabelText(/BPM lower bound/i);
    await user.clear(minInput);
    await user.type(minInput, "125");
    expect(await screen.findByTestId("signature-summary")).toHaveTextContent(
      /125–138/,
    );
    expect(storage.load()?.calibration.bpmRange?.min).toBe(125);
  });

  it("rejects inverted BPM windows with a visible error and keeps the last valid summary", async () => {
    const { props, storage } = makeProps();
    const user = userEvent.setup();
    render(<SignaturePanel {...props} />);
    const minInput = screen.getByLabelText(/BPM lower bound/i);
    await user.clear(minInput);
    await user.type(minInput, "150");
    expect(await screen.findByRole("alert")).toHaveTextContent(/BPM/i);
    expect(screen.getByTestId("signature-summary")).toHaveTextContent(
      /118–138/,
    );
    expect(storage.load()?.calibration.bpmRange).toBeUndefined();
  });

  it("states that skip/relisten events are recorded but not used for learning", () => {
    const { props } = makeProps();
    render(<SignaturePanel {...props} />);
    expect(screen.getByText(/recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/not.*learn/i)).toBeInTheDocument();
  });
});
