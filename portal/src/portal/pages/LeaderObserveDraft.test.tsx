import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// bd-5rz1v.6 — "Check the draft report": the WhatsApp review form in the portal.
// The same parts, the same fields, the same keys submitted (r_/ev_/imp_ per
// indicator, fid_r_/fid_e_ per lesson-plan move), every one of them, as the
// form submits its init values.

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../services/api", () => ({
  leader: { getObservationDraft: vi.fn(), getObservation: vi.fn(), saveObservationDraft: vi.fn() },
}));

import { leader } from "../services/api";
import LeaderObserveDraft, { countChanges, initialValues } from "./LeaderObserveDraft";

const L = leader as any;

const DRAFT = {
  saved: false,
  scale: [{ id: "0", title: "0 · Not observed" }, { id: "1", title: "1 · Developing" }, { id: "2", title: "2 · Proficient" }, { id: "na", title: "— Not applicable to this lesson" }],
  fidelityScale: [{ id: "executed", title: "✓ Executed" }, { id: "partial", title: "◐ Partial — half credit" }, { id: "not_done", title: "✗ Not done" }],
  sections: [
    { key: "lesson_plan_fidelity", letter: "B", title: "Lesson Plan Fidelity", kind: "moves", header: "Measured 75%", fallback: "",
      moves: [{ k: 1, plan: "Fold a paper into halves", verdict: "executed", evidence: "She folded it" }] },
    { key: "high_leverage_practices", letter: "C", title: "High-Leverage Practices", kind: "indicators", notes: [],
      indicators: [{ id: "C1", field: "C1", name: "Quality Questioning", rating: "0", evidence: "Asked facts", improvement: "Ask why" }] },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/leader/observe/cs-1/draft"]}>
      <Routes>
        <Route path="/portal/leader/observe/:id/draft" element={<LeaderObserveDraft />} />
        <Route path="/portal/leader/observe/:id" element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservationDraft.mockResolvedValue(DRAFT);
  L.getObservation.mockResolvedValue({ teacher: { name: "Ayesha Bibi" }, report: {} });
  L.saveObservationDraft.mockResolvedValue({ success: true });
});

describe("initialValues / countChanges", () => {
  it("one key per field the form submits", () => {
    expect(initialValues(DRAFT as any)).toEqual({
      fid_r_1: "executed", fid_e_1: "She folded it", r_C1: "0", ev_C1: "Asked facts", imp_C1: "Ask why",
    });
  });
  it("counts ratings and notes apart", () => {
    const start = initialValues(DRAFT as any);
    expect(countChanges(start, { ...start, r_C1: "1", fid_r_1: "partial", ev_C1: "x" })).toEqual({ ratings: 2, notes: 1 });
  });
});

describe("LeaderObserveDraft", () => {
  it("walks the parts in the form's order and saves every field, with her change", async () => {
    renderPage();
    expect(await screen.findByText("B. Lesson Plan Fidelity")).toBeInTheDocument();
    expect(screen.getByText("Measured 75%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "◐ Partial — half credit" }));
    expect(screen.getByText(/Your Digital Coach said ✓ Executed — you changed it/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(await screen.findByText("C. High-Leverage Practices")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "1 · Developing" }));
    fireEvent.change(screen.getByLabelText(/To improve/), { target: { value: "Ask one why after a right answer" } });

    fireEvent.click(screen.getByRole("button", { name: "Save the draft" }));
    const sheet = await screen.findByRole("dialog", { name: "Save the draft?" });
    expect(within(sheet).getByText(/You changed 2 ratings and 1 note/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByText("observation page")).toBeInTheDocument();
    expect(L.saveObservationDraft).toHaveBeenCalledWith("cs-1", {
      fid_r_1: "partial", fid_e_1: "She folded it", r_C1: "1", ev_C1: "Asked facts", imp_C1: "Ask one why after a right answer",
    });
  });

  it("a draft that cannot change any more says so", async () => {
    L.getObservationDraft.mockRejectedValue({ response: { status: 409 } });
    renderPage();
    expect(await screen.findByText(/cannot be changed any more/i)).toBeInTheDocument();
  });

  it("a failed save stays on the page and says so", async () => {
    L.saveObservationDraft.mockRejectedValue({ response: { status: 502 } });
    renderPage();
    await screen.findByText("B. Lesson Plan Fidelity");
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save the draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(screen.getByText(/did not save/i)).toBeInTheDocument());
  });
});

// bd-5rz1v.6.6 — on a phone the leader bottom navigation (fixed, h-16, z-50)
// covered the Back / Next part bar, so a coach could not leave part 1
// (handset test, RMX2061). The bar sits ABOVE the bottom nav on phones, and at
// the bottom of the screen where there is no bottom nav (md and up).
describe("the Back / Next part bar on a phone", () => {
  it("sits above the bottom navigation, not under it", async () => {
    renderPage();
    await screen.findByText("B. Lesson Plan Fidelity");
    const bar = screen.getByTestId("draft-actions");
    const cls = bar.className.split(/\s+/);
    expect(cls).toContain("bottom-16");
    expect(cls).toContain("md:bottom-0");
    expect(cls).not.toContain("bottom-0");
    expect(within(bar).getByRole("button", { name: "Next part" })).toBeInTheDocument();
  });
});

// bd-15y1pc — the draft is now READABLE once it can no longer be changed (the
// coach v2 page shows the answers); this page, which edits, says so instead.
describe("bd-15y1pc — a draft that can no longer be changed", () => {
  it("shows the not-ready message, not an editable form", async () => {
    L.getObservationDraft.mockResolvedValue({ ...DRAFT, editable: false });
    renderPage();
    expect(await screen.findByText("This draft cannot be changed any more.")).toBeInTheDocument();
    expect(screen.queryByText("Quality Questioning")).toBeNull();
  });
});
