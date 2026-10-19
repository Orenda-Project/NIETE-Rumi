import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), readDisagreementsOn: vi.fn() }));
import { readDisagreementsOn } from "./api";
import { DisagreementsEntry } from "./frame";

/** bd-tbprit.3 — the entry row on Reports shows only when coach_disagreement_card is on for her. */
const on = vi.mocked(readDisagreementsOn);
beforeEach(() => vi.clearAllMocks());

const renderEntry = () => render(<MemoryRouter><DisagreementsEntry /></MemoryRouter>);

describe("DisagreementsEntry", () => {
  it("on: one row to the list", async () => {
    on.mockResolvedValue(true);
    renderEntry();
    const link = await screen.findByTestId("disagreements-entry");
    expect(link).toHaveAttribute("href", "/portal/coach/disagreements");
    expect(link).toHaveTextContent("Teachers who disagreed");
  });

  it("off: nothing at all", async () => {
    on.mockResolvedValue(false);
    const { container } = renderEntry();
    await waitFor(() => expect(on).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
