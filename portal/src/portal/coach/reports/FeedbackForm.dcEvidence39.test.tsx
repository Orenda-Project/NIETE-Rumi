import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.39.1 (queue #204; the operator 22 Nov, via Godfather) — the Feedback Form on the v6/v7 switch, FICO17 v6.1
 * and FICO-S v1.2, coach and principal, English and Urdu:
 *
 *   the box      ONE box titled "Digital Coach's evidence" (Urdu ڈیجیٹل کوچ کے شواہد) on every indicator where the
 *                Digital Coach gave evidence: it replaces "From the recording" (the six) and the evidence box's
 *                "Evidence" label with its "Digital Coach heard" line (the eleven). It holds only its findings, as
 *                evidence rows (time + quote); the eleven keep edit / remove / Add evidence. Heard nothing: no box at
 *                all (never "Nothing for this in the recording"). D2's counts, N/A, couldn't tell, starred: a muted row.
 *   the six      the line under the name also says how to fill it (the bot's `hint`: D2 "Chorus answers don't
 *                count."); no "You add: …" anywhere; "The Digital Coach can't count this one. You decide." stays on
 *                the six only (where it gives no level)
 *   N/A          a regular 5th level card after the four, the same radio, its own words and description; no pill;
 *                indicators without N/A show four. N/A is saved as today (r_<code> = "NA").
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

const LEVELS4 = ["Not Observed", "Developing", "Proficient", "Highly Effective"];
const lv = (na: { title: string; description: string } | null = null) => [
  ...LEVELS4.map((t, i) => ({ id: String(i + 1), title: t, description: `${t}: the rubric's words` })),
  ...(na ? [{ id: "NA", ...na }] : []),
];
const NA_C2 = { title: "N/A · No child was wrong", description: "No child was wrong in this lesson, so there was nothing to help with." };
const NA_C3 = { title: "N/A · No question asked", description: "The teacher asked the children no question to answer." };
const NA_C3_UR = { title: "لاگو نہیں · کوئی سوال نہیں", description: "استاد نے بچوں سے جواب کے لیے کوئی سوال نہیں پوچھا۔" };
const BECAUSE = "Two open questions, the rest recall.";
const Q_UR = "بتائیں، بلی کی کتنی ٹانگیں ہوتی ہیں؟";
const YOU_ADD = "choosing that cannot be heard (pointing, a nod), and whether quiet children were brought in.";
const rec = (over: Record<string, unknown>) => ({ lookFor: "What to look for, the rubric's words.", state: "none", found: [], naText: null, turns: null, youAdd: YOU_ADD, ...over });
const D2_ABOUT = "How much of the class speaks on their own.";
const D2_HINT = "Chorus answers don't count.";

const V6 = (opts: { ur?: boolean; saved?: boolean } = {}) => ({
  kind: "fico17_v6", saved: !!opts.saved, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6.1" },
  scale: [], fidelityScale: [], notes: [],
  sections: [
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
      indicators: [
        { id: "C1", field: "C1", name: "Quality of Questions Asked by the Teacher", kind: "dc", options: lv(), rumi: "3", rating: "3",
          evidence: `${BECAUSE} · 04:30 "Why seven?"`, improvement: "", about: "The kinds of questions the teacher asks.",
          rumiEvidence: { because: BECAUSE, items: [{ time: "04:30", quote: "Why seven?" }, { time: "12:15", quote: Q_UR }] } },
        // the Digital Coach gave nothing for C2 (no rumiEvidence): no box, the coach's own Evidence box
        { id: "C2", field: "C2", name: "Helping when a child is wrong", kind: "dc", options: lv(NA_C2), rumi: "2", rating: "2",
          evidence: "", improvement: "", about: "What the teacher does when a child's answer is wrong." },
        { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: lv(opts.ur ? NA_C3_UR : NA_C3), body: "old body", rating: "", why: "",
          about: "How the teacher chooses who answers.", hint: "Choosing by pointing or a nod counts too; the recording can't hear it.",
          recording: rec({ state: "found", found: [{ time: "05:00", quote: "Ali, what do you think?" }, { time: "09:12", quote: "Sana, you tell us." }] }) },
        { id: "C5", field: "C5", name: "Switching activities", kind: "combined", options: lv({ title: "N/A · Class never switched", description: "The class stayed on one activity all lesson." }),
          body: "old body", rating: "", why: "", about: "How smoothly the class moves to the next activity.", hint: "Time it yourself, from the signal until the class is working.",
          recording: rec({ state: "none" }) },
        { id: "C7", field: "C7", name: "Group work", kind: "combined", options: lv(), body: "old body", rating: "", why: "",
          about: "Whether the teacher sets real pair or group work.", hint: "Sitting together but working alone is not group work.",
          recording: rec({ state: "starred" }) },
      ] },
    { key: "v6_children", letter: "D", title: "What the children do", kind: "v6", changeReason: "",
      indicators: [
        { id: "D2", field: "D2", name: "How many children spoke", kind: "combined", options: lv(), body: "old body", rating: "", why: "",
          about: opts.ur ? "جماعت کا کتنا حصہ اکیلے بولتا ہے۔" : D2_ABOUT, hint: opts.ur ? "سب کا مل کر ایک ساتھ جواب دینا شمار نہیں ہوتا۔" : D2_HINT,
          recording: rec({ state: "d2", turns: { first: 4, second: 7 } }) },
        { id: "D3", field: "D3", name: "Children answering each other", kind: "combined", options: lv(), body: "old body", rating: "", why: "",
          about: "Whether children talk to each other about the task.", hint: "Listen in during pair and group work.",
          recording: rec({ state: "ie" }) },
        { id: "D4", field: "D4", name: "Trying when unsure", kind: "combined", options: lv(NA_C3), body: "old body", rating: "", why: "",
          about: "Whether children dare to answer when they are not sure.", hint: "Only the trying counts, not whether the answer is right.",
          recording: rec({ state: "na", naText: "No question was asked in this transcript." }) },
        // an older bot: no about, no hint → the look-for under the name
        { id: "D5", field: "D5", name: "Children asking questions", kind: "combined", options: lv(), body: "old body", rating: "", why: "",
          recording: rec({ state: "none", lookFor: "Whether children ask questions of their own." }) },
      ] },
  ],
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
const toIndicator = async (letter: "C" | "D", code: string, principal = false) => {
  renderPage(principal);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${letter}\\. `) }));
  await screen.findByTestId("ff-section");
  fireEvent.click(within(screen.getByTestId("ff-section")).getByRole("button", { name: new RegExp(`^${code}\\b`) }));
  return screen.findByTestId("ff-indicator");
};
const card = () => within(screen.getByTestId("ff-card"));
const group = (name: string) => within(screen.getByRole("radiogroup", { name }));
const flat = (t: string | null | undefined) => (t || "").replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const dock = () => within(screen.getByTestId("form-dock"));

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

describe("one box: Digital Coach's evidence (FICO17 v6.1)", () => {
  it("one of the eleven: the box is titled Digital Coach's evidence; no 'Digital Coach heard', no 'Evidence' label; rows keep edit, remove and Add evidence", async () => {
    await toIndicator("C", "C1");
    const box = within(card().getByTestId("dc-evidence"));
    expect(box.getByText("Digital Coach’s evidence")).toBeInTheDocument();
    expect(card().getAllByTestId("dc-evidence")).toHaveLength(1);
    expect(screen.getByTestId("ff-card").textContent).not.toMatch(/Digital Coach heard|From the recording/);
    expect(card().queryByText("Evidence")).toBeNull();
    expect(box.getByTestId("ff-summary")).toHaveTextContent(BECAUSE);
    const rows = box.getAllByTestId("ff-quote");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("ff-time")).toHaveTextContent("04:30");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "More: edit or remove" }));
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(box.getByRole("button", { name: "Add evidence" })).toBeInTheDocument();
  });

  it("one of the eleven the Digital Coach gave nothing for: no box; the coach's own Evidence box", async () => {
    await toIndicator("C", "C2");
    expect(card().queryByTestId("dc-evidence")).toBeNull();
    expect(card().getByLabelText("Evidence")).toBeInTheDocument();
  });

  it("one of the six, snippets found: the same title, each snippet as a row (time + quote), nothing else", async () => {
    await toIndicator("C", "C3");
    const box = within(card().getByTestId("dc-evidence"));
    expect(box.getByText("Digital Coach’s evidence")).toBeInTheDocument();
    const rows = box.getAllByTestId("dc-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("ff-time")).toHaveTextContent("05:00");
    expect(rows[0]).toHaveTextContent("Ali, what do you think?");
    const text = screen.getByTestId("ff-indicator").textContent || "";
    expect(text).not.toMatch(/From the recording|You add|Nothing for this|What to look for/);
    expect(text).not.toContain(YOU_ADD);
  });

  it("one of the six, nothing heard: no box at all, no 'Nothing for this in the recording'", async () => {
    await toIndicator("C", "C5");
    expect(card().queryByTestId("dc-evidence")).toBeNull();
    expect(screen.getByTestId("ff-indicator").textContent).not.toMatch(/Nothing for this|From the recording|Digital Coach’s evidence/);
  });

  it("what the Digital Coach said instead of snippets is a muted row in the box: D2's counts, N/A, couldn't tell, starred", async () => {
    await toIndicator("D", "D2");
    let note = within(card().getByTestId("dc-evidence")).getByTestId("dc-note");
    expect(note).toHaveTextContent("4 student turns in the first half and 7 in the second");
    fireEvent.click(within(screen.getByTestId("ff-indicator")).getByRole("button", { name: "Next" }));
    await screen.findByText("Lubna Arif · D · 2 of 4");
    expect(within(card().getByTestId("dc-evidence")).getByTestId("dc-note")).toHaveTextContent("The recording couldn't show this.");
    fireEvent.click(within(screen.getByTestId("ff-indicator")).getByRole("button", { name: "Next" }));
    await screen.findByText("Lubna Arif · D · 3 of 4");
    note = within(card().getByTestId("dc-evidence")).getByTestId("dc-note");
    expect(note).toHaveTextContent("No question was asked in this transcript.");
    expect(note.className).toMatch(/text-\[#6b7280\]/);
  });

  it("starred: a muted row saying the Digital Coach does not listen for it", async () => {
    await toIndicator("C", "C7");
    expect(within(card().getByTestId("dc-evidence")).getByTestId("dc-note")).toHaveTextContent("the Digital Coach doesn't listen for this one");
  });

  it("the principal: the same box and title", async () => {
    await toIndicator("C", "C1", true);
    expect(within(card().getByTestId("dc-evidence")).getByText("Digital Coach’s evidence")).toBeInTheDocument();
  });

  it("Urdu: ڈیجیٹل کوچ کے شواہد; never ڈیجیٹل کوچ نے یہ سنا or ریکارڈنگ سے", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    await toIndicator("C", "C1");
    expect(within(card().getByTestId("dc-evidence")).getByText((t) => flat(t) === "ڈیجیٹل کوچ کے شواہد")).toBeInTheDocument();
    expect(screen.getByTestId("ff-card").textContent).not.toMatch(/نے یہ سنا|ریکارڈنگ سے/);
    expect(within(screen.getAllByTestId("ff-quote")[1]).getByText(`“${Q_UR}”`)).toHaveAttribute("data-urdu");
  });
});

describe("the six: the line under the name says how to fill it", () => {
  it("D2: the line and its hint together; the can't-count line stays; no You add", async () => {
    await toIndicator("D", "D2");
    const about = screen.getByTestId("ff-about");
    expect(flat(about.textContent)).toBe(`${D2_ABOUT} ${D2_HINT}`);
    expect(within(about).getByTestId("ff-hint")).toHaveTextContent(D2_HINT);
    expect(card().getByTestId("cant-count")).toHaveTextContent("The Digital Coach can't count this one. You decide.");
    expect(screen.getByTestId("ff-indicator").textContent).not.toMatch(/You add/);
  });

  it("the hint is never cut short (the line is not clamped to two lines when it carries one)", async () => {
    await toIndicator("C", "C3");
    const line = within(screen.getByTestId("ff-about")).getByTestId("ff-hint").closest("p") as HTMLElement;
    expect(line.className).not.toMatch(/line-clamp-2/);
  });

  it("an older bot (no line, no hint): its look-for under the name, not in a box", async () => {
    await toIndicator("D", "D5");
    expect(within(screen.getByTestId("ff-about")).getByText("Whether children ask questions of their own.")).toBeInTheDocument();
    expect(card().queryByTestId("dc-evidence")).toBeNull();
  });

  it("one of the eleven: no can't-count line, its line stays clamped", async () => {
    await toIndicator("C", "C1");
    expect(card().queryByTestId("cant-count")).toBeNull();
    expect(within(screen.getByTestId("ff-about")).getByText("The kinds of questions the teacher asks.").className).toMatch(/line-clamp-2/);
  });

  it("the principal: the same line and hint", async () => {
    await toIndicator("D", "D2", true);
    expect(flat(screen.getByTestId("ff-about").textContent)).toBe(`${D2_ABOUT} ${D2_HINT}`);
  });

  it("Urdu: the Urdu line and hint, in Nastaliq", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.getObservationDraft.mockResolvedValue(V6({ ur: true }));
    await toIndicator("D", "D2");
    const about = screen.getByTestId("ff-about");
    expect(flat(about.textContent)).toBe("جماعت کا کتنا حصہ اکیلے بولتا ہے۔ سب کا مل کر ایک ساتھ جواب دینا شمار نہیں ہوتا۔");
    expect(about.querySelector("p")).toHaveAttribute("data-urdu");
    expect(screen.getByTestId("ff-indicator").textContent).not.toMatch(/آپ شامل کریں/);
  });
});

describe("N/A: a regular 5th level card", () => {
  it("one of the eleven (C2): five rows, N/A last in its own words and description, the same radio; no pill", async () => {
    await toIndicator("C", "C2");
    const levels = group("Helping when a child is wrong");
    const radios = levels.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(radios[4]).toHaveAccessibleName("N/A · No child was wrong");
    expect(radios[4]).toHaveTextContent(NA_C2.description);
    expect(radios[4].className).toBe(radios[0].className); // the same card as level 1 (neither picked nor the Digital Coach's)
    expect(radios[4].querySelector("[data-dot]")).not.toBeNull();
    expect(screen.queryAllByTestId("level-aside")).toHaveLength(0);
  });

  it("one of the six (C3): five rows, N/A last; one without N/A (D2): four", async () => {
    await toIndicator("C", "C3");
    const radios = group("Who got to answer").getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("data-radio-key"))).toEqual(["1", "2", "3", "4", "NA"]);
    expect(radios[4]).toHaveAccessibleName("N/A · No question asked");
    expect(radios[4].querySelector("[data-dot]")).not.toBeNull();
    expect(screen.queryAllByTestId("level-aside")).toHaveLength(0);
    fireEvent.click(radios[4]);
    expect(radios[4]).toHaveAttribute("aria-checked", "true");
  });

  it("an indicator without N/A shows the four only", async () => {
    await toIndicator("D", "D2");
    expect(group("How many children spoke").getAllByRole("radio")).toHaveLength(4);
  });

  it("N/A is saved as today: r_<code> = NA", async () => {
    L.getObservationDraft.mockResolvedValue({ ...V6({ saved: true }), sections: [V6().sections[0]] });
    await toIndicator("C", "C2");
    fireEvent.click(group("Helping when a child is wrong").getByRole("radio", { name: "N/A · No child was wrong" }));
    fireEvent.change(screen.getByLabelText("Why you changed it"), { target: { value: "No child gave a wrong answer all lesson." } });
    for (const [code, name] of [["C3", "Who got to answer"], ["C5", "Switching activities"], ["C7", "Group work"]] as const) {
      fireEvent.click(within(screen.getByTestId("ff-indicator")).getByRole("button", { name: "Next" }));
      await screen.findByRole("radiogroup", { name });
      const rows = group(name).getAllByRole("radio");
      fireEvent.click(code === "C7" ? rows[1] : rows[rows.length - 1]);
    }
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    fireEvent.click(await dock().findByRole("button", { name: "Save" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(L.saveObservationDraft).toHaveBeenCalledTimes(1));
    const [, edits] = L.saveObservationDraft.mock.calls[0];
    expect(edits).toMatchObject({ r_C2: "NA", r_C3: "NA", r_C5: "NA", r_C7: "2" });
  });

  it("Urdu: لاگو نہیں and its words, a 5th card", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.getObservationDraft.mockResolvedValue(V6({ ur: true }));
    await toIndicator("C", "C3");
    const radios = group("Who got to answer").getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(radios[4]).toHaveAccessibleName("لاگو نہیں · کوئی سوال نہیں");
    expect(radios[4]).toHaveTextContent(NA_C3_UR.description);
  });

  it("the principal: the same 5th card", async () => {
    await toIndicator("C", "C2", true);
    expect(group("Helping when a child is wrong").getAllByRole("radio")).toHaveLength(5);
    expect(screen.queryAllByTestId("level-aside")).toHaveLength(0);
  });
});

/* ── FICO-S v1.2 ───────────────────────────────────────────────────────────────────────────────────────────────── */

const FLEVELS = ["Below standard", "Developing", "Proficient", "Exemplary"].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}`, description: `What level ${i + 1} looks like` }));
const F_NA_C2 = { id: "NA", title: "N/A · No answer was wrong", description: "No answer was wrong in this lesson, so there was nothing to respond to." };
const fitem = (name: string, short: string, options: any[], extra = {}) => ({
  type: "field", name, role: "item", input: "radio", kind: "level", n: null, short, text: `Look for ${name}`, options, required: true, max: null,
  about: `What ${name} looks at.`, notes: "How: In class", ...extra,
});
const fev = (name: string) => ({ type: "field", name, role: "other", input: "textarea", kind: null, n: null, short: null, text: "Evidence: What you saw and heard", options: null, required: true, max: 600 });
const FICOS = () => ({
  status: "ok", kind: "obs612", label: "FICO 6-12 v1.2", rubricId: "fico_s_v1_2", tool: "ficos", toolName: "FICO 6-12",
  toolTitle: "FICO 6-12 v1.2", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "FS_C1", parts: [
      { type: "heading", text: "C1 · Quality of questions" },
      fitem("C1", "Section C · 1 of 8", FLEVELS, { dcEvidence: { because: "Two open questions.", items: [{ time: "04:30", quote: "Why seven?" }, { time: null, quote: Q_UR }] } }),
      fev("ev_C1"),
      { type: "heading", text: "C2 · Responding to wrong answers" },
      fitem("C2", "Section C · 2 of 8", [...FLEVELS, F_NA_C2]),
      fev("ev_C2"),
    ] },
  ],
  values: { C1: "3", ev_C1: "Two open questions. [04:30] \"Why seven?\"" }, errors: {}, missing: [], editable: true, sealed: false, submittedAt: null,
});

describe("FICO-S v1.2", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(FICOS()); });

  it("where the Digital Coach gave evidence: one box titled Digital Coach's evidence, its line and each quote as a row; none elsewhere", async () => {
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    const boxes = screen.getAllByTestId("dc-evidence");
    expect(boxes).toHaveLength(1);
    const box = within(boxes[0]);
    expect(box.getByText("Digital Coach’s evidence")).toBeInTheDocument();
    expect(box.getByTestId("dc-summary")).toHaveTextContent("Two open questions.");
    const rows = box.getAllByTestId("dc-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("ff-time")).toHaveTextContent("04:30");
    expect(within(rows[1]).getByText(`“${Q_UR}”`)).toHaveAttribute("data-urdu");
    // after C1's levels, before its Evidence box
    const c1 = screen.getAllByTestId("fde-item")[0];
    expect(c1.compareDocumentPosition(boxes[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boxes[0].compareDocumentPosition(screen.getAllByRole("textbox")[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("N/A on C2 is a regular 5th row (the same radio), not a pill", async () => {
    renderPage();
    await screen.findByText("C2 · Responding to wrong answers");
    const radios = group("Section C · 2 of 8").getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(radios[4]).toHaveAccessibleName("N/A · No answer was wrong");
    expect(radios[4].querySelector("[data-dot]")).not.toBeNull();
    expect(screen.queryAllByTestId("level-aside")).toHaveLength(0);
  });

  it("the principal, and Urdu: ڈیجیٹل کوچ کے شواہد", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage(true);
    await screen.findByText("C1 · Quality of questions");
    expect(within(screen.getByTestId("dc-evidence")).getByText((t) => flat(t) === "ڈیجیٹل کوچ کے شواہد")).toBeInTheDocument();
  });

  it("off the switch: no box (the form as today)", async () => {
    flow.on = false;
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    expect(screen.queryByTestId("dc-evidence")).toBeNull();
  });
});

/*
 * bd-o15qnr.40.5 (queue #229, the operator 23 Nov ~15:45: "'Rumi chose 4' on the 6-12 is not evident enough. It should
 * show that on the option itself rather than as text.") — on the switch, the FICO-S form marks the Digital Coach's level
 * ON its card, exactly as the grades 1-5 form does (RatingScale's Digital Coach row: purple edge and halo, "Digital Coach"
 * at its end, spoken with the card; the "You · Digital Coach" legend above), and the "chose N" line (the bot's `dc:
 * 'chose'`) is not shown; a "could not set a level" line (`dc: 'none'`) stays. Off the switch: the form as today.
 */
const CHOSE = "The Digital Coach chose 3 · Proficient from the recording, and wrote the evidence below. Change either if you saw something different.";
const NONE = "The Digital Coach could not set a level from the recording (Too noisy). Choose the level you saw.";
const FICOS_DC = () => ({
  ...FICOS(),
  sections: [
    { id: "FS_C1", parts: [
      { type: "heading", text: "C1 · Quality of questions" },
      { type: "sub", text: CHOSE, dc: "chose" },
      fitem("C1", "Section C · 1 of 8", FLEVELS, { dcLevel: "3" }),
      fev("ev_C1"),
      { type: "heading", text: "C2 · Responding to wrong answers" },
      { type: "sub", text: NONE, dc: "none" },
      fitem("C2", "Section C · 2 of 8", [...FLEVELS, F_NA_C2]),
      fev("ev_C2"),
      { type: "heading", text: "C3 · Checking for understanding" },
      { type: "sub", text: "The Digital Coach chose N/A from the recording.", dc: "chose" },
      fitem("C3", "Section C · 3 of 8", [...FLEVELS, { ...F_NA_C2, title: "N/A · No question asked" }], { dcLevel: "NA" }),
      fev("ev_C3"),
    ] },
  ],
  values: {},
});

describe("FICO-S v1.2: the Digital Coach's level on its card (bd-o15qnr.40.5)", () => {
  beforeEach(() => { L.getObservationDraft.mockResolvedValue(FICOS_DC()); });

  it("its level's card is marked Digital Coach (tag + spoken), the others are not; no 'chose' line", async () => {
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    const c1 = group("Section C · 1 of 8");
    const marked = c1.getAllByRole("radio").filter((r) => r.textContent?.includes("Digital Coach"));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute("data-radio-key", "3");
    expect(marked[0]).toHaveAccessibleName(/Digital Coach’s level$/);
    expect(marked[0].className).toMatch(/6e52e0/);
    expect(screen.queryByText(CHOSE)).toBeNull();
    expect(screen.queryByText(/chose/)).toBeNull();
  });

  it("N/A it set: the N/A card is the marked one", async () => {
    renderPage();
    await screen.findByText("C3 · Checking for understanding");
    const marked = group("Section C · 3 of 8").getAllByRole("radio").filter((r) => r.textContent?.includes("Digital Coach"));
    expect(marked.map((r) => r.getAttribute("data-radio-key"))).toEqual(["NA"]);
  });

  it("the legend You · Digital Coach over a card it marked; could not set a level: the line stays, no card marked", async () => {
    renderPage();
    await screen.findByText("C2 · Responding to wrong answers");
    expect(screen.getAllByTestId("legend").length).toBeGreaterThan(0);
    expect(screen.getByText(NONE)).toBeInTheDocument();
    expect(group("Section C · 2 of 8").getAllByRole("radio").filter((r) => r.textContent?.includes("Digital Coach"))).toHaveLength(0);
  });

  it("Urdu: the card says ڈیجیٹل کوچ", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    const tagged = group("Section C · 1 of 8").getAllByRole("radio").filter((r) => flat(r.textContent).includes("ڈیجیٹل کوچ"));
    expect(tagged).toHaveLength(1);
  });

  it("off the switch: the form as today (the line shown, no card marked)", async () => {
    flow.on = false;
    renderPage();
    await screen.findByText("C1 · Quality of questions");
    expect(screen.getByText(CHOSE)).toBeInTheDocument();
    expect(screen.queryAllByTestId("legend")).toHaveLength(0);
  });
});
