import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
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
 * bd-tfya0m (queue #205, the operator via #206's parity audit) — the FICO form (V3 and v6) keeps her answers as she
 * gives them, the way the grades 6-8 form already keeps each part, so a reload or a 502 loses nothing.
 *
 * The 6-8 form saves every answer on the server at each "Next part". The FICO form cannot: its one save completes the
 * review (the talk comes next) and a v6 review is refused part-way. So every change is kept ON THIS PHONE, per
 * observation, as she makes it: a reload (or the app closed, or a Save that came back 502) opens the form on her own
 * answers and on the part she was on; a save the bot accepted lets the phone's copy go; a read-only form (the report
 * is out) never takes it.
 */
const L = leader as any;
const KEY = "niete-fico-form:cs-1";

const V3 = (extra: Record<string, unknown> = {}) => ({
  saved: false, editable: true,
  scale: [{ id: "0", title: "0 · Not observed" }, { id: "1", title: "1 · Developing" }, { id: "2", title: "2 · Proficient" }, { id: "na", title: "— Not applicable to this lesson" }],
  fidelityScale: [{ id: "executed", title: "✓ Executed — full credit" }, { id: "not_done", title: "✗ Not done — no credit" }],
  sections: [
    { key: "lpf", letter: "B", title: "Lesson plan", kind: "moves", header: "How closely the lesson followed the plan", fallback: "",
      moves: [{ k: 1, plan: "Start with a story", verdict: "executed", evidence: "Told one about a market" }] },
    { key: "culture", letter: "C", title: "Classroom culture", kind: "indicators", notes: [],
      indicators: [
        { id: "C1", field: "C1", name: "Positive learning environment", rating: "1", evidence: "Greeted students by name", improvement: "Invite quieter students" },
      ] },
    { key: "engage", letter: "D", title: "Student engagement", kind: "indicators", notes: [],
      indicators: [{ id: "D1", field: "D1", name: "Questioning", rating: "na", evidence: "", improvement: "" }] },
  ],
  ...extra,
});
const lv = (titles: string[]) => titles.map((t, i) => ({ id: String(i + 1), title: t, description: `${t} in full` }));
const V6 = () => ({
  kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6" },
  scale: [], fidelityScale: [{ id: "executed", title: "✓ Executed" }],
  sections: [
    { key: "lesson_plan_fidelity", letter: "B", title: "Lesson Plan Fidelity", kind: "moves", header: "", fallback: "No lesson plan was provided.", moves: [] },
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
      indicators: [
        { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: lv(["Took whoever answered", "Chose once", "Chose 2+ times", "2+ named answered"]), body: "How the teacher chooses who answers.", rating: "", why: "" },
      ] },
  ],
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
/** A reload: the page goes, and comes back from the server's draft (what the bot has) and the phone's copy. */
const reload = async () => { cleanup(); renderPage(); };
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next part" }));
const c1 = () => within(screen.getByRole("radiogroup", { name: "Positive learning environment" }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(V3());
  L.saveObservationDraft.mockResolvedValue({ success: true });
});

describe("the FICO form keeps her answers on the phone as she gives them", () => {
  it("V3: a rating and a note she changed are still hers after a reload, on the part she was on", async () => {
    renderPage();
    await screen.findByText("Start with a story");
    next();
    await screen.findByText("Positive learning environment");
    fireEvent.click(c1().getByRole("radio", { name: "2, Proficient" }));
    fireEvent.change(screen.getAllByLabelText("To improve")[0], { target: { value: "Ask three quiet students" } });
    await waitFor(() => expect(localStorage.getItem(KEY)).toContain("Ask three quiet students"));

    await reload();
    expect(await screen.findByText("Positive learning environment")).toBeInTheDocument();
    expect(c1().getByRole("radio", { name: "2, Proficient" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByLabelText("To improve")[0]).toHaveValue("Ask three quiet students");
    // Still counted as her changes against what the bot has.
    expect(screen.getByText("Changed from 1")).toBeInTheDocument();
  });

  it("a Save that came back 502 loses nothing: after a reload her answers are there to save again", async () => {
    L.saveObservationDraft.mockRejectedValue({ response: { status: 502 } });
    renderPage();
    await screen.findByText("Start with a story");
    next();
    fireEvent.click(within(await screen.findByRole("radiogroup", { name: "Positive learning environment" })).getByRole("radio", { name: "2, Proficient" }));
    next();
    await screen.findByText("Questioning");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Could not save")).toBeInTheDocument();

    L.saveObservationDraft.mockResolvedValue({ success: true });
    await reload();
    await screen.findByText("Questioning");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(2));
    expect(L.saveObservationDraft.mock.calls[1][1]).toMatchObject({ r_C1: "2" });
  });

  it("a save the bot accepted lets the phone's copy go: the next open is the bot's answers", async () => {
    renderPage();
    await screen.findByText("Start with a story");
    next();
    fireEvent.click(within(await screen.findByRole("radiogroup", { name: "Positive learning environment" })).getByRole("radio", { name: "2, Proficient" }));
    await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull());
    next();
    await screen.findByText("Questioning");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("observation page")).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("a read-only form (the report is out) never takes the phone's copy", async () => {
    localStorage.setItem(KEY, JSON.stringify({ values: { r_C1: "0" }, part: 1, at: Date.now() }));
    L.getObservationDraft.mockResolvedValue(V3({ editable: false, saved: true }));
    renderPage();
    await screen.findByText("Start with a story");
    expect(screen.queryByText("Changed from 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("only the form's own keys are taken from the phone (an old or foreign key is dropped)", async () => {
    localStorage.setItem(KEY, JSON.stringify({ values: { r_C1: "2", r_ZZ9: "4", userId: "x" }, part: 1, at: Date.now() }));
    renderPage();
    expect(await screen.findByText("Positive learning environment")).toBeInTheDocument();
    next(); await screen.findByText("Questioning");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(1));
    const sent = L.saveObservationDraft.mock.calls[0][1];
    expect(sent.r_C1).toBe("2");
    expect(sent).not.toHaveProperty("r_ZZ9");
    expect(sent).not.toHaveProperty("userId");
  });

  it("v6: a level and its reason for one of the six are kept through a reload", async () => {
    L.getObservationDraft.mockResolvedValue(V6());
    const WHY = "Called Ali and Sana by name before asking.";
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    next();
    await screen.findByText("Who got to answer");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Who got to answer" })).getByRole("radio", { name: /Chose 2\+ times/ }));
    const why = screen.getAllByRole("textbox").find((t) => (t as HTMLTextAreaElement).value === "") as HTMLTextAreaElement;
    fireEvent.change(why, { target: { value: WHY } });
    await waitFor(() => expect(localStorage.getItem(KEY)).toContain("Called Ali"));

    await reload();
    expect(await screen.findByText("Who got to answer")).toBeInTheDocument();
    expect(within(screen.getByRole("radiogroup", { name: "Who got to answer" })).getByRole("radio", { name: /Chose 2\+ times/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByDisplayValue(WHY)).toBeInTheDocument();
  });
});
