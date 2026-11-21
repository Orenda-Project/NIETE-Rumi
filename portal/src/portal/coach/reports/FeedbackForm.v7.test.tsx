import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanCopy, scanStyle } from "../../newui/checks/source";

/**
 * bd-o15qnr.31 (#188 canvas-ff, LOCKED 21 Nov): the FICO17 v6 form on the switch is now every section collapsed (its
 * own file: FeedbackForm.ffv7.test.tsx); the tests below follow it into a section and an indicator. The AI is the
 * "NIETE Teaching Assistant", never "Rumi".
 *
 * bd-o15qnr.28 (queue #204, v7; #188's LOCK round, "Screens #206 found with no design", row 10) — the Feedback Form
 * review screens in the v6/v7 look, behind the v6/v7 switch (useFlowV6: a coach on portal_coach_flow_v2, or a principal
 * on the principal app it names). Boards: m9-ff-v6 (+ -ur), m9-ff-save, m9-ff-fico-s, m9-ff-fde, p9-ff-v6.
 *
 *   FICO17 v6     "Lubna Arif · Now: Fill the form"; the rubric as a chip; a legend (Coach score / Rumi's level; the
 *                 principal's "Your level"); Rumi's level ringed purple with a "Rumi" tag; Evidence; To improve;
 *                 "Changed from <level name>" above the levels; the six: "From the recording" read only, the level,
 *                 N/A / Couldn't tell as pills, "Your note (optional)"; ONE amber "Why you changed it"
 *                 per part; the dock Back · Next part (1 : 2)
 *   Save tray     "Save Feedback Form", "17 ratings · 2 levels and 3 notes changed from Rumi's", Save and continue,
 *                 Keep checking, "Next: Record the debrief"
 *   FICO-S / FDE  saved part by part: every Next (and Back) saves, "Saved 11:42 AM" in the chip row, the line "Saved
 *                 part by part …"; FDE: "You choose every level here: no Digital Coach levels on this form."; levels as radio rows
 *
 * Switch off (false, or null while /config is read): today's screens, byte for byte (the snapshots below were taken from
 * the code before v7 existed).
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getPending: vi.fn() },
  leader: { getObservation: vi.fn(), getObservationDraft: vi.fn(), saveObservationDraft: vi.fn(), saveObs612Form: vi.fn() },
}));
const flow = vi.hoisted(() => ({ on: false as boolean | null }));
vi.mock("../flow/useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { leader } from "../../services/api";
import FeedbackForm from "./FeedbackForm";
import { COACH_OBSERVE_ROUTES, ObserveRoutesProvider } from "../observe/observeRoutes";

const L = leader as any;

/* ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const LEVELS4 = ["Not Observed", "Developing", "Proficient", "Highly Effective"];
const lv = (extra: { id: string; title: string }[] = []) => [
  ...LEVELS4.map((t, i) => ({ id: String(i + 1), title: t, description: `${t}: the rubric's words` })),
  ...extra.map((o) => ({ ...o, description: "" })),
];
const EVIDENCE = "The teacher asked “Have you ever visited a sick relative?” and waited for hands.";
const WHY = "Half the class never answered in the lesson.";
const V6 = (extra: Record<string, unknown> = {}) => ({
  kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6" },
  scale: [], fidelityScale: [{ id: "executed", title: "✓ Executed" }],
  sections: [
    { key: "lesson_plan_fidelity", letter: "B", title: "Lesson Plan Fidelity", kind: "moves", header: "", fallback: "No lesson plan was provided.", moves: [] },
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
      indicators: [
        { id: "C1", field: "C1", name: "Quality of Questions Asked by the Teacher", kind: "dc", options: lv(), rumi: "3", rating: "3", evidence: EVIDENCE, improvement: "After an answer, ask “why?”." },
        { id: "C2", field: "C2", name: "Helping when a child is wrong", kind: "dc", options: lv([{ id: "NA", title: "N/A · No child was wrong" }]), rumi: "2", rating: "2", evidence: "", improvement: "" },
        { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: lv([{ id: "NA", title: "N/A · No question asked" }, { id: "IE", title: "Couldn't tell" }]),
          body: "12 children answered, mostly from the front rows.", rating: "", why: "" },
      ] },
    { key: "v6_children", letter: "D", title: "What the children do", kind: "v6", changeReason: "",
      indicators: [
        { id: "D2", field: "D2", name: "How many children spoke", kind: "combined", options: lv(), body: "The recording has 4 student turns.", rating: "", why: "", d2: { children: "", quietLater: "" } },
      ] },
    { key: "v6_subject", letter: "F", title: "Subject knowledge", kind: "v6", changeReason: "",
      indicators: [
        { id: "F1", field: "F1", name: "Accuracy of content", kind: "dc", options: lv(), rumi: "3", rating: "3", evidence: "Correct facts throughout.", improvement: "" },
      ] },
  ],
  ...extra,
});
const OLD = () => ({
  saved: false, editable: true, rubric: { id: "fico_v3", label: "FICO v3" },
  scale: [{ id: "0", title: "0 · Not observed" }, { id: "1", title: "1 · Developing" }, { id: "2", title: "2 · Proficient" }, { id: "na", title: "— Not applicable to this lesson" }],
  fidelityScale: [],
  sections: [
    { key: "planning", letter: "A", title: "Lesson planning", kind: "indicators", notes: [],
      indicators: [{ id: "A1", field: "a1", name: "Objectives shared", rating: "1", evidence: "Wrote the aim on the board.", improvement: "Say it aloud too." }] },
  ],
});

const LEVELS = [0, 1, 2, 3].map((n) => ({ id: String(n), title: `Level ${n}`, description: `What level ${n} looks like` }));
const FS_LEVELS = ["Below standard", "Developing", "Proficient", "Exemplary"].map((t, i) => ({ id: String(i + 1), title: t, description: `${t} in FICO-S words` }));
const item = (name: string, n: number | null, text: string, kind: string, options: any[], extra = {}) => ({
  type: "field", name, role: "item", input: "radio", kind, n, short: null, text, options, required: true, max: null, ...extra,
});
const box = (name: string, role: string, required: boolean, t: string | null = null) => ({
  type: "field", name, role, input: "textarea", kind: null, n: null, short: null, text: t, options: null, required, max: 600,
});
const FDE = (extra: Record<string, unknown> = {}) => ({
  status: "ok", kind: "obs612", label: "FDE v1", rubricId: "obs612-msci-v1", tool: "msci", toolName: "Maths & Science tool",
  toolTitle: "Maths & Science Observation Tool", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "MSCI_A", parts: [
      { type: "heading", text: "Teaching the concept" },
      item("m1", 1, "Uses a model or drawing", "level", LEVELS, { short: "Model or drawing" }),
      box("obs_1", "observation", false),
    ] },
    { id: "MSCI_B", parts: [
      { type: "heading", text: "Feedback" },
      { type: "score", total: 9, max: 12, pct: 75, band: "Proficient" },
      box("fb_line", "line", true),
    ] },
  ],
  values: {}, errors: { m1: "item", fb_line: "text" }, missing: ["m1", "fb_line"], editable: true, sealed: false, submittedAt: null,
  ...extra,
});
const RUMI_LINE = "Rumi chose 3 · Proficient from the recording, and wrote the evidence below. Change either if you saw something different.";
const FICOS = (extra: Record<string, unknown> = {}) => ({
  ...FDE(), label: "FICO-S v1.1", rubricId: "fico_s_v1_1", tool: "ficos", toolName: "FICO 6-12", toolTitle: "FICO 6-12", grade: 9, subject: "science",
  sections: [
    { id: "FS_C1", parts: [
      { type: "heading", text: "C1 · Quality of questions" },
      { type: "sub", text: RUMI_LINE },
      item("C1", null, "Look for: questions that make students think", "level", FS_LEVELS, { short: "Section C · 1 of 5" }),
      box("ev_C1", "other", true, "Evidence: What you saw and heard: at least 20 characters."),
    ] },
    { id: "FS_FB", parts: [{ type: "heading", text: "Feedback" }, box("fb_strengths", "other", true, "Strengths")] },
  ],
  values: { C1: "3", ev_C1: "“Why does the shadow get longer?” Three students explained." }, errors: {}, missing: [],
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
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next part" }));
/** The dock's Back (the header has its own round Back). */
const dockButton = (name: string) => within(screen.getByTestId("form-dock")).getByRole("button", { name });
const toPartC = async () => { await screen.findByText("No lesson plan was provided."); next(); await screen.findByText("Who got to answer"); };
const group = (name: string) => within(screen.getByRole("radiogroup", { name }));
const card = (name: string) => screen.getByText(name).closest("section") as HTMLElement;
/** A kit chip's text on an Urdu page, without the isolates the kit puts round its Latin runs (bidi.ts). */
const flatText = (t: string | null | undefined) => (t || "").replace(/[\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
const unisolated = (t: string) => t.replace(/[\u2066-\u2069]/g, "");
/** The page as markup, its React ids made stable (useId counts across a file). */
const html = () => document.body.innerHTML.replace(/:r[0-9a-z]+:/g, ":r:");

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  flow.on = false;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservation.mockResolvedValue(VIEW);
  L.getObservationDraft.mockResolvedValue(V6());
  L.saveObservationDraft.mockResolvedValue({ success: true });
  L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => ({ ...FDE(), values, errors: {}, missing: [] }));
});
afterEach(() => { vi.useRealTimers(); });

/* ── switch off: today's screens, unchanged ────────────────────────────────────────────────────────────────────── */

describe("switch off: today's Feedback Form, byte for byte", () => {
  it("FICO17 v6, part B then part C", async () => {
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    await screen.findByText(/Step 2 of 4/);
    expect(html()).toMatchSnapshot("v6 part B");
    next();
    await screen.findByText("Who got to answer");
    expect(html()).toMatchSnapshot("v6 part C");
  });

  it("FICO17 v6, the last part and the Save tray", async () => {
    renderPage();
    await toPartC();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Who got to answer" })).getAllByRole("radio")[1]);
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: WHY } });
    next();
    await screen.findByText("How many children spoke");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "How many children spoke" })).getAllByRole("radio")[2]);
    fireEvent.change(screen.getByLabelText("Why this level"), { target: { value: "Four children answered across the lesson." } });
    fireEvent.change(screen.getByLabelText("Children who spoke"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Quiet, then spoke"), { target: { value: "1" } });
    next();
    await screen.findByText("Accuracy of content");
    expect(html()).toMatchSnapshot("v6 part F");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Save and continue" });
    expect(html()).toMatchSnapshot("v6 save tray");
  });

  it("null while /config is read is the same as off", async () => {
    renderPage();
    await toPartC();
    const off = html();
    document.body.innerHTML = "";
    flow.on = null;
    renderPage();
    await toPartC();
    expect(html().replace(/ id="[^"]*"/g, "")).toBe(off.replace(/ id="[^"]*"/g, ""));
  });

  it("an older FICO review", async () => {
    L.getObservationDraft.mockResolvedValue(OLD());
    renderPage();
    await screen.findByText("Objectives shared");
    await screen.findByText(/Step 2 of 4/);
    expect(html()).toMatchSnapshot("old FICO");
  });

  it("the principal's form", async () => {
    renderPage(true);
    await toPartC();
    await screen.findByText(/Step 2 of 4/);
    expect(html()).toMatchSnapshot("principal v6 part C");
  });

  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    await screen.findByText("No lesson plan was provided.");
    fireEvent.click(screen.getByRole("button", { name: "اگلا حصہ" }));
    await screen.findByText("Who got to answer");
    await screen.findByText(/مرحلہ 2 از 4/);
    expect(html()).toMatchSnapshot("v6 part C ur");
  });

  it("FDE and FICO-S", async () => {
    L.getObservationDraft.mockResolvedValue(FDE());
    renderPage();
    await screen.findByText("Teaching the concept");
    await screen.findByText(/Step 2 of 4/);
    expect(html()).toMatchSnapshot("FDE part 1");
    document.body.innerHTML = "";
    L.getObservationDraft.mockResolvedValue(FICOS());
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    await screen.findByText(/Step 2 of 4/);
    expect(html()).toMatchSnapshot("FICO-S part 1");
  });
});

/* ── switch on: FICO17 v6 (m9-ff-v6, p9-ff-v6, m9-ff-v6-ur; bd-o15qnr.31: every section collapsed, canvas-ff) ───────── */

/** bd-o15qnr.31 — the collapsed form: a section from the outer view, then one indicator from its row. */
const openSection = async (letter: string) => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${letter}\\. `) }));
  await screen.findByTestId("ff-section");
};
const openIndicator = async (letter: string, code: string) => {
  await openSection(letter);
  fireEvent.click(within(screen.getByTestId("ff-section")).getByRole("button", { name: new RegExp(`^${code}\\b`) }));
  await screen.findByTestId("ff-indicator");
};
const agree = () => fireEvent.click(dockButton("Agree and next"));

describe("switch on: FICO17 v6, as m9-ff-v6 draws it (collapsed, canvas-ff)", () => {
  beforeEach(() => { flow.on = true; });

  it("the header: the teacher and Now: Fill the form; the rubric as a chip; the sections, collapsed", async () => {
    renderPage();
    expect(await screen.findByText("Lubna Arif · Now: Fill the form")).toBeInTheDocument();
    expect(screen.queryByText(/Step \d of 4/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Feedback Form" })).toBeInTheDocument();
    const chip = screen.getByTestId("rubric-label");
    expect(chip).toHaveTextContent("FICO17 v6");
    expect(within(chip).getByText("FICO17 v6").closest("[data-chip]")).not.toBeNull(); // the kit's StatusChip
    expect(within(screen.getByTestId("ff-sections")).getAllByRole("button")).toHaveLength(4);
  });

  it("one of the assistant's: the legend, its level ringed with its tag, Evidence and To improve", async () => {
    renderPage();
    await openIndicator("C", "C1");
    // bd-o15qnr.36 (the operator 21 Nov ~14:20): the legend reads You · Digital Coach
    expect(flatText(screen.getByTestId("legend").textContent)).toBe("You · Digital Coach");
    const c1 = group("Quality of Questions Asked by the Teacher");
    const rumi = c1.getByRole("radio", { name: /^Proficient/ });
    expect(rumi).toHaveAttribute("aria-checked", "true");
    expect(rumi).toHaveAccessibleName("Proficient, Digital Coach’s level");
    expect(within(rumi).getByText("Digital Coach")).toBeInTheDocument();
    expect(c1.getByRole("radio", { name: "Developing" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radiogroup", { name: "Quality of Questions Asked by the Teacher" })).toHaveAttribute("data-look", "radio");
    const ind = within(screen.getByTestId("ff-indicator"));
    expect(ind.getByLabelText("Evidence")).toHaveValue(EVIDENCE); // no assistant list from this bot: today's one box
    expect(ind.getByLabelText("To improve")).toHaveValue("After an answer, ask “why?”.");
    expect(screen.queryByText("What was seen")).toBeNull();
  });

  it("a changed level says Changed from <the assistant's level>, above the levels; the part's ONE reason asked on it", async () => {
    renderPage();
    await openIndicator("C", "C1");
    expect(screen.queryByLabelText("Why you changed it")).toBeNull();
    fireEvent.click(group("Quality of Questions Asked by the Teacher").getByRole("radio", { name: "Developing" }));
    const chip = await screen.findByText("Changed from Proficient");
    const levels = screen.getByRole("radiogroup", { name: "Quality of Questions Asked by the Teacher" });
    expect(chip.compareDocumentPosition(levels) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByLabelText("Why you changed it")).toHaveLength(1);
    expect(screen.getByTestId("why-changed")).toContainElement(screen.getByLabelText("Why you changed it"));
    fireEvent.change(screen.getByLabelText("Why you changed it"), { target: { value: "short" } });
    fireEvent.click(within(screen.getByTestId("ff-indicator")).getByRole("button", { name: "Next" }));
    await screen.findByText("Lubna Arif · C · 2 of 3");
    fireEvent.click(group("Helping when a child is wrong").getByRole("radio", { name: "Proficient" }));
    expect(await screen.findByText("Changed from Developing")).toBeInTheDocument();
    expect(screen.getByLabelText("Why you changed it")).toHaveValue("short"); // the part's one reason (chg_C)
    agree();
    expect(await screen.findAllByText("At least 20 letters")).not.toHaveLength(0);
  });

  it("one of the six: From the recording read only, the level, N/A and Couldn't tell as pills, Why this level", async () => {
    renderPage();
    await openIndicator("C", "C3");
    const c3 = within(screen.getByTestId("ff-indicator"));
    expect(c3.getByText("From the recording")).toBeInTheDocument();
    expect(c3.getByText("12 children answered, mostly from the front rows.")).toBeInTheDocument();
    expect(c3.queryAllByRole("textbox")).toHaveLength(1); // only Why this level: the recording's words are read only
    const levels = group("Who got to answer");
    expect(levels.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(levels.queryByText("Digital Coach")).toBeNull();
    const pills = levels.getAllByTestId("level-aside");
    expect(pills.map((p) => p.textContent)).toEqual(["N/A · No question asked", "Couldn't tell"]);
    expect(pills[0]).toHaveAttribute("role", "radio");
    expect(c3.getByLabelText("Your note (optional)")).toBeInTheDocument();
    agree();
    expect(await screen.findByText("Choose a level")).toBeInTheDocument();
    fireEvent.click(pills[1]);
    expect(pills[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.change(c3.getByLabelText("Your note (optional)"), { target: { value: WHY } });
    agree();
    expect(await screen.findByText("Lubna Arif · C · 1 of 3")).toBeInTheDocument(); // on to the next yellow row
  });

  it("the docks: Save on the sections, Next to check in a section, Agree and next on an indicator", async () => {
    renderPage();
    await screen.findByTestId("ff-sections");
    expect(dockButton("Save (3 sections to finish)")).toBeInTheDocument();
    await openSection("C");
    expect(dockButton("Next to check: C1 Quality of Questions Asked by the Teacher")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("ff-section")).getByRole("button", { name: /^C2\b/ }));
    await screen.findByTestId("ff-indicator");
    expect(dockButton("Agree and next")).toBeInTheDocument();
  });

  it("the Save tray: N ratings · what changed from the assistant's, Save and continue, Keep checking, Next: Record the debrief", async () => {
    renderPage();
    await openIndicator("C", "C1");
    fireEvent.click(group("Quality of Questions Asked by the Teacher").getByRole("radio", { name: "Developing" }));
    fireEvent.change(screen.getByLabelText("Why you changed it"), { target: { value: "The questions were all closed ones." } });
    agree();
    await screen.findByText("Lubna Arif · C · 2 of 3");
    agree();
    await screen.findByText("Lubna Arif · C · 3 of 3");
    fireEvent.click(group("Who got to answer").getByRole("radio", { name: "Developing" }));
    fireEvent.change(screen.getByLabelText("Your note (optional)"), { target: { value: WHY } });
    agree();
    await screen.findByTestId("ff-section");
    fireEvent.click(dockButton("Next to check: D2 How many children spoke"));
    await screen.findByText("Lubna Arif · D · 1 of 1");
    fireEvent.click(group("How many children spoke").getByRole("radio", { name: "Proficient" }));
    fireEvent.change(screen.getByLabelText("Your note (optional)"), { target: { value: "Four children answered across the lesson." } });
    fireEvent.change(screen.getByLabelText("Children who spoke"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Quiet, then spoke"), { target: { value: "1" } });
    agree();
    await screen.findByTestId("ff-section");
    fireEvent.click(dockButton("Next to check: F1 Accuracy of content"));
    await screen.findByText("Lubna Arif · F · 1 of 1");
    fireEvent.change(screen.getByLabelText("Evidence"), { target: { value: "Correct facts, and one slip on dates." } });
    agree();
    await screen.findByTestId("ff-section");
    fireEvent.click(dockButton("Done"));
    await screen.findByTestId("ff-sections");
    fireEvent.click(dockButton("Save"));
    const tray = within(await screen.findByRole("dialog", { name: "Save Feedback Form" }));
    expect(tray.getByText("5 ratings · 1 level and 1 note changed from the Digital Coach’s")).toBeInTheDocument();
    expect(tray.getByText("Next: Record the debrief")).toBeInTheDocument();
    fireEvent.click(tray.getByRole("button", { name: "Keep checking" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(dockButton("Save"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(1));
    expect(L.saveObservationDraft.mock.calls[0][1]).toMatchObject({
      r_C1: "2", chg_C: "The questions were all closed ones.", r_C3: "2", why_C3: WHY, r_D2: "3", d2_children: "4", d2_quiet_later: "1",
      r_F1: "3", ev_F1: "Correct facts, and one slip on dates.",
    });
    expect(L.saveObservationDraft.mock.calls[0]).toHaveLength(2); // no assistant lists from this bot: today's call
    expect(await screen.findByText("observation page")).toBeInTheDocument();
  });

  it("read only once the teacher has the report: no levels to tap, no Save; the crumb says the form is filled", async () => {
    L.getObservationDraft.mockResolvedValue(V6({ editable: false, saved: true }));
    renderPage();
    expect(await screen.findByText("Lubna Arif · Form filled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    await openIndicator("C", "C3");
    expect(screen.getByText("Who got to answer")).toBeInTheDocument();
    expect(screen.queryAllByRole("radiogroup")).toEqual([]);
  });

  it("the principal: the same form; the legend says You · Digital Coach", async () => {
    renderPage(true);
    await openIndicator("C", "C1");
    expect(screen.getByText("Lubna Arif · C · 1 of 3")).toBeInTheDocument();
    const legend = screen.getByTestId("legend");
    expect(flatText(legend.textContent)).toBe("You · Digital Coach");
    expect(legend).not.toHaveTextContent("Coach score");
    expect(group("Quality of Questions Asked by the Teacher").getByRole("radio", { name: "Proficient, Digital Coach’s level" })).toBeInTheDocument();
  });

  it("in Urdu (m9-ff-v6-ur, ff-*-ur): the boards' words; the data stays as it came", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    expect(await screen.findByText("Lubna Arif · ابھی: فارم بھریں")).toBeInTheDocument();
    await openIndicator("C", "C1");
    expect(flatText(screen.getByTestId("legend").textContent)).toBe("آپ · ڈیجیٹل کوچ");
    const c1 = within(screen.getByTestId("ff-indicator"));
    expect(c1.getByLabelText("شواہد")).toHaveValue(EVIDENCE);
    expect(c1.getByLabelText("بہتری کے لیے")).toBeInTheDocument();
    fireEvent.click(group("Quality of Questions Asked by the Teacher").getByRole("radio", { name: "Developing" }));
    expect(await screen.findByText((t) => unisolated(t) === "Proficient سے بدلا گیا")).toBeInTheDocument();
    expect(screen.getByLabelText("آپ نے کیوں بدلا")).toBeInTheDocument();
    expect(dockButton("متفق، اگلا")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("ff-indicator")).getByRole("button", { name: "اگلا" }));
    fireEvent.click(within(screen.getByTestId("ff-indicator")).getByRole("button", { name: "اگلا" }));
    await screen.findByText("Who got to answer");
    expect(within(screen.getByTestId("ff-indicator")).getByText("ریکارڈنگ سے")).toBeInTheDocument();
    expect(within(screen.getByTestId("ff-indicator")).getByLabelText("آپ کا نوٹ (اختیاری)")).toBeInTheDocument();
    expect(group("Who got to answer").getAllByTestId("level-aside").map((p) => p.textContent)).toEqual(["لاگو نہیں · No question asked", "پتا نہیں چل سکا"]);
  });

  it("an older FICO review keeps the paged look: the Digital Coach's level tagged as the assistant's until saved", async () => {
    L.getObservationDraft.mockResolvedValue(OLD());
    renderPage();
    await screen.findByText("Objectives shared");
    const a1 = group("Objectives shared");
    expect(a1.getByRole("radio", { name: "Developing, Digital Coach’s level" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(a1.getByRole("radio", { name: "Proficient" }));
    expect(await screen.findByText("Changed from Developing")).toBeInTheDocument();
    expect(within(card("Objectives shared")).getByLabelText("Evidence")).toHaveValue("Wrote the aim on the board.");
  });
});

/* ── switch on: FICO-S and FDE, saved part by part (m9-ff-fico-s, m9-ff-fde) ───────────────────────────────────── */

describe("switch on: FICO-S v1.1 and FDE, saved part by part", () => {
  beforeEach(() => {
    flow.on = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T05:58:00Z")); // 10:58 AM in Pakistan, the portal's clock
  });

  it("FDE: the tool as a chip, no Rumi levels, levels as radio rows, Back and Next part (no Save draft)", async () => {
    L.getObservationDraft.mockResolvedValue(FDE());
    renderPage();
    await screen.findByText("Teaching the concept");
    expect(screen.getByText("Lubna Arif · Now: Fill the form")).toBeInTheDocument();
    expect(screen.getByTestId("rubric-label")).toHaveTextContent("FDE v1 · Maths & Science tool · G7");
    expect(screen.getByText("You choose every level here: no Digital Coach levels on this form.")).toBeInTheDocument();
    expect(screen.queryByTestId("legend")).toBeNull();
    expect(screen.queryByText("Rumi")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Model or drawing" })).toHaveAttribute("data-look", "radio");
    expect(group("Model or drawing").getByRole("radio", { name: "Level 2" })).toBeInTheDocument();
    expect(dockButton("Back")).toBeInTheDocument();
    expect(dockButton("Next part")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByText(/^Saved \d/)).toBeNull(); // nothing saved here yet
  });

  it("Next saves the part: Saved <time> in the chip row; the score is a count, never a %", async () => {
    L.getObservationDraft.mockResolvedValue(FDE());
    renderPage();
    await screen.findByText("Teaching the concept");
    fireEvent.click(group("Model or drawing").getByRole("radio", { name: "Level 2" }));
    next();
    await screen.findByText("Feedback");
    expect(L.saveObs612Form).toHaveBeenCalledWith("cs-1", expect.objectContaining({ m1: "2" }), false);
    expect(within(screen.getByTestId("form-chips")).getByText("Saved 10:58 AM")).toBeInTheDocument();
    expect(screen.getByText("Saved part by part: leave and come back without losing anything.")).toBeInTheDocument();
    expect(screen.getByText("9 / 12")).toBeInTheDocument();
    expect(screen.queryByText(/75%/)).toBeNull();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("Back saves what changed on the part, then goes back; with nothing changed it only goes back", async () => {
    L.getObservationDraft.mockResolvedValue(FDE());
    renderPage();
    await screen.findByText("Teaching the concept");
    fireEvent.click(group("Model or drawing").getByRole("radio", { name: "Level 1" }));
    next();
    await screen.findByText("Feedback");
    fireEvent.change(screen.getByLabelText("Feedback for the teacher"), { target: { value: "Use the fraction bar again tomorrow." } });
    fireEvent.click(dockButton("Back"));
    await screen.findByText("Teaching the concept");
    expect(L.saveObs612Form).toHaveBeenCalledTimes(2);
    expect(L.saveObs612Form.mock.calls[1][1]).toMatchObject({ m1: "1", fb_line: "Use the fraction bar again tomorrow." });
    fireEvent.click(dockButton("Back"));
    expect(await screen.findByText("observation page")).toBeInTheDocument();
    expect(L.saveObs612Form).toHaveBeenCalledTimes(2);
  });

  it("FICO-S: its label, tool and grade as a chip; Rumi's line as the bot wrote it; no FDE note", async () => {
    L.getObservationDraft.mockResolvedValue(FICOS());
    L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => ({ ...FICOS(), values }));
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    expect(screen.getByTestId("rubric-label")).toHaveTextContent("FICO-S v1.1 · FICO 6-12 · G9");
    expect(screen.getByText(RUMI_LINE)).toBeInTheDocument();
    expect(screen.queryByText("You choose every level here: no Digital Coach levels on this form.")).toBeNull();
    expect(group("Section C · 1 of 5").getByRole("radio", { name: "Proficient" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Saved part by part: leave and come back without losing anything.")).toBeInTheDocument();
    next();
    await screen.findByText("Strengths");
    expect(within(screen.getByTestId("form-chips")).getByText("Saved 10:58 AM")).toBeInTheDocument();
  });

  it("read only once submitted: the crumb says the form is filled; Back and Next only", async () => {
    L.getObservationDraft.mockResolvedValue(FDE({ editable: false, sealed: true, values: { m1: "2" } }));
    renderPage();
    await screen.findByText("Teaching the concept");
    expect(screen.getByText("Lubna Arif · Form filled")).toBeInTheDocument();
    expect(screen.queryAllByRole("radiogroup")).toEqual([]);
    next();
    await screen.findByText("Feedback");
    expect(L.saveObs612Form).not.toHaveBeenCalled();
  });
});

/* ── the source: words in copy files, start/end only ───────────────────────────────────────────────────────────── */

describe("the v7 form's source", () => {
  const rel = "coach/reports/FormV7.tsx";
  const src = () => readFileSync(resolve(__dirname, "FormV7.tsx"), "utf8");
  it("no words written into the component (they come from the copy files or the API)", () => {
    expect(scanCopy(rel, src())).toEqual([]);
  });
  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    expect(scanStyle(rel, src()).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour")).toEqual([]);
  });
  it("free text keeps its own direction", () => {
    for (const m of src().match(/<(textarea|input)\b[^>]*>/g) || []) expect(m).toMatch(/dir="auto"/);
  });
});
