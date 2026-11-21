import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanCopy, scanStyle } from "../../newui/checks/source";

/**
 * bd-o15qnr.31 (queue #204; #188's canvas-ff, LOCKED 21 Nov ~10:05) — the FICO17 v6 Feedback Form, behind the v6/v7
 * switch, coach and principal, English and Urdu:
 *
 *   sections        every section collapsed: B, C, D, F, each green when complete, yellow when not, "n/m done";
 *                   Save looks disabled until every section is green (tapped early: a counted toast, the first yellow
 *                   section focused)
 *   a section       section chips with counts; "n of m checked"; one row per indicator (code, name, level chip, the
 *                   NIETE Teaching Assistant's one line, a green/yellow mark, ›); "Next to check" walks the yellow rows
 *   one indicator   prev/next, the level, the evidence, To improve, "Agree and next" (gaps: a counted toast, the first
 *                   unfilled item scrolled to and focused, the inline marks kept)
 *   evidence (B)    the summary (edited in place) and every quote as a row: time chip (plays the lesson from there when
 *                   the recording is on the page), the quote (Urdu right to left, Nastaliq), ⋯ → Edit / Remove (Undo
 *                   for 5 s, an "edited" tag); "Add evidence" adds the coach's own line with a dark "You" tag
 *   saved           ev_<code> as today's server reads it, plus `evidence_review` per indicator
 *   every box       sized to its text (auto-grow), each paragraph its own direction
 *   the name        "NIETE Teaching Assistant", never "Rumi"
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn(), getObservation: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn(), saveObservationDraft: vi.fn(), saveObs612Form: vi.fn() },
}));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { coach, leader } from "../../services/api";
import FeedbackForm from "./FeedbackForm";
import { COACH_OBSERVE_ROUTES, ObserveRoutesProvider } from "../observe/observeRoutes";

const L = leader as any;
const CO = coach as any;

/* ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const LEVELS4 = ["Not Observed", "Developing", "Proficient", "Highly Effective"];
const lv = (extra: { id: string; title: string }[] = []) => [
  ...LEVELS4.map((t, i) => ({ id: String(i + 1), title: t, description: `${t}: the rubric's words` })),
  ...extra.map((o) => ({ ...o, description: "" })),
];
const BECAUSE = "Teacher mainly asks closed recall questions; one clear open prompt.";
const Q1 = "اب ہم کیا کریں گے؟ آپ کے گھر کے آگے پیچھے بھی جانور ہیں";
const Q2 = "بتائیں، بلی کی کتنی ٹانگیں ہوتی ہیں؟";
const Q3 = "کون بتائے گا کہ گائے ہمیں کیا دیتی ہے؟";
const SERVER_EV = `${BECAUSE} · 04:30 "${Q1}"`; // today's prefill: the line and the first quote
const WHY = "Half the class never answered in the lesson.";
const C1 = (extra: Record<string, unknown> = {}) => ({
  id: "C1", field: "C1", name: "Quality of Questions Asked by the Teacher", kind: "dc", options: lv(), rumi: "3", rating: "3",
  evidence: SERVER_EV, improvement: "Ask one “why” question after each answer.",
  rumiEvidence: { because: BECAUSE, items: [{ time: "04:30", quote: Q1 }, { time: "12:15", quote: Q2 }, { time: "18:40", quote: Q3 }] },
  ...extra,
});
const V6 = (extra: Record<string, unknown> = {}, c1: Record<string, unknown> = {}) => ({
  kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6" },
  scale: [], fidelityScale: [{ id: "executed", title: "✓ Executed" }],
  sections: [
    { key: "lesson_plan_fidelity", letter: "B", title: "Lesson plan", kind: "moves", header: "", fallback: "No lesson plan was provided.", moves: [] },
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
      indicators: [
        C1(c1),
        // an older bot: no rumiEvidence → today's one Evidence box
        { id: "C2", field: "C2", name: "Helping when a child is wrong", kind: "dc", options: lv([{ id: "NA", title: "N/A · No child was wrong" }]), rumi: "2", rating: "2", evidence: "Corrected answers herself.", improvement: "" },
        { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: lv([{ id: "NA", title: "N/A · No question asked" }, { id: "IE", title: "Couldn't tell" }]),
          body: "Who answered.\n\n12 children answered, mostly from the front rows.\n\nCoach adds: who spoke", rating: "", why: "" },
      ] },
    { key: "v6_children", letter: "D", title: "What the children do", kind: "v6", changeReason: "",
      indicators: [
        { id: "D2", field: "D2", name: "How many children spoke", kind: "combined", options: lv(), body: "The recording has 4 student turns.", rating: "", why: "", d2: { children: "", quietLater: "" } },
      ] },
    { key: "v6_subject", letter: "F", title: "Subject knowledge", kind: "v6", changeReason: "",
      indicators: [
        { id: "F1", field: "F1", name: "Accuracy of content", kind: "dc", options: lv(), rumi: "3", rating: "3", evidence: "Correct facts throughout.", improvement: "",
          rumiEvidence: { because: "Correct facts throughout.", items: [] } },
      ] },
  ],
  ...extra,
});
const VIEW = { id: "cs-1", teacher: { name: "Lubna Arif", phone: "923001110001" }, report: { teacherName: "Lubna Arif" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };
const PRINCIPAL = { ...COACH_OBSERVE_ROUTES, coachGate: false, showScores: false };

const renderPage = (principal = false) => render(
  <ObserveRoutesProvider value={principal ? PRINCIPAL : COACH_OBSERVE_ROUTES}>
    <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
      <Routes>
        <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
        <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
      </Routes>
    </MemoryRouter>
  </ObserveRoutesProvider>,
);

const dock = () => within(screen.getByTestId("form-dock"));
const sectionRow = (title: RegExp) => within(screen.getByTestId("ff-sections")).getByRole("button", { name: title });
const openSection = async (title: RegExp) => { fireEvent.click(await screen.findByRole("button", { name: title })); await screen.findByTestId("ff-section"); };
const openRow = (code: string) => fireEvent.click(within(screen.getByTestId("ff-section")).getByRole("button", { name: new RegExp(`^${code}\\b`) }));
const toC1 = async () => { renderPage(); await openSection(/C\. What the teacher does/); openRow("C1"); return screen.findByTestId("ff-indicator"); };
const quoteRows = () => within(screen.getByTestId("ff-evidence")).queryAllByTestId("ff-quote");
const group = (name: string) => within(screen.getByRole("radiogroup", { name }));
const unisolated = (t: string) => t.replace(/[⁦-⁩]/g, "");

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(V6());
  L.saveObservationDraft.mockResolvedValue({ success: true });
  CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: null });
});
afterEach(() => { vi.useRealTimers(); });

/* ── every section collapsed (ff-outer) ────────────────────────────────────────────────────────────────────────── */

describe("the outer view: every section collapsed, green when complete, yellow when not", () => {
  it("B, C, D and F with n/m done and their marks; Save says how many sections are left and looks disabled", async () => {
    renderPage();
    const list = await screen.findByTestId("ff-sections");
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("B. Lesson plan"), expect.stringContaining("C. What the teacher does"),
      expect.stringContaining("D. What the children do"), expect.stringContaining("F. Subject knowledge"),
    ]);
    expect(sectionRow(/B\. Lesson plan/)).toHaveTextContent("0/0 done");
    expect(sectionRow(/B\. Lesson plan/).querySelector("[data-mark]")).toHaveAttribute("data-mark", "done");
    expect(sectionRow(/C\. What the teacher does/)).toHaveTextContent("0/3 done");
    expect(sectionRow(/C\. What the teacher does/).querySelector("[data-mark]")).toHaveAttribute("data-mark", "todo");
    expect(sectionRow(/C\. What the teacher does/)).toHaveAccessibleName(expect.stringContaining("To check"));
    const save = dock().getByRole("button", { name: "Save (3 sections to finish)" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Lubna Arif · Now: Fill the form")).toBeInTheDocument();
  });

  it("Save tapped with gaps: a counted toast, the first yellow section focused; nothing is saved", async () => {
    renderPage();
    await screen.findByTestId("ff-sections");
    fireEvent.click(dock().getByRole("button", { name: "Save (3 sections to finish)" }));
    expect(await screen.findByTestId("ff-toast")).toHaveTextContent("5 items still to check");
    expect(sectionRow(/C\. What the teacher does/)).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(L.saveObservationDraft).not.toHaveBeenCalled();
  });
});

/* ── inside a section (ff-list) ────────────────────────────────────────────────────────────────────────────────── */

describe("a section: one row per indicator", () => {
  it("chips with counts, n of m checked, a row per indicator with code, name, level, the assistant's line and a mark", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    const chips = within(screen.getByTestId("ff-chips")).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["B0/0", "C0/3", "D0/1", "F0/1"]);
    expect(chips[1]).toHaveAttribute("aria-current", "true");
    expect(chips[0]).toHaveAttribute("data-mark", "done");
    expect(chips[1]).toHaveAttribute("data-mark", "todo");
    const sec = within(screen.getByTestId("ff-section"));
    expect(sec.getByRole("heading", { name: "C. What the teacher does" })).toBeInTheDocument();
    expect(sec.getByText("0 of 3 checked")).toBeInTheDocument();
    const rows = sec.getAllByTestId("ff-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("C1");
    expect(rows[0]).toHaveTextContent("Quality of Questions Asked by the Teacher");
    expect(rows[0]).toHaveTextContent("Proficient");
    expect(rows[0]).toHaveTextContent(BECAUSE);
    expect(rows[0].querySelector("[data-mark]")).toHaveAttribute("data-mark", "todo");
    expect(rows[2]).toHaveTextContent("Yours to set");
    expect(rows[2]).toHaveTextContent("12 children answered, mostly from the front rows.");
    expect(dock().getByRole("button", { name: "Next to check: C1 Quality of Questions Asked by the Teacher" })).toBeInTheDocument();
  });

  it("a chip opens its section; Back goes up a level", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    fireEvent.click(within(screen.getByTestId("ff-chips")).getByRole("button", { name: /^F/ }));
    expect(await screen.findByRole("heading", { name: "F. Subject knowledge" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /back/i })[0]);
    expect(await screen.findByTestId("ff-sections")).toBeInTheDocument();
  });

  it("Next to check walks the yellow rows, with the count as a toast", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    fireEvent.click(dock().getByRole("button", { name: /^Next to check: C1/ }));
    expect(await screen.findByTestId("ff-indicator")).toHaveTextContent("Quality of Questions Asked by the Teacher");
    expect(screen.getByTestId("ff-toast")).toHaveTextContent("5 items still to check");
  });
});

/* ── one indicator (ff-detail, ff-b-*) ─────────────────────────────────────────────────────────────────────────── */

describe("one indicator alone", () => {
  it("the crumb, prev/next, the level (the NIETE Teaching Assistant's ringed), the evidence rows and To improve", async () => {
    const ind = within(await toC1());
    expect(screen.getByText("Lubna Arif · C · 1 of 3")).toBeInTheDocument();
    expect(ind.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(ind.getByRole("button", { name: "Next" })).toBeEnabled();
    const rumi = group("Quality of Questions Asked by the Teacher").getByRole("radio", { name: "Proficient, NIETE Teaching Assistant’s level" });
    expect(rumi).toHaveAttribute("aria-checked", "true");
    expect(within(rumi).getByText("NIETE Teaching Assistant")).toBeInTheDocument();
    const ev = within(screen.getByTestId("ff-evidence"));
    expect(ev.getByText("NIETE Teaching Assistant heard")).toBeInTheDocument();
    expect(ev.getByTestId("ff-summary")).toHaveTextContent(BECAUSE);
    const rows = quoteRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("04:30");
    const q = within(rows[0]).getByText(`“${Q1}”`);
    expect(q).toHaveAttribute("dir", "auto");
    expect(q).toHaveAttribute("data-urdu");
    expect(ind.getByLabelText("To improve")).toHaveValue("Ask one “why” question after each answer.");
    expect(dock().getByRole("button", { name: "Agree and next" })).toBeInTheDocument();
    fireEvent.click(ind.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Lubna Arif · C · 2 of 3")).toBeInTheDocument();
  });

  it("Agree and next marks it checked (green) and goes to the next yellow row", async () => {
    await toC1();
    fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
    expect(await screen.findByText("Lubna Arif · C · 2 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /back/i })[0]);
    const sec = within(await screen.findByTestId("ff-section"));
    expect(sec.getByText("1 of 3 checked")).toBeInTheDocument();
    expect(sec.getAllByTestId("ff-row")[0].querySelector("[data-mark]")).toHaveAttribute("data-mark", "done");
    expect(within(screen.getByTestId("ff-chips")).getByRole("button", { name: /^C/ })).toHaveTextContent("C1/3");
  });

  it("an older bot (no assistant list): today's one Evidence box, sized to its text", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    openRow("C2");
    const ind = within(await screen.findByTestId("ff-indicator"));
    expect(screen.queryByTestId("ff-evidence")).toBeNull();
    const box = ind.getByLabelText("Evidence");
    expect(box).toHaveValue("Corrected answers herself.");
    expect(box).toHaveAttribute("data-autosize");
  });

  it("gaps on Agree and next: a counted toast, the first unfilled item focused, the inline marks kept", async () => {
    renderPage();
    await openSection(/C\. What the teacher does/);
    openRow("C3");
    await screen.findByTestId("ff-indicator");
    fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
    expect(await screen.findByTestId("ff-toast")).toHaveTextContent("2 items still need an answer");
    expect(screen.getByText("Choose a level")).toBeInTheDocument();
    expect(screen.getByText("At least 20 letters")).toBeInTheDocument();
    const radios = group("Who got to answer").getAllByRole("radio");
    expect(radios).toContain(document.activeElement);
    expect(screen.getByText("Lubna Arif · C · 3 of 3")).toBeInTheDocument(); // it stays
    fireEvent.click(group("Who got to answer").getByRole("radio", { name: "Developing" }));
    fireEvent.change(screen.getByLabelText("Why this level (20 letters at least)"), { target: { value: "short" } });
    fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
    await waitFor(() => expect(screen.getByTestId("ff-toast")).toHaveTextContent("1 item still needs an answer"));
    expect(screen.getByLabelText("Why this level (20 letters at least)")).toHaveFocus();
  });

  it("a level that needs one: '1 item still needs a level'", async () => {
    L.getObservationDraft.mockResolvedValue(V6({}, { rumi: null, rating: "" }));
    await toC1();
    fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
    expect(await screen.findByTestId("ff-toast")).toHaveTextContent("1 item still needs a level");
  });

  it("a changed level asks why on the indicator (the section's reason)", async () => {
    await toC1();
    fireEvent.click(group("Quality of Questions Asked by the Teacher").getByRole("radio", { name: "Developing" }));
    expect(await screen.findByText("Changed from Proficient")).toBeInTheDocument();
    const why = screen.getByLabelText("Why you changed it");
    fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
    await waitFor(() => expect(why).toHaveFocus());
    fireEvent.change(why, { target: { value: "The questions were all closed ones." } });
    fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
    expect(await screen.findByText("Lubna Arif · C · 2 of 3")).toBeInTheDocument();
  });
});

/* ── evidence option B with editing ────────────────────────────────────────────────────────────────────────────── */

describe("evidence: remove (Undo), edit, add, the summary in place", () => {
  it("⋯ → Remove hides the row and says Quote removed · Undo for 5 seconds; Undo brings it back", async () => {
    await toC1();
    vi.useFakeTimers();
    fireEvent.click(within(quoteRows()[1]).getByRole("button", { name: "More: edit or remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(quoteRows()).toHaveLength(2);
    const toast = screen.getByTestId("ff-toast");
    expect(toast).toHaveTextContent("Quote removed");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(quoteRows()).toHaveLength(3);
    fireEvent.click(within(quoteRows()[1]).getByRole("button", { name: "More: edit or remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    act(() => { vi.advanceTimersByTime(4900); });
    expect(screen.getByTestId("ff-toast")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByTestId("ff-toast")).toBeNull();
    expect(quoteRows()).toHaveLength(2);
  });

  it("⋯ → Edit opens the quote in place; the time stays and the row says edited", async () => {
    await toC1();
    fireEvent.click(within(quoteRows()[2]).getByRole("button", { name: "More: edit or remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = within(quoteRows()[2]).getByRole("textbox");
    expect(box).toHaveValue(Q3);
    expect(box).toHaveAttribute("data-autosize");
    fireEvent.change(box, { target: { value: `${Q3} دودھ۔` } });
    fireEvent.click(within(quoteRows()[2]).getByRole("button", { name: "Done" }));
    expect(quoteRows()[2]).toHaveTextContent("18:40");
    expect(quoteRows()[2]).toHaveTextContent(`${Q3} دودھ۔`);
    expect(within(quoteRows()[2]).getByText("edited")).toBeInTheDocument();
  });

  it("Add evidence: what you saw (sized to its text) and an optional mm:ss time; shown with a dark You tag", async () => {
    await toC1();
    fireEvent.click(screen.getByRole("button", { name: "Add evidence" }));
    const saw = screen.getByLabelText("What you saw");
    expect(saw).toHaveAttribute("data-autosize");
    fireEvent.change(saw, { target: { value: "The teacher praised two answers by name." } });
    fireEvent.change(screen.getByLabelText("Time (optional)"), { target: { value: "2105" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Time as mm:ss")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Time (optional)"), { target: { value: "21:05" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const mine = quoteRows()[3];
    expect(mine).toHaveAttribute("data-source", "coach");
    expect(within(mine).getByText("You")).toBeInTheDocument();
    expect(mine).toHaveTextContent("21:05");
    expect(mine).toHaveTextContent("The teacher praised two answers by name.");
  });

  it("the summary edits in place: the pencil opens a box sized to its text, Done closes it", async () => {
    await toC1();
    fireEvent.click(screen.getByRole("button", { name: "Edit the summary" }));
    const box = within(screen.getByTestId("ff-evidence")).getByDisplayValue(BECAUSE);
    expect(box).toHaveAttribute("data-autosize");
    fireEvent.change(box, { target: { value: "Teacher mainly asks closed recall questions; one open prompt about animals near home." } });
    fireEvent.click(within(screen.getByTestId("ff-evidence")).getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("ff-summary")).toHaveTextContent("one open prompt about animals near home.");
  });
});

/* ── what is saved ─────────────────────────────────────────────────────────────────────────────────────────────── */

const fillAll = async () => {
  // C: agree C1 and C2, set C3; D: set D2; F: agree F1
  await openSection(/C\. What the teacher does/);
  openRow("C1");
  await screen.findByTestId("ff-indicator");
};
const finishRest = async () => {
  fireEvent.click(dock().getByRole("button", { name: "Agree and next" })); // C1 → C2
  await screen.findByText("Lubna Arif · C · 2 of 3");
  fireEvent.click(dock().getByRole("button", { name: "Agree and next" })); // C2 → C3
  await screen.findByText("Lubna Arif · C · 3 of 3");
  fireEvent.click(group("Who got to answer").getByRole("radio", { name: "Developing" }));
  fireEvent.change(screen.getByLabelText("Why this level (20 letters at least)"), { target: { value: WHY } });
  fireEvent.click(dock().getByRole("button", { name: "Agree and next" })); // C done → back to the section
  await screen.findByTestId("ff-section");
  fireEvent.click(dock().getByRole("button", { name: /^Next to check: D2/ }));
  await screen.findByText("Lubna Arif · D · 1 of 1");
  fireEvent.click(group("How many children spoke").getByRole("radio", { name: "Proficient" }));
  fireEvent.change(screen.getByLabelText("Why this level (20 letters at least)"), { target: { value: "Four children answered across the lesson." } });
  fireEvent.change(screen.getByLabelText("Children who spoke"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Quiet, then spoke"), { target: { value: "1" } });
  fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
  await screen.findByTestId("ff-section");
  fireEvent.click(dock().getByRole("button", { name: /^Next to check: F1/ }));
  await screen.findByText("Lubna Arif · F · 1 of 1");
  fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
  await screen.findByTestId("ff-section");
  fireEvent.click(dock().getByRole("button", { name: "Done" }));
  await screen.findByTestId("ff-sections");
};

describe("what is saved: ev_<code> as today, and evidence_review beside it", () => {
  it("an edited review: ev_ is the summary · kept and edited quotes with their times · the coach's lines", async () => {
    renderPage();
    await fillAll();
    fireEvent.click(within(quoteRows()[1]).getByRole("button", { name: "More: edit or remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(within(quoteRows()[1]).getByRole("button", { name: "More: edit or remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(within(quoteRows()[1]).getByRole("textbox"), { target: { value: `${Q3} دودھ۔` } });
    fireEvent.click(within(quoteRows()[1]).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Add evidence" }));
    fireEvent.change(screen.getByLabelText("What you saw"), { target: { value: "The teacher praised two answers by name." } });
    fireEvent.change(screen.getByLabelText("Time (optional)"), { target: { value: "21:05" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await finishRest();
    const save = dock().getByRole("button", { name: "Save" });
    expect(save).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(1));
    const [id, edits, review] = L.saveObservationDraft.mock.calls[0];
    expect(id).toBe("cs-1");
    expect(edits.ev_C1).toBe(`${BECAUSE} · 04:30 "${Q1}" · 18:40 "${Q3} دودھ۔" · 21:05 The teacher praised two answers by name.`);
    expect(edits.ev_C2).toBe("Corrected answers herself.");
    expect(review.C1).toEqual({
      summary: { rumi: BECAUSE, coach: BECAUSE },
      items: [
        { source: "rumi", time: "04:30", quote: Q1, status: "kept" },
        { source: "rumi", time: "12:15", quote: Q2, status: "removed" },
        { source: "rumi", time: "18:40", quote: Q3, status: "edited", coach_text: `${Q3} دودھ۔` },
        { source: "coach", time: "21:05", text: "The teacher praised two answers by name." },
      ],
    });
    expect(review.C2).toBeUndefined(); // no assistant list: no review
    expect(review.F1).toEqual({ summary: { rumi: "Correct facts throughout.", coach: "Correct facts throughout." }, items: [] });
    expect(edits).toMatchObject({ r_C1: "3", r_C3: "2", why_C3: WHY, r_D2: "3", d2_children: "4", d2_quiet_later: "1" });
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("an untouched review keeps the server's own ev_ text; its review says every quote was kept", async () => {
    renderPage();
    await fillAll();
    await finishRest();
    fireEvent.click(dock().getByRole("button", { name: "Save" }));
    const tray = within(await screen.findByRole("dialog"));
    expect(tray.getByText("5 ratings · No changes")).toBeInTheDocument();
    fireEvent.click(tray.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(1));
    const [, edits, review] = L.saveObservationDraft.mock.calls[0];
    expect(edits.ev_C1).toBe(SERVER_EV);
    expect(review.C1.items.map((i: any) => i.status)).toEqual(["kept", "kept", "kept"]);
  });

  it("a review saved before comes back as it was saved", async () => {
    L.getObservationDraft.mockResolvedValue(V6({ saved: true }, {
      evidenceReview: {
        summary: { rumi: BECAUSE, coach: "My own line." },
        items: [
          { source: "rumi", time: "04:30", quote: Q1, status: "removed" },
          { source: "rumi", time: "12:15", quote: Q2, status: "kept" },
          { source: "rumi", time: "18:40", quote: Q3, status: "edited", coach_text: "edited words" },
          { source: "coach", time: null, text: "Mine." },
        ],
      },
    }));
    await toC1();
    expect(screen.getByTestId("ff-summary")).toHaveTextContent("My own line.");
    const rows = quoteRows();
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("edited words");
    expect(within(rows[2]).getByText("You")).toBeInTheDocument();
  });
});

/* ── the time chip plays the lesson ────────────────────────────────────────────────────────────────────────────── */

describe("the time chip", () => {
  it("with the recording on the page: tap plays the lesson from that time", async () => {
    CO.getObservation.mockResolvedValue({ id: "cs-1", audioUrl: "https://r2.example/lesson.webm" });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => undefined);
    await toC1();
    const chip = await within(quoteRows()[0]).findByRole("button", { name: "Play the lesson at 04:30" });
    const audio = document.querySelector("audio[data-testid='ff-audio']") as HTMLAudioElement;
    expect(audio).toHaveAttribute("src", "https://r2.example/lesson.webm");
    fireEvent.click(chip);
    expect(audio.currentTime).toBe(270);
    expect(play).toHaveBeenCalled();
    play.mockRestore();
  });

  it("no recording on the page: the time is a plain chip, not a button", async () => {
    await toC1();
    await waitFor(() => expect(CO.getObservation).toHaveBeenCalled());
    expect(within(quoteRows()[0]).queryByRole("button", { name: /Play the lesson/ })).toBeNull();
    expect(within(quoteRows()[0]).getByTestId("ff-time")).toHaveTextContent("04:30");
  });
});

/* ── principal, Urdu, read only, the name, the boxes ───────────────────────────────────────────────────────────── */

describe("the principal, Urdu and the rest", () => {
  it("the principal: the same form; the legend says Your level; no score", async () => {
    renderPage(true);
    await openSection(/C\. What the teacher does/);
    openRow("C1");
    await screen.findByTestId("ff-indicator");
    const legend = screen.getByTestId("legend");
    expect(legend).toHaveTextContent("Your level");
    expect(legend).toHaveTextContent("NIETE Teaching Assistant’s level");
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole("button", { name: "Add evidence" })).toBeInTheDocument();
  });

  it("in Urdu: the boards' words; the assistant by its Urdu name; Urdu quotes right to left", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    const list = await screen.findByTestId("ff-sections");
    expect(within(list).getByRole("button", { name: /C\. What the teacher does/ })).toHaveTextContent("0/3 مکمل");
    expect(dock().getByRole("button", { name: "محفوظ کریں (3 حصے باقی)" })).toBeInTheDocument();
    await openSection(/C\. What the teacher does/);
    expect(screen.getByText("3 میں سے 0 دیکھ لیے")).toBeInTheDocument();
    openRow("C1");
    await screen.findByTestId("ff-indicator");
    expect(screen.getByText((t) => unisolated(t) === "NIETE ٹیچنگ اسسٹنٹ نے یہ سنا")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "شواہد شامل کریں" })).toBeInTheDocument();
    expect(dock().getByRole("button", { name: "متفق، اگلا" })).toBeInTheDocument();
    expect(within(quoteRows()[0]).getByText(`“${Q1}”`)).toHaveAttribute("data-urdu");
    expect(document.body.textContent).not.toMatch(/Rumi/);
  });

  it("never 'Rumi' anywhere on the form (English)", async () => {
    await toC1();
    expect(document.body.textContent).not.toMatch(/Rumi/);
    fireEvent.click(screen.getAllByRole("button", { name: /back/i })[0]);
    await screen.findByTestId("ff-section");
    expect(document.body.textContent).not.toMatch(/Rumi/);
  });

  it("read only once the teacher has the report: every section green, the saved text, no Save", async () => {
    L.getObservationDraft.mockResolvedValue(V6({ editable: false, saved: true }));
    renderPage();
    await screen.findByTestId("ff-sections");
    expect(screen.getByText("Lubna Arif · Form filled")).toBeInTheDocument();
    expect(sectionRow(/C\. What the teacher does/)).toHaveTextContent("3/3 done");
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    await openSection(/C\. What the teacher does/);
    openRow("C1");
    await screen.findByTestId("ff-indicator");
    expect(screen.queryAllByRole("radiogroup")).toEqual([]);
    expect(screen.getByText(SERVER_EV)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agree and next" })).toBeNull();
  });

  it("every box is sized to its text: one row to start, its height from its content, each paragraph its own direction", async () => {
    const spy = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(132);
    await toC1();
    const box = screen.getByLabelText("To improve") as HTMLTextAreaElement;
    expect(box).toHaveAttribute("rows", "1");
    expect(box).toHaveAttribute("dir", "auto");
    expect(box.className).toMatch(/\[unicode-bidi:plaintext\]/);
    expect(box.style.height).toBe("132px");
    spy.mockRestore();
  });

  it("the switch off: today's paged form (no collapsed sections)", async () => {
    flow.on = false;
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    expect(screen.queryByTestId("ff-sections")).toBeNull();
  });
});

describe("the collapsed form's source", () => {
  const files = ["FormV7List.tsx", "FormV7.tsx"];
  it.each(files)("%s: no words written into the component; start/end only; free text keeps its own direction", (f) => {
    const src = readFileSync(resolve(__dirname, f), "utf8");
    expect(scanCopy(`coach/reports/${f}`, src)).toEqual([]);
    expect(scanStyle(`coach/reports/${f}`, src).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour")).toEqual([]);
    for (const m of src.match(/<(textarea|input)\b[^>]*>/g) || []) expect(m).toMatch(/dir="auto"/);
  });
});
