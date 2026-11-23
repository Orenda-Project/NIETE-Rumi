import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.36 (queue #204; the operator 21 Nov ~14:20-14:30) — the FICO17 v6 Feedback Form on the switch, coach and
 * principal, English and Urdu:
 *
 *   the name     "Digital Coach" (Urdu ڈیجیٹل کوچ) everywhere on the form, never "NIETE Teaching Assistant"
 *   the legend   "You · Digital Coach" (Urdu آپ · ڈیجیٹل کوچ), the coach's and the principal's alike
 *   the six      (C3 C5 C7 D2 D3 D4) no legend; a short line on top, "The Digital Coach can't count this one. You
 *                decide."; the "From the recording" box: what to look for, any snippets found as evidence rows (time +
 *                quote), else "Nothing for this in the recording" in muted words (never "The recording showed nothing
 *                for this"); "You add: …" (no "Coach adds", no "sets the final level with a written justification");
 *                the note box kept, optional: a level alone is enough
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
import { FLOW_V7 } from "../flow/copyV7";

const L = leader as any;
const CO = coach as any;

const LEVELS4 = ["Not Observed", "Developing", "Proficient", "Highly Effective"];
const lv = (extra: { id: string; title: string }[] = []) => [
  ...LEVELS4.map((t, i) => ({ id: String(i + 1), title: t, description: `${t}: the rubric's words` })),
  ...extra.map((o) => ({ ...o, description: "" })),
];
const OLD_BODY = "Who answered.\n\nThe recording showed nothing for this.\n\nCoach adds: who spoke. The coach sets the final level with a written justification.";
const C3_LOOK = "Whether the teacher chose who answers, and whether quiet children were brought in.";
const C3_ADD = "choosing that cannot be heard (pointing, a nod), and whether children who had not put a hand up were brought in.";
const rec = (over: Record<string, unknown>) => ({ lookFor: C3_LOOK, state: "found", found: [], naText: null, turns: null, youAdd: C3_ADD, ...over });

const V6 = (extra: Record<string, unknown> = {}) => ({
  kind: "fico17_v6", saved: false, editable: true, minReason: 20, rubric: { id: "fico17_v6", label: "FICO17 v6" },
  scale: [], fidelityScale: [{ id: "executed", title: "✓ Executed" }],
  sections: [
    { key: "lesson_plan_fidelity", letter: "B", title: "Lesson plan", kind: "moves", header: "", fallback: "No lesson plan was provided.", moves: [] },
    { key: "v6_teacher", letter: "C", title: "What the teacher does", kind: "v6", changeReason: "",
      indicators: [
        { id: "C1", field: "C1", name: "Quality of Questions Asked by the Teacher", kind: "dc", options: lv(), rumi: "3", rating: "3",
          evidence: "Two open questions.", improvement: "", rumiEvidence: { because: "Two open questions.", items: [{ time: "04:30", quote: "Why seven?" }] } },
        { id: "C3", field: "C3", name: "Who got to answer", kind: "combined", options: lv([{ id: "NA", title: "N/A · No question asked" }]),
          body: OLD_BODY, rating: "", why: "",
          recording: rec({ found: [{ time: "05:00", quote: "Ali, what do you think?" }, { time: "09:12", quote: "Sana, you tell us." }] }) },
        { id: "C5", field: "C5", name: "Moving between activities", kind: "combined", options: lv(),
          body: OLD_BODY, rating: "", why: "", recording: rec({ lookFor: "How quickly the class settles.", state: "none" }) },
      ] },
    { key: "v6_children", letter: "D", title: "What the children do", kind: "v6", changeReason: "",
      indicators: [
        { id: "D2", field: "D2", name: "How many children spoke", kind: "combined", options: lv(), body: OLD_BODY, rating: "", why: "",
          recording: rec({ lookFor: "How much of the class spoke.", state: "d2", turns: { first: 4, second: 7 } }) },
        // an older bot: no `recording` → today's body, in the box
        { id: "D3", field: "D3", name: "Children talking together", kind: "combined", options: lv(), body: "Talk about the task.\n\n05:10  \"Tell your partner.\"", rating: "", why: "" },
      ] },
    { key: "v6_subject", letter: "F", title: "Subject knowledge", kind: "v6", changeReason: "",
      indicators: [
        { id: "F1", field: "F1", name: "Accuracy of content", kind: "dc", options: lv(), rumi: "3", rating: "3", evidence: "Correct facts.", improvement: "",
          rumiEvidence: { because: "Correct facts.", items: [] } },
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
const openSection = async (title: RegExp) => { fireEvent.click(await screen.findByRole("button", { name: title })); await screen.findByTestId("ff-section"); };
const openRow = (code: string) => fireEvent.click(within(screen.getByTestId("ff-section")).getByRole("button", { name: new RegExp(`^${code}\\b`) }));
const toIndicator = async (section: RegExp, code: string, principal = false) => {
  renderPage(principal);
  await openSection(section);
  openRow(code);
  return within(await screen.findByTestId("ff-indicator"));
};
const card = () => within(screen.getByTestId("ff-card"));
const group = (name: string) => within(screen.getByRole("radiogroup", { name }));
const flat = (t: string | null | undefined) => (t || "").replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();

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

describe("the name and the legend", () => {
  it("one of the Digital Coach's: the legend reads You · Digital Coach; its level ringed as the Digital Coach's", async () => {
    await toIndicator(/C\. What the teacher does/, "C1");
    expect(flat(screen.getByTestId("legend").textContent)).toBe("You · Digital Coach");
    const dc = group("Quality of Questions Asked by the Teacher").getByRole("radio", { name: "Proficient, Digital Coach’s level" });
    expect(within(dc).getByText("Digital Coach")).toBeInTheDocument();
    expect(within(screen.getByTestId("ff-evidence")).getByText("Digital Coach heard")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Teaching Assistant|Rumi/);
  });

  it("the principal: the same legend, You · Digital Coach", async () => {
    await toIndicator(/C\. What the teacher does/, "C1", true);
    expect(flat(screen.getByTestId("legend").textContent)).toBe("You · Digital Coach");
  });

  it("Urdu: آپ · ڈیجیٹل کوچ, and ڈیجیٹل کوچ نے یہ سنا; never ٹیچنگ اسسٹنٹ", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    await toIndicator(/C\. What the teacher does/, "C1");
    expect(flat(screen.getByTestId("legend").textContent)).toBe("آپ · ڈیجیٹل کوچ");
    expect(screen.getByText((t) => flat(t) === "ڈیجیٹل کوچ نے یہ سنا")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ٹیچنگ اسسٹنٹ|Teaching Assistant/);
  });

  it("while the lesson is analysed: the Digital Coach is listening (EN + UR)", () => {
    expect(FLOW_V7.en.listening).toBe("Digital Coach is listening to the lesson");
    expect(flat(FLOW_V7.ur.listening)).toBe("ڈیجیٹل کوچ سبق سن رہا ہے");
  });
});

describe("one of the six: the Digital Coach can't count it", () => {
  it("no legend; the line on top; what to look for; each snippet found as an evidence row; You add", async () => {
    await toIndicator(/C\. What the teacher does/, "C3");
    expect(screen.queryByTestId("legend")).toBeNull();
    const top = card().getByTestId("cant-count");
    expect(top).toHaveTextContent("The Digital Coach can't count this one. You decide.");
    const box = within(card().getByTestId("from-recording"));
    expect(box.getByText("From the recording")).toBeInTheDocument();
    expect(box.getByText(C3_LOOK)).toBeInTheDocument();
    const rows = box.getAllByTestId("rec-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("ff-time")).toHaveTextContent("05:00");
    expect(rows[0]).toHaveTextContent("Ali, what do you think?");
    expect(within(rows[1]).getByTestId("ff-time")).toHaveTextContent("09:12");
    expect(box.getByText(`You add: ${C3_ADD}`)).toBeInTheDocument();
    expect(box.queryByTestId("rec-nothing")).toBeNull();
    const text = screen.getByTestId("ff-card").textContent || "";
    expect(text).not.toMatch(/Coach adds|written justification|showed nothing/);
    // the top line comes before the box
    expect(top.compareDocumentPosition(card().getByTestId("from-recording")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("nothing found: 'Nothing for this in the recording', muted; never the bare 'showed nothing' line", async () => {
    await toIndicator(/C\. What the teacher does/, "C5");
    const none = card().getByTestId("rec-nothing");
    expect(none).toHaveTextContent("Nothing for this in the recording");
    expect(none.className).toMatch(/text-\[#6b7280\]/);
    expect(card().queryAllByTestId("rec-row")).toHaveLength(0);
    expect(screen.getByTestId("ff-card").textContent).not.toMatch(/showed nothing/);
  });

  it("D2: the two counts, in words", async () => {
    await toIndicator(/D\. What the children do/, "D2");
    expect(card().getByTestId("from-recording")).toHaveTextContent("4 student turns in the first half and 7 in the second");
    expect(card().getByTestId("cant-count")).toBeInTheDocument();
  });

  it("an older bot (no parts): today's text in the box; still no legend, still the line on top", async () => {
    await toIndicator(/D\. What the children do/, "D3");
    expect(screen.queryByTestId("legend")).toBeNull();
    expect(card().getByTestId("cant-count")).toBeInTheDocument();
    expect(card().getByTestId("from-recording")).toHaveTextContent("Tell your partner.");
  });

  it("the note box is kept and optional: a level alone is enough", async () => {
    await toIndicator(/C\. What the teacher does/, "C3");
    const note = card().getByLabelText("Your note (optional)");
    expect(note).toHaveValue("");
    fireEvent.click(group("Who got to answer").getByRole("radio", { name: "Developing" }));
    fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
    expect(await screen.findByText("Lubna Arif · C · 3 of 3")).toBeInTheDocument();
    expect(screen.queryByTestId("ff-toast")).toBeNull();
    expect(screen.queryByText(/At least 20 letters/)).toBeNull();
  });

  it("still needs a level: '1 item still needs an answer' and the level is focused", async () => {
    await toIndicator(/C\. What the teacher does/, "C3");
    fireEvent.click(dock().getByRole("button", { name: "Agree and next" }));
    await waitFor(() => expect(screen.getByTestId("ff-toast")).toHaveTextContent(/1 item still needs/));
    expect(group("Who got to answer").getAllByRole("radio")).toContain(document.activeElement);
  });

  it("the principal: the same box, You add", async () => {
    await toIndicator(/C\. What the teacher does/, "C3", true);
    expect(card().getByTestId("cant-count")).toHaveTextContent("The Digital Coach can't count this one. You decide.");
    expect(within(card().getByTestId("from-recording")).getByText(`You add: ${C3_ADD}`)).toBeInTheDocument();
    expect(screen.queryByTestId("legend")).toBeNull();
  });

  it("Urdu: the line on top, the muted nothing, You add and the optional note in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    await toIndicator(/C\. What the teacher does/, "C5");
    expect(flat(card().getByTestId("cant-count").textContent)).toBe("ڈیجیٹل کوچ اسے نہیں گن سکتا۔ آپ طے کریں۔");
    expect(flat(card().getByTestId("rec-nothing").textContent)).toBe("ریکارڈنگ میں اس کے لیے کچھ نہیں");
    expect(card().getByText(`آپ شامل کریں: ${C3_ADD}`)).toBeInTheDocument();
    expect(card().getByLabelText("آپ کا نوٹ (اختیاری)")).toBeInTheDocument();
    expect(card().getByText("ریکارڈنگ سے")).toBeInTheDocument();
  });
});
