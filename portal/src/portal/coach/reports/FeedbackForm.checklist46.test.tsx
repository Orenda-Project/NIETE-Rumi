import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.46 (queue #241; the operator 23 Nov ~20:25 on the 6-12 Feedback Form's Checklist: "weird UI. Should be 2
 * lines, or combined together with Heading Classroom practice then its questions then next section etc.") — each item
 * showed its category as a chip ("1. Classroom environment") squeezed beside the question.
 *
 * On the v6/v7 switch the Checklist is drawn as one heading per category (the bot's `group`), then that category's
 * questions, each numbered (the bot's `n`) on its own full-width line, its Yes / No under it as before; then the next
 * category. No per-item chip. English and Urdu (the category and the question in the observer's language, Urdu digits).
 * An older bot (no `group`): today's look.
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

vi.setConfig({ testTimeout: 30_000 });
const L = leader as any;
const CO = coach as any;

const LV = ["Below standard", "Developing", "Proficient", "Exemplary"].map((l, i) => ({ id: String(i + 1), title: `${i + 1} · ${l}`, description: `What level ${i + 1} looks like` }));
const YN = { en: [{ id: "yes", title: "Yes" }, { id: "no", title: "No" }], ur: [{ id: "yes", title: "ہاں" }, { id: "no", title: "نہیں" }] };
type Lang = "en" | "ur";
const UR_DIGITS = (n: number) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** The checklist as the bot sends it (fico-s-flow.js portalSections): `short` "1. Classroom environment", plus group and n. */
const CHECKS: Record<Lang, { key: string; group: string; text: string }[]> = {
  en: [
    { key: "cl_1", group: "Classroom environment", text: "Classroom is well lit and airy" },
    { key: "cl_2", group: "Classroom environment", text: "Student strength is appropriate for room size" },
    { key: "cl_6", group: "Teacher presence", text: "Teacher arrived on time" },
    { key: "cl_10", group: "Records", text: "Attendance register is up to date" },
    { key: "cl_11", group: "Records", text: "Lesson diary is maintained" },
  ],
  ur: [
    { key: "cl_1", group: "کلاس روم کا ماحول", text: "کلاس روم روشن اور ہوادار ہے" },
    { key: "cl_2", group: "کلاس روم کا ماحول", text: "طلبہ کی تعداد کمرے کے حساب سے مناسب ہے" },
    { key: "cl_6", group: "استاد کی موجودگی", text: "استاد وقت پر پہنچے" },
    { key: "cl_10", group: "ریکارڈ", text: "حاضری رجسٹر مکمل ہے" },
    { key: "cl_11", group: "ریکارڈ", text: "سبق کی ڈائری رکھی جاتی ہے" },
  ],
};
const check = (lang: Lang, withGroup: boolean) => (c: { key: string; group: string; text: string }, i: number) => ({
  type: "field", name: c.key, role: "item", input: "radio", kind: "yes_no", short: `${lang === "ur" ? UR_DIGITS(i + 1) : i + 1}. ${c.group}`,
  text: c.text, options: YN[lang], required: true, max: null,
  ...(withGroup ? { group: c.group, n: i + 1 } : { n: null }),
});

const DRAFT = ({ lang = "en", withGroup = true, ...over }: { lang?: Lang; withGroup?: boolean } & Record<string, unknown> = {}) => ({
  status: "ok", kind: "obs612", label: "FICO 6-12 v1.2", rubricId: "fico_s_v1_2", tool: "ficos", toolName: "FICO 6-12",
  toolTitle: "FICO 6-12 v1.2", sheet: null, grade: 7, subject: "maths",
  sections: [
    { id: "FS_START", kind: "start", parts: [{ type: "heading", text: "FICO 6-12 · Classroom observation" }] },
    { id: "FS_INTRO_A", kind: "intro", sec: "A", title: "Lesson planning", parts: [{ type: "heading", text: "Section A · Lesson planning" }] },
    { id: "FS_A_ONE", kind: "indicator", sec: "A", code: "A1", name: "Lesson objective", starred: false, parts: [
      { type: "heading", text: "A1 · Lesson objective" },
      { type: "field", name: "A1", role: "item", input: "radio", kind: "level", n: null, short: "A · 1 of 1", text: "Look for A1", options: LV, required: true, max: null, about: "What A1 looks at." },
    ] },
    { id: "FS_CHECKLIST", kind: "checklist", parts: [
      { type: "heading", text: lang === "ur" ? "چیک لسٹ (اسکور نہیں ہوتی)" : "Checklist (not scored)" },
      { type: "sub", text: lang === "ur" ? "ہر ایک کے لیے ہاں یا نہیں چنیں۔" : "Choose Yes or No for every one." },
      ...CHECKS[lang].map(check(lang, withGroup)),
    ] },
    { id: "FS_FEEDBACK", kind: "feedback", parts: [{ type: "heading", text: "Feedback for the teacher" },
      { type: "field", name: "fb_strengths", role: "other", input: "textarea", kind: null, n: null, short: null, text: "Strengths", options: null, required: true, max: 600 }] },
  ],
  values: {}, errors: {}, missing: [], editable: true, sealed: false, submittedAt: null,
  ...over,
});
const VIEW = { id: "cs-1", teacher: { name: "Lubna Arif", phone: "923001110001" }, report: { teacherName: "Lubna Arif" }, step: "draft", problem: null, preparing: false, talk: { guide: null, feedback: null, recordedAt: null } };

const openChecklist = async (name: RegExp) => {
  render(
    <ObserveRoutesProvider value={COACH_OBSERVE_ROUTES}>
      <MemoryRouter initialEntries={["/portal/coach/observation/cs-1/form"]}>
        <Routes>
          <Route path="/portal/coach/observation/:id/form" element={<FeedbackForm />} />
          <Route path="/portal/coach/observation/:id" element={<div>observation page</div>} />
        </Routes>
      </MemoryRouter>
    </ObserveRoutesProvider>,
  );
  const list = await screen.findByTestId("ff-sections", undefined, { timeout: 8000 });
  fireEvent.click(within(list).getByRole("button", { name }));
  return screen.findByTestId("ff-section");
};
/** The checklist's headings and questions in page order: "G:<heading>" / "Q:<number>|<question>". */
const order = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[data-testid="cl-group"], [data-testid="cl-question"]'))
  .map((el) => (el.dataset.testid === "cl-group" ? `G:${el.textContent}` : `Q:${el.querySelector('[data-testid="cl-no"]')?.textContent}|${el.querySelector('[data-testid="cl-text"]')?.textContent}`));

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  L.getObservationDraft.mockResolvedValue(DRAFT());
  L.getObservation.mockResolvedValue(VIEW);
  CO.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
  CO.getObservation.mockResolvedValue({ audioUrl: null });
  L.saveObs612Form.mockImplementation(async (_id: string, values: Record<string, string>) => ({ ...DRAFT(), values }));
});

describe("6-12 Checklist: a heading per category, then its numbered questions (q#241)", () => {
  it("one heading per category, its questions under it, numbered, then the next category", async () => {
    const sec = await openChecklist(/^Checklist/);
    expect(order(sec)).toEqual([
      "G:Classroom environment", "Q:1.|Classroom is well lit and airy", "Q:2.|Student strength is appropriate for room size",
      "G:Teacher presence", "Q:3.|Teacher arrived on time",
      "G:Records", "Q:4.|Attendance register is up to date", "Q:5.|Lesson diary is maintained",
    ]);
    // Each category is a heading of its own (said once), not a chip on every item.
    expect(within(sec).getAllByRole("heading", { name: "Classroom environment" })).toHaveLength(1);
  });

  it("no per-item category chip", async () => {
    const sec = await openChecklist(/^Checklist/);
    expect(within(sec).queryByText("1. Classroom environment")).toBeNull();
    expect(within(sec).queryByText("2. Classroom environment")).toBeNull();
    expect(within(sec).queryByText(/^\d+\. (Classroom environment|Teacher presence|Records)$/)).toBeNull();
  });

  it("each question is its own full-width line on its card, with Yes / No under it as before", async () => {
    const sec = await openChecklist(/^Checklist/);
    const cards = within(sec).getAllByTestId("fde-item");
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      const q = within(card).getByTestId("cl-question");
      // the question is the card's own line, not a row shared with a chip
      expect(q.parentElement).toBe(card);
      const radios = within(card).getAllByRole("radio");
      expect(radios.map((r) => r.closest("label")?.textContent || r.getAttribute("aria-label") || r.textContent)).toEqual([expect.stringMatching(/Yes/), expect.stringMatching(/No/)]);
      // the question comes before its answers
      expect(q.compareDocumentPosition(radios[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("Yes / No still answer the item", async () => {
    const sec = await openChecklist(/^Checklist/);
    const card = within(sec).getAllByTestId("fde-item")[0];
    const yes = within(card).getByRole("radio", { name: /Yes/ });
    fireEvent.click(yes);
    expect(within(card).getByRole("radio", { name: /Yes/ })).toBeChecked();
    expect(within(card).getByRole("radio", { name: /No/ })).not.toBeChecked();
  });

  it("Urdu: the categories and questions in Urdu, numbered in Urdu digits", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    L.getObservationDraft.mockResolvedValue(DRAFT({ lang: "ur" }));
    const sec = await openChecklist(/^چیک لسٹ/);
    expect(order(sec)).toEqual([
      "G:کلاس روم کا ماحول", "Q:۱.|کلاس روم روشن اور ہوادار ہے", "Q:۲.|طلبہ کی تعداد کمرے کے حساب سے مناسب ہے",
      "G:استاد کی موجودگی", "Q:۳.|استاد وقت پر پہنچے",
      "G:ریکارڈ", "Q:۴.|حاضری رجسٹر مکمل ہے", "Q:۵.|سبق کی ڈائری رکھی جاتی ہے",
    ]);
    expect(within(sec).queryByText("۱. کلاس روم کا ماحول")).toBeNull();
    for (const g of within(sec).getAllByTestId("cl-group")) expect(g).toHaveAttribute("lang", "ur");
  });

  it("submitted (read only): the same headings and numbered questions, each answer under its question", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT({ sealed: true, editable: false, values: { cl_1: "yes", cl_2: "no", cl_6: "yes", cl_10: "yes", cl_11: "no" } }));
    const sec = await openChecklist(/^Checklist/);
    expect(order(sec)[0]).toBe("G:Classroom environment");
    expect(within(sec).getAllByTestId("cl-group")).toHaveLength(3);
    expect(within(sec).queryByText("1. Classroom environment")).toBeNull();
    const first = within(sec).getAllByTestId("fde-item")[0];
    expect(within(first).getByText("Yes")).toBeInTheDocument();
  });

  it("an older bot (no group on the items): today's look, the chip beside the question", async () => {
    L.getObservationDraft.mockResolvedValue(DRAFT({ withGroup: false }));
    const sec = await openChecklist(/^Checklist/);
    expect(within(sec).queryAllByTestId("cl-group")).toHaveLength(0);
    expect(within(sec).getByText("1. Classroom environment")).toBeInTheDocument();
  });
});
