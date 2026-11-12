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
 * bd-ra8xu.40 — a FICO17 v6 visit on the portal's Feedback Form: everything the WhatsApp v6 review Flow does. Rumi's 11
 * are pre-filled (his level ringed, his evidence editable); the six are set from the room, each with a reason of at least
 * 20 letters; D2 takes its two counts; changing one of Rumi's levels needs the part's reason. The tiny rubric label shows.
 */
const L = leader as any;
const WHY = "Called Ali and Sana by name before asking.";
const lv = (titles: string[], extra: { id: string; title: string }[] = []) => [
  ...titles.map((t, i) => ({ id: String(i + 1), title: t, description: `${t} in full` })),
  ...extra.map((o) => ({ ...o, description: "" })),
];
const DC_OPTS = lv(["None", "Closed only", "2+ open", "Why + follow-up"], [{ id: "NA", title: "N/A · Did not come up" }, { id: "IE", title: "Couldn't tell" }]);
const CB_OPTS = lv(["Took whoever answered", "Chose once", "Chose 2+ times", "2+ named answered"]);
const D2_OPTS = lv(["No child spoke", "Only 1-2 children", "3-5 children", "6+, and 2+ quiet ones later"]);
const DRAFT = (extra: Record<string, unknown> = {}) => ({
  kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6" },
  scale: [], fidelityScale: [{ id: "executed", title: "✓ Executed" }],
  sections: [
    { key: "lesson_plan_fidelity", letter: "B", title: "Lesson Plan Fidelity", kind: "moves", header: "", fallback: "No lesson plan was provided.", moves: [] },
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
      indicators: [
        { id: "C1", field: "C1", name: "Questions that make children think", kind: "dc", options: DC_OPTS, rumi: "3", rating: "3", evidence: "Asked two open questions", improvement: "Ask why" },
        { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: CB_OPTS, body: "How the teacher chooses who answers.\n\n05:00  \"Ali, what do you think?\"", rating: "", why: "" },
      ] },
    { key: "v6_children", letter: "D", title: "What the children do", kind: "v6", changeReason: "",
      indicators: [
        { id: "D2", field: "D2", name: "How many children spoke", kind: "combined", options: D2_OPTS, body: "The recording has 4 student turns.", rating: "", why: "", d2: { children: "", quietLater: "" } },
      ] },
    { key: "v6_subject", letter: "F", title: "Subject knowledge", kind: "v6", changeReason: "",
      indicators: [
        { id: "F1", field: "F1", name: "Correct content", kind: "dc", options: DC_OPTS, rumi: null, rating: "IE", evidence: "", improvement: "" },
      ] },
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
const toPartC = async () => { await screen.findByText("No lesson plan was provided."); next(); await screen.findByText("Who got to answer"); };
const level = (indName: string, optTitle: RegExp) => fireEvent.click(within(screen.getByRole("radiogroup", { name: indName })).getByRole("radio", { name: optTitle }));

beforeEach(() => {
  vi.clearAllMocks();
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(DRAFT());
  L.saveObservationDraft.mockResolvedValue({ success: true });
});

describe("Feedback Form — FICO17 v6 (bd-ra8xu.40)", () => {
  it("shows the tiny rubric label and the four parts B, C, D, F", async () => {
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    expect(screen.getByTestId("rubric-label")).toHaveTextContent("FICO17 v6");
    expect(screen.getByRole("img", { name: "Part 1 of 4" })).toBeInTheDocument();
  });

  it("one of Rumi's 11: his level picked and ringed, each level's words, his evidence editable", async () => {
    renderPage();
    await toPartC();
    const c1 = within(screen.getByRole("radiogroup", { name: "Questions that make children think" }));
    expect(c1.getByRole("radio", { name: /^3, 2\+ open/ })).toHaveAttribute("aria-checked", "true");
    expect(c1.getByRole("radio", { name: /^3, 2\+ open/ })).toHaveAccessibleName(/Digital Coach/);
    expect(c1.getByRole("radio", { name: /Couldn't tell/ })).toBeInTheDocument();
    expect(screen.getAllByLabelText("What was seen")[0]).toHaveValue("Asked two open questions");
  });

  it("one of the six: Rumi's evidence above it, blank until set, and Next refuses without a level and a 20-letter reason", async () => {
    renderPage();
    await toPartC();
    expect(screen.getByText(/Ali, what do you think\?/)).toBeInTheDocument();
    const c3 = within(screen.getByRole("radiogroup", { name: "Who got to answer" }));
    expect(c3.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    next();
    expect(await screen.findByText("Choose a level")).toBeInTheDocument();
    expect(screen.getByText("At least 20 letters")).toBeInTheDocument();
    expect(screen.getByText("Who got to answer")).toBeInTheDocument(); // still on part C
    level("Who got to answer", /^3, Chose 2\+ times/);
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: "too short" } });
    next();
    expect(await screen.findByText("At least 20 letters")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: WHY } });
    next();
    expect(await screen.findByText("How many children spoke")).toBeInTheDocument();
  });

  it("changing one of Rumi's levels asks why you changed it, and Next waits for it", async () => {
    renderPage();
    await toPartC();
    level("Who got to answer", /^3, Chose 2\+ times/);
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: WHY } });
    expect(screen.queryByLabelText("Why you changed it")).toBeNull();
    level("Questions that make children think", /^2, Closed only/);
    expect(await screen.findByText("Changed from 3")).toBeInTheDocument();
    next();
    expect(await screen.findByLabelText("Why you changed it")).toBeInTheDocument();
    expect(screen.getByText("At least 20 letters")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Why you changed it"), { target: { value: "Only closed questions were asked." } });
    next();
    expect(await screen.findByText("How many children spoke")).toBeInTheDocument();
  });

  it("D2 takes its two counts; a level off the counts needs a number in the reason", async () => {
    renderPage();
    await toPartC();
    level("Who got to answer", /^3, Chose 2\+ times/);
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: WHY } });
    next();
    await screen.findByText("How many children spoke");
    level("How many children spoke", /^4, 6\+/);
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: "Lots of children spoke in groups today." } });
    fireEvent.change(screen.getByLabelText("Children who spoke"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Quiet, then spoke"), { target: { value: "5" } });
    next();
    expect(await screen.findByText("Check the two numbers")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Quiet, then spoke"), { target: { value: "1" } });
    next();
    expect(await screen.findByText("Counts and level differ")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: "Lots of children spoke, 7 by my count." } });
    next();
    expect(await screen.findByText("Correct content")).toBeInTheDocument();
  });

  it("saves every key the v6 Flow submits; a refusal from the bot is shown", async () => {
    L.saveObservationDraft.mockRejectedValueOnce({ response: { status: 400, data: { reason: "v6_review", errors: { why_C3: "Who got to answer: Write why you chose this level (at least 20 characters)." } } } });
    renderPage();
    await toPartC();
    level("Who got to answer", /^3, Chose 2\+ times/);
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: WHY } });
    next();
    await screen.findByText("How many children spoke");
    level("How many children spoke", /^3, 3-5/);
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: "Four children answered across the lesson." } });
    fireEvent.change(screen.getByLabelText("Children who spoke"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Quiet, then spoke"), { target: { value: "1" } });
    next();
    await screen.findByText("Correct content");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText(/Write why you chose this level/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(2));
    const [, values] = L.saveObservationDraft.mock.calls[1];
    expect(values).toMatchObject({
      r_C1: "3", ev_C1: "Asked two open questions", imp_C1: "Ask why", chg_C: "",
      r_C3: "3", why_C3: WHY,
      r_D2: "3", why_D2: "Four children answered across the lesson.", d2_children: "4", d2_quiet_later: "1", chg_D: "",
      r_F1: "IE", chg_F: "",
    });
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("read only once the teacher has the report: her levels and reasons as words", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT({ editable: false, saved: true }));
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    next();
    expect(await screen.findByText("Who got to answer")).toBeInTheDocument();
    expect(screen.queryAllByRole("radiogroup")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
