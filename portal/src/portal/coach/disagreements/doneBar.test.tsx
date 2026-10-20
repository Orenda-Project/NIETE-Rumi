import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  disagreements: { visited: vi.fn(), undone: vi.fn() },
}));
import { disagreements } from "./api";
import { DoneBar, DoneBadge } from "./doneBar";

/**
 * bd-tbprit.12 — Rifat's footer: "✓ Mark as done" with "Tap when you have coached her. The card moves to Done.";
 * on a done card the ✓ Done badge and "Move back to To do". Either tap, once saved, goes back to the list with
 * "<name> moved to Done." / "<name> is back in To do."; a failed save stays put and says so.
 */
const D = vi.mocked(disagreements);
const ID = "7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

function List() {
  const { state } = useLocation();
  return <div data-testid="list">{JSON.stringify(state)}</div>;
}
function renderBar(done: boolean) {
  return render(
    <MemoryRouter initialEntries={["/card"]}>
      <Routes>
        <Route path="/card" element={<><DoneBadge done={done} /><DoneBar id={ID} done={done} teacher="Bushra Ali" /></>} />
        <Route path="/portal/coach/disagreements" element={<List />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  D.visited.mockResolvedValue(true);
  D.undone.mockResolvedValue(true);
});

describe("DoneBar", () => {
  it("open card: Mark as done with its hint, no badge; a tap saves and goes to the list saying she moved", async () => {
    renderBar(false);
    expect(screen.getByText("Tap when you have coached her. The card moves to Done.")).toBeInTheDocument();
    expect(screen.queryByTestId("done-badge")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "✓ Mark as done" }));
    await waitFor(() => expect(D.visited).toHaveBeenCalledWith(ID));
    expect(await screen.findByTestId("list")).toHaveTextContent(JSON.stringify({ moved: { who: "Bushra Ali", done: true } }));
  });

  it("done card: the ✓ Done badge and Move back to To do, which undoes it", async () => {
    renderBar(true);
    expect(screen.getByTestId("done-badge")).toHaveTextContent("✓ Done");
    expect(screen.queryByText(/Tap when you have coached her/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move back to To do" }));
    await waitFor(() => expect(D.undone).toHaveBeenCalledWith(ID));
    expect(D.visited).not.toHaveBeenCalled();
    expect(await screen.findByTestId("list")).toHaveTextContent(JSON.stringify({ moved: { who: "Bushra Ali", done: false } }));
  });

  it("a save that fails stays on the card and says so", async () => {
    D.visited.mockResolvedValue(false);
    renderBar(false);
    fireEvent.click(screen.getByRole("button", { name: "✓ Mark as done" }));
    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(screen.queryByTestId("list")).toBeNull();
    expect(screen.getByRole("button", { name: "✓ Mark as done" })).toBeEnabled();
  });
});
