import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn(), saveObservationDraft: vi.fn() },
}));
import { leader } from "../../services/api";
import FeedbackForm from "./FeedbackForm";

/**
 * bd-4404s7.5 — Feedback Form (Blueprint Coach_FeedbackForm), step 2 of 5: the WhatsApp review form, in the portal,
 * on the kit. A StepBar over the parts, the legend, one card per indicator (the kit's RatingScale on the scale the bot
 * returns, what was seen, to improve), a lesson-plan part with each move's verdict. Saves through the same keys the
 * form submits (r_ ev_ imp_ fid_r_ fid_e_), every field, changed or not.
 */
const L = leader as any;
const DRAFT = (extra: Record<string, unknown> = {}) => ({
  saved: false, editable: true,
  scale: [{ id: "0", title: "0 · Not observed" }, { id: "1", title: "1 · Developing" }, { id: "2", title: "2 · Proficient" }, { id: "na", title: "— Not applicable to this lesson" }],
  fidelityScale: [{ id: "executed", title: "✓ Executed — full credit" }, { id: "not_done", title: "✗ Not done — no credit" }],
  sections: [
    { key: "lpf", letter: "B", title: "Lesson plan", kind: "moves", header: "How closely the lesson followed the plan", fallback: "",
      moves: [{ k: 1, plan: "Start with a story", verdict: "executed", evidence: "Told one about a market" }] },
    { key: "culture", letter: "C", title: "Classroom culture", kind: "indicators", notes: [],
      indicators: [
        { id: "C1", field: "C1", name: "Positive learning environment", rating: "1", evidence: "Greeted students by name", improvement: "Invite quieter students" },
        { id: "C2", field: "C2", name: "Clear routines", rating: "2", evidence: "Hands-up rule used", improvement: "Use a countdown" },
      ] },
    { key: "engage", letter: "D", title: "Student engagement", kind: "indicators", notes: [],
      indicators: [{ id: "D1", field: "D1", name: "Questioning", rating: "na", evidence: "", improvement: "" }] },
  ],
  ...extra,
});
const VIEW = { id: "cs-1", teacher: { name: "Ayesha Bibi", phone: "923001110001" }, report: { teacherName: "Ayesha Bibi" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };

const renderPage = () => render(
  <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
    <Routes>
      <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
      <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
    </Routes>
  </MemoryRouter>,
);
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next part" }));

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(DRAFT());
  L.saveObservationDraft.mockResolvedValue({ success: true });
});

describe("Feedback Form", () => {
  it("titled Feedback Form, crumb with Step 2 of 5, a StepBar over the parts and the legend", async () => {
    renderPage();
    await screen.findByText("Start with a story");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Feedback Form");
    await waitFor(() => expect(screen.getByTestId("page-crumb")).toHaveTextContent("Ayesha Bibi · Step 2 of 5"));
    expect(screen.getByRole("img", { name: "Part 1 of 3" })).toBeInTheDocument();
    expect(screen.getByText("Your rating")).toBeInTheDocument();
    expect(screen.getByText("Digital Coach")).toBeInTheDocument();
  });

  it("part 1 is the lesson plan: each move with its verdict and what was seen", async () => {
    renderPage();
    expect(await screen.findByText("Start with a story")).toBeInTheDocument();
    expect(screen.getByText("Move 1 of 1")).toBeInTheDocument();
    expect(screen.getByLabelText("What was seen")).toHaveValue("Told one about a market");
    expect(screen.getByText("How closely the lesson followed the plan")).toBeInTheDocument();
  });

  it("an indicator card: the code, its name, the live scale 0 1 2 N/A with her rating picked and the Digital Coach's ringed", async () => {
    renderPage();
    await screen.findByText("Start with a story");
    next();
    expect(await screen.findByText("Positive learning environment")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Part 2 of 3" })).toBeInTheDocument();
    const c1 = within(screen.getByRole("radiogroup", { name: "Positive learning environment" }));
    expect(c1.getAllByRole("radio").map((r) => r.textContent)).toEqual(["0", "1", "2", "N/A"]);
    expect(c1.getByRole("radio", { name: "1, Developing, Digital Coach" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByLabelText("What was seen")[0]).toHaveValue("Greeted students by name");
    expect(screen.getAllByLabelText("To improve")[0]).toHaveValue("Invite quieter students");
  });

  it("changing a rating says what it was, and counts as one change", async () => {
    renderPage();
    await screen.findByText("Start with a story");
    next();
    const c1 = within(await screen.findByRole("radiogroup", { name: "Positive learning environment" }));
    fireEvent.click(c1.getByRole("radio", { name: "2, Proficient" }));
    expect(await screen.findByText("Changed from 1")).toBeInTheDocument();
  });

  it("the last part saves with every key, after a summary of what changed", async () => {
    renderPage();
    await screen.findByText("Start with a story");
    next();
    fireEvent.click(within(await screen.findByRole("radiogroup", { name: "Positive learning environment" })).getByRole("radio", { name: "2, Proficient" }));
    fireEvent.change(screen.getAllByLabelText("To improve")[0], { target: { value: "Ask three quiet students" } });
    next();
    expect(await screen.findByText("Questioning")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next part" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("1 ratings, 1 notes changed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(1));
    const [id, values] = L.saveObservationDraft.mock.calls[0];
    expect(id).toBe("cs-1");
    expect(values).toMatchObject({
      r_C1: "2", ev_C1: "Greeted students by name", imp_C1: "Ask three quiet students",
      r_C2: "2", r_D1: "na", fid_r_1: "executed", fid_e_1: "Told one about a market",
    });
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("Back on the first part goes to the observation page", async () => {
    renderPage();
    await screen.findByText("Start with a story");
    fireEvent.click(screen.getAllByRole("button", { name: "Back" }).at(-1)!); // the header arrow and the dock both say Back
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("a save the server refuses says so and stays", async () => {
    L.saveObservationDraft.mockRejectedValue({ response: { status: 409 } });
    renderPage();
    await screen.findByText("Start with a story");
    next(); next();
    await screen.findByText("Questioning");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Cannot change it now")).toBeInTheDocument();
  });

  it("after the report is out the answers are read only: her ratings as words, no fields, no Save", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT({ editable: false, saved: true }));
    renderPage();
    await screen.findByText("Start with a story");
    next();
    expect(await screen.findByText("Positive learning environment")).toBeInTheDocument();
    expect(screen.getByText("1 · Developing")).toBeInTheDocument();
    expect(screen.getByText("Greeted students by name")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    next();
    await screen.findByText("Questioning");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("a failed read says so with Try again", async () => {
    L.getObservationDraft.mockRejectedValueOnce(new Error("down"));
    renderPage();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
