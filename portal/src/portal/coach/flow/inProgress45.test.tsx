import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.45 (queue #240), behind portal_coach_flow_v2 (fail-closed):
 *
 *   The operator 23 Nov ~19:40: "On the Observe page, we show booked for Today with an All booked button, Needs you and
 *   History. We also need to show the currently in process one as well. You can decide in which order."
 *     Observe       Needs you, In progress, Booked for today (+ All booked), History. In progress = started, not finished,
 *                   not waiting on her (sending from this phone, analysing, the report sending, waiting for the
 *                   teacher): one row each (the teacher, the date and class, the stage as a chip, the time it started),
 *                   each opening its visit; nothing in both lists; no section when there is nothing.
 *   ~23:20 / ~23:22 (My observations' cards, "Waiting for you"):
 *     a card's line is the date, the grade and the subject ("Mon 23 Nov · Grade 7 · English"), never the rubric
 *     no four-step bar on a card: the next step only ("Next: Take the debrief"), with the step chip
 *     the avatar's initials are letters only: "Imran Baig (Test)" is IB, never "I("
 *   ~20:20: "The X observations need you are on too many pages. They should be maximum at the home and main Observation
 *   page." — on the switch, no yellow bar on My observations (nor any other observe page).
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getSchedule: vi.fn(), getReports: vi.fn(), getPending: vi.fn(), getHome: vi.fn(() => Promise.resolve({ success: true })) },
  leader: { cancelSchedule: vi.fn() },
}));
vi.mock("./track", () => ({ trackFlow: vi.fn() }));
vi.mock("../ui", async (orig) => ({ ...(await orig<object>()), readPending: vi.fn(() => Promise.resolve({ waiting: 2, ids: ["w1", "w2"] })) }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", () => ({ useFlowV2: () => flow.on, useFlowV6: () => flow.on, useCoachFlowV2: () => flow.on, coachFlowV2On: () => flow.on === true }));
// The background send never finishes in these tests: the visit stays "Uploading" on Observe.
vi.mock("../../lib/coachObserve", async (orig) => ({ ...(await orig<object>()), sendObservation: vi.fn(() => new Promise(() => {})) }));

import { coach } from "../../services/api";
import { ObserveRoute } from "./routes";
import CoachReports from "../pages/CoachReports";
import { resetSender, startSend } from "../observe/sender";
import { initialsOf } from "../../teacher/ui/initials";
import { karachiDay } from "../time";
import { addDays } from "../../teacher/ui";

const C = coach as any;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/observe" element={<ObserveRoute />} />
        <Route path="/portal/coach/reports" element={<CoachReports />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Mon 23 Nov 2026, 8:13 PM in Pakistan
const AT = "2026-11-23T15:13:00Z";
const report = (id: string, name: string, step: string, stage: string, extra: Record<string, unknown> = {}) => ({
  id, createdAt: AT, teacherName: name, teacherPhone: null, teacherExtId: null, schoolName: "GB Test Middle (Rumi QA)", schoolExtId: null,
  status: "x", step, stage, score: null, portal: true, obs612: null, listening: false, grade: null, subject: null, ...extra,
});
const FICOS = { label: "FICO 6-12 v1.2", toolName: "FICO 6-12", result: "—" };
const today = karachiDay();
const SCHEDULE = {
  success: true, from: today, to: addDays(today, 90), overdue: [],
  visits: [{ id: "s1", teacherName: "Hina Rauf", schoolName: "IMCG F-7/2", scheduledFor: today, scheduledSlot: "09:00", status: "upcoming" }],
};
const REPORTS_ANSWER = {
  success: true,
  waiting: [
    report("w1", "Imran Baig (Test)", "talk", "talk", { grade: 7, subject: "english", obs612: FICOS }),
    report("w2", "Iqra Demo (test)", "draft", "draft", { grade: 3, subject: "maths" }),
  ],
  inProgress: [
    report("p1", "Rubina Kausar", "analysing", "analysing", { grade: 4, subject: "urdu" }),
    report("p2", "Samina Akhtar", "report", "sending", { grade: 6, subject: "islamiat" }),
    report("p3", "Farah Naz", "sent", "waiting_teacher"),
  ],
  all: { total: 9, page: 1, pageSize: 30, items: [] as unknown[] },
};
REPORTS_ANSWER.all.items = [...REPORTS_ANSWER.waiting, ...REPORTS_ANSWER.inProgress];

beforeEach(async () => {
  vi.clearAllMocks();
  resetSender();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  C.getSchedule.mockResolvedValue(SCHEDULE);
  C.getReports.mockResolvedValue(REPORTS_ANSWER);
  C.getPending.mockResolvedValue({ success: true, waiting: 2, ids: ["w1", "w2"] });
});

const order = (container: HTMLElement, ids: string[]) =>
  [...container.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")).filter((t) => ids.includes(t as string));

describe("Observe: Needs you, In progress, Booked for today, History", () => {
  it("the four in that order (Schedule an observation stays the first thing on the page)", async () => {
    const { container } = renderAt("/portal/coach/observe");
    await screen.findByTestId("in-progress");
    expect(order(container, ["needs-you", "in-progress", "booked-today", "observe-history"])).toEqual(["needs-you", "in-progress", "booked-today", "observe-history"]);
    const go = screen.getByRole("link", { name: /Schedule an observation/ });
    expect(go.compareDocumentPosition(screen.getByTestId("needs-you")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("In progress: one row each, the stage as a chip, the date and class on its line, the time it started; each opens its visit", async () => {
    renderAt("/portal/coach/observe");
    const box = await screen.findByTestId("in-progress");
    expect(within(box).getByTestId("section-count")).toHaveTextContent("3");
    const rows = within(box).getAllByRole("link");
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/observation/p1", "/portal/coach/observation/p2", "/portal/coach/observation/p3"]);
    expect(rows[0]).toHaveTextContent("Rubina Kausar");
    expect(rows[0]).toHaveTextContent("Analysing");
    expect(rows[0]).toHaveTextContent("Mon 23 Nov · Grade 4 · Urdu");
    expect(rows[0]).toHaveTextContent(/8:13/);
    expect(rows[1]).toHaveTextContent("Sending report");
    expect(rows[2]).toHaveTextContent("Waiting for teacher");
    // no class named: the date alone, never a dash
    expect(within(rows[2]).getByText("Mon 23 Nov")).toBeInTheDocument();
  });

  // The upload's word is the app's own (the strip's "Sending · 62%", the Sending page), never a second word for it.
  it("an observation still going up from this phone is In progress first, 'Sending · N%', and opens its Sending page", async () => {
    startSend({
      visitId: "v-up", teacherExtId: "t-up", schoolExtId: null, teacherName: "Sadia Noreen", visitDay: today, durationMs: 60_000,
      recordingId: null, audio: { blob: new Blob(["x"]), filename: "a.webm" }, plan: null, photos: [], lesson: { grade: 8, subject: "science" },
    });
    renderAt("/portal/coach/observe");
    const box = await screen.findByTestId("in-progress");
    const rows = within(box).getAllByRole("link");
    expect(rows[0]).toHaveTextContent("Sadia Noreen");
    expect(rows[0]).toHaveTextContent(/Sending · \d+%/);
    expect(rows[0]).toHaveTextContent("Grade 8 · Science");
    expect(rows[0]).toHaveAttribute("href", "/portal/coach/visit/v-up/sending");
    expect(within(box).getByTestId("section-count")).toHaveTextContent("4");
  });

  it("nothing in both lists: an observation in Needs you is never also In progress", async () => {
    C.getReports.mockResolvedValue({ ...REPORTS_ANSWER, inProgress: [...REPORTS_ANSWER.inProgress, REPORTS_ANSWER.waiting[0]] });
    renderAt("/portal/coach/observe");
    const box = await screen.findByTestId("in-progress");
    expect(within(box).queryByText("Imran Baig (Test)")).toBeNull();
    expect(within(screen.getByTestId("needs-you")).getByText("Imran Baig (Test)")).toBeInTheDocument();
  });

  it("nothing under way: no In progress section at all", async () => {
    C.getReports.mockResolvedValue({ ...REPORTS_ANSWER, inProgress: [] });
    renderAt("/portal/coach/observe");
    await screen.findByTestId("needs-you");
    await waitFor(() => expect(within(screen.getByTestId("needs-you")).getAllByRole("link").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("in-progress")).toBeNull();
  });

  it("Needs you rows say the class too, never the rubric", async () => {
    renderAt("/portal/coach/observe");
    const needs = await screen.findByTestId("needs-you");
    await waitFor(() => expect(needs).toHaveTextContent("Grade 7 · English"));
    expect(needs).not.toHaveTextContent("FICO");
  });

  it("in Urdu: the heading, the chips and the class", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderAt("/portal/coach/observe");
    const box = await screen.findByTestId("in-progress");
    expect(box).toHaveTextContent("جاری");
    expect(box).toHaveTextContent("تجزیہ جاری");
    // the kit isolates Latin digits in Urdu text (U+2066..U+2069); read past the marks
    expect((box.textContent || "").replace(/[\u2066-\u2069]/g, "")).toContain("پیر 23 نومبر · جماعت 4 · اردو");
    expect(box).toHaveTextContent("رپورٹ جا رہی ہے");
    expect(box).toHaveTextContent("استاد کا انتظار");
  });

  it("switch off: Observe is the old hub (no In progress section from this change)", async () => {
    flow.on = false;
    renderAt("/portal/coach/observe");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("in-progress")).toBeNull();
  });
});

describe("My observations' cards: date, grade, subject; the next step only; letters for initials", () => {
  it("a waiting card: 'Mon 23 Nov · Grade 7 · English', no rubric, no four-step bar, 'Next: Take the debrief' with its chip", async () => {
    renderAt("/portal/coach/reports");
    const waiting = await screen.findByTestId("reports-waiting");
    const card = within(waiting).getAllByTestId("report-card")[0];
    expect(card).toHaveTextContent("Mon 23 Nov · Grade 7 · English");
    expect(card).not.toHaveTextContent("FICO");
    expect(card).not.toHaveTextContent("GB Test Middle");
    expect(within(card).queryByTestId("status-line")).toBeNull();
    expect(within(card).queryByTestId("report-segments")).toBeNull();
    expect(card).toHaveTextContent("Next: Take the debrief");
    expect(card).toHaveTextContent("Debrief");
    expect(within(waiting).getAllByTestId("report-card")[1]).toHaveTextContent("Next: Fill the form");
  });

  it("the avatar: IB for 'Imran Baig (Test)', ID for 'Iqra Demo (test)'", async () => {
    renderAt("/portal/coach/reports");
    const waiting = await screen.findByTestId("reports-waiting");
    const [a, b] = within(waiting).getAllByTestId("report-card");
    expect(a).toHaveTextContent(/^\s*IB/);
    expect(b).toHaveTextContent(/^\s*ID/);
    expect(waiting).not.toHaveTextContent("I(");
  });

  it("an In progress card: its stage chip, no bar and no Next line (nothing is hers)", async () => {
    renderAt("/portal/coach/reports");
    const box = await screen.findByTestId("reports-in-progress");
    const cards = within(box).getAllByTestId("report-card");
    expect(cards).toHaveLength(3);
    expect(cards[1]).toHaveTextContent("Sending report");
    expect(box).not.toHaveTextContent("Next:");
    expect(within(box).queryByTestId("status-line")).toBeNull();
  });

  it("History (Recent) rows: the same line", async () => {
    renderAt("/portal/coach/reports");
    const recent = await screen.findByTestId("reports-recent");
    expect(recent).toHaveTextContent("Mon 23 Nov · Grade 7 · English");
    expect(recent).not.toHaveTextContent("FICO");
  });

  it("no yellow 'need you' bar on My observations", async () => {
    renderAt("/portal/coach/reports");
    await screen.findByTestId("reports-waiting");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("pending-banner")).toBeNull();
  });

  it("switch off: the cards as before (school and segments), the bar as before", async () => {
    flow.on = false;
    renderAt("/portal/coach/reports");
    const waiting = await screen.findByTestId("reports-waiting");
    expect(within(waiting).getAllByTestId("report-segments").length).toBe(2);
    expect(waiting).toHaveTextContent("GB Test Middle");
    expect(await screen.findByTestId("pending-banner")).toBeInTheDocument();
  });
});

describe("initialsOf: letters only", () => {
  it.each([
    ["Imran Baig (Test)", "IB"],
    ["Iqra Demo (test)", "ID"],
    ["Ayesha Bibi", "AB"],
    ["Rubina", "R"],
    ["Dr. Rifat Yasmeen", "DY"],
    ["  ", "·"],
    ["(Test)", "T"],
    ["عائشہ بی بی", "عب"],
  ])("%s → %s", (name, want) => {
    expect(initialsOf(name)).toBe(want);
  });
});
