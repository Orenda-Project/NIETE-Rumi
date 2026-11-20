import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import i18n from "i18next";
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
 * bd-ra8xu.60 (queue #127) — a FICO17 v6 visit's Feedback Form shows the coach's Observation Notes (GET …/draft `notes`)
 * read only at the top of each v6 part (C, D, F), under "📝 Your Observation Notes": one per line, the recording clock
 * first when there is one, word for word. None: nothing. Pre-fill and the parts' rules are unchanged.
 */
const L = leader as any;
const opts = (titles: string[]) => titles.map((t, i) => ({ id: String(i + 1), title: t, description: "" }));
const NOTES = [
  { text: "Board work: fractions drawn as pizzas", recTime: "12:40" },
  { text: "Group 3 stayed quiet — the girls at the back", recTime: null },
];
const DRAFT = (extra: Record<string, unknown> = {}) => ({
  kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6" },
  scale: [], fidelityScale: [{ id: "executed", title: "✓ Executed" }],
  sections: [
    { key: "lesson_plan_fidelity", letter: "B", title: "Lesson Plan Fidelity", kind: "moves", header: "", fallback: "No lesson plan was provided.", moves: [] },
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
      indicators: [{ id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: opts(["A", "B", "C", "D"]), body: "How the teacher chooses.", rating: "", why: "" }] },
    { key: "v6_children", letter: "D", title: "What the children do", kind: "v6", changeReason: "",
      indicators: [{ id: "D1", field: "D1", name: "Children talk to each other", kind: "combined", options: opts(["A", "B", "C", "D"]), body: "Pair talk.", rating: "2", why: "Two pairs talked about the sum." }] },
    { key: "v6_subject", letter: "F", title: "Subject knowledge", kind: "v6", changeReason: "",
      indicators: [{ id: "F1", field: "F1", name: "Correct content", kind: "dc", options: opts(["A", "B", "C", "D"]), rumi: "3", rating: "3", evidence: "Right sums", improvement: "" }] },
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
const notesBox = () => screen.getByRole("region", { name: "📝 Your Observation Notes" });
const lines = () => within(notesBox()).getAllByTestId("observation-note");

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(DRAFT({ notes: NOTES }));
  L.saveObservationDraft.mockResolvedValue({ success: true });
});
afterEach(async () => {
  cleanup();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("Feedback Form — Observation Notes on a FICO17 v6 visit (bd-ra8xu.60)", () => {
  it("not on the lesson plan part; at the top of part C, word for word, the clock first", async () => {
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    expect(screen.queryByText("📝 Your Observation Notes")).toBeNull();
    next();
    await screen.findByText("Who got to answer");
    const box = notesBox();
    expect(lines()).toHaveLength(2);
    expect(within(lines()[0]).getByTestId("note-clock")).toHaveTextContent("12:40");
    expect(lines()[0]).toHaveTextContent("Board work: fractions drawn as pizzas");
    expect(within(lines()[1]).queryByTestId("note-clock")).toBeNull();
    expect(lines()[1]).toHaveTextContent("Group 3 stayed quiet — the girls at the back");
    // at the top: above the part's first indicator, and nothing in it to edit
    const first = screen.getAllByTestId("indicator")[0];
    expect(box.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(box).queryByRole("textbox")).toBeNull();
  });

  it("on parts D and F too, and the parts' rules are unchanged", async () => {
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    next();
    await screen.findByText("Who got to answer");
    next(); // part C refuses: no level, no reason — the notes change nothing
    expect(await screen.findByText("Choose a level")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Who got to answer" })).getByRole("radio", { name: /^3, C/ }));
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: "Called Ali and Sana by name before asking." } });
    next();
    await screen.findByText("Children talk to each other");
    expect(screen.getByLabelText("Why this level")).toHaveValue("Two pairs talked about the sum."); // pre-fill as before
    expect(lines()).toHaveLength(2);
    next();
    await screen.findByText("Correct content");
    expect(lines()).toHaveLength(2);
  });

  it("read only once the teacher has the report: the notes still show", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT({ notes: NOTES, editable: false, saved: true }));
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    next();
    await screen.findByText("Who got to answer");
    expect(lines()).toHaveLength(2);
  });

  it("no notes (none typed, or an older bot): nothing at all", async () => {
    for (const extra of [{ notes: [] }, {}]) {
      L.getObservationDraft.mockResolvedValue(DRAFT(extra));
      renderPage();
      await screen.findByText("No lesson plan was provided.");
      next();
      await screen.findByText("Who got to answer");
      expect(screen.queryByText("📝 Your Observation Notes")).toBeNull();
      expect(screen.queryAllByTestId("observation-note")).toEqual([]);
      cleanup();
    }
  });

  it("Urdu: the heading in Urdu, the clock in Urdu digits kept left-to-right, her words as she typed them", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "اگلا حصہ")!);
    const box = await screen.findByRole("region", { name: "📝 آپ کے مشاہدے کے نوٹس" });
    const clock = within(box).getByTestId("note-clock");
    expect(clock.textContent).toBe("⁦۱۲:۴۰⁩");
    expect(clock).toHaveAttribute("dir", "ltr");
    expect(box).toHaveTextContent("Board work: fractions drawn as pizzas");
  });
});
