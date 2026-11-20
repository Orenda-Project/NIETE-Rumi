import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-o15qnr.28 (queue #204, v7; the operator 20 Nov ~22:08: "just get it live asap") — #188's canvas page v7, LOCK round,
 * behind the v6/v7 switch (useFlowV6: a coach on portal_coach_flow_v2, or a principal on the principal app it names).
 *
 *   status line (option A)   words say whether a step happened: Analysed / Form filled / Debriefed / Sent (done),
 *                            Fill the form / Record the debrief / Send the report (current, half orange), Form to fill /
 *                            Debrief to do / Yet to send (later); "Now: <current>" replaces "Step n of 4"
 *   debrief due              3 school days after the visit (Sunday off): a Thursday visit is due by Monday
 *   the visit                the current step's card ON the visit: Your debrief (record / upload); the feedback card
 *                            (the report's own top card: %, stars, teacher) opening the ONE feedback page; Send the report
 *   the feedback page        coach "Your debrief report", principal "Your feedback": % of behaviours seen (3 of 8 = 38%)
 *                            with one 5-star row; Key Focus Area right under it; Your 8 behaviours with Respect held first
 *                            ("required"), seen first; well and missed 2 shown, then "Show N more"; the principal's
 *                            ending "The choice is yours."
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../training/appReady", async (orig) => ({ ...(await orig<Record<string, unknown>>()), coachFeatureReady: () => true }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hina", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, coach: { getObservation: vi.fn() }, leader: { getObservation: vi.fn() } }));
vi.mock("../report/api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getCoachReport: vi.fn(), markOpened: vi.fn(async () => {}) }));
const flow = vi.hoisted(() => ({ on: true as boolean | null }));
vi.mock("./useCoachFlowV2", async (orig) => ({ ...(await orig<object>()), useFlowV6: () => flow.on, useFlowV2: () => flow.on }));

import { coach, leader } from "../../services/api";
import { getCoachReport, type CoachReport } from "../report/api";
import CoachObservation from "../pages/CoachObservation";
import CoachReportPage from "../report/CoachReportPage";
import { PrincipalFeedbackPage } from "./FeedbackPage";
import { ObserveRoutesProvider } from "../observe/observeRoutes";
import { PRINCIPAL_OBSERVE_ROUTES } from "../../teacher/principal/observe";
import { StatusLine, stepWords } from "./StatusLine";
import { debriefDueDay } from "./debriefDue";
import { FLOW_V7 } from "./copyV7";

const C = coach as any;
const L = leader as any;
const R = getCoachReport as any;

const OBS = (extra: Record<string, unknown> = {}) => ({
  success: true, id: "cs-1", date: "2026-11-19T05:30:00Z", step: "talk", portal: true, mine: true, score: null, dcScore: 64,
  summary: null, teacher: { name: "Lubna Arif", teacherExtId: "923001110001", schoolName: "IMSG (I-V) G-7/3" },
  observer: { self: true, name: "Hina" }, sentAt: null, caption: null, imageUrl: null, audioUrl: null, ...extra,
});
const VIEW = (step: string, extra: Record<string, unknown> = {}) => ({
  id: "cs-1", createdAt: "2026-11-19T05:30:00Z", sessionStatus: "x", step, problem: null, preparing: false,
  teacher: { name: "Lubna Arif", phone: "923001110001" }, lesson: { topic: null, subject: null, hasLessonPlan: false }, draft: { edited: false },
  talk: { guide: { intro: "Start with a win.", steps: [] }, recordedAt: ["report", "sending", "sent", "done"].includes(step) ? "2026-11-19T09:00:00Z" : null,
    feedback: ["feedback", "report", "sending", "sent", "done"].includes(step) ? { harmful: false } : null },
  report: { status: null, teacherName: "Lubna Arif", teacherPhone: "923001110001", caption: null, companionText: null, imageUrl: null, sentAt: null, templateSentAt: null },
  ...extra,
});
const both = (en: string) => ({ en, ur: `${en}-ur` });
const REPORT: CoachReport = {
  id: "cs-1",
  header: { teacher: "Lubna Arif", grade: "3", subject: "Urdu", topic: null, at: "2026-11-19T05:30:00Z" },
  harmful: false, concern: null,
  marks: ["asked", "moves", "rehearsed", "praise", "moment", "one", "own", "less"].map((k, i) => ({ key: k, done: [1, 4, 0].includes(i) ? false : i < 3, name: both(k) }))
    .map((m, i) => ({ ...m, done: i === 0 || i === 2 || i === 7 })),
  done: 3, total: 8, respectHeld: true,
  did: [{ key: "asked", name: both("Asked & waited"), line: "You asked and waited." }, { key: "rehearsed", name: both("Rehearsed aloud"), line: "Roleplay." },
    { key: "less", name: both("Talked less"), line: "You let them talk." }],
  missed: ["praise", "moment", "one", "own", "moves"].map((k) => ({ key: k, name: both(k), line: `missed ${k}`, why: both(`why ${k}`) })),
  focus: { key: "own", move: "Ask the teacher to say their own next step, aloud.", why: "a step the teacher names is the one they try.", tryLine: { en: "Next time, what will you do?", ur: "اگلی بار؟" } },
};

beforeEach(async () => {
  vi.clearAllMocks();
  flow.on = true;
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  R.mockResolvedValue(REPORT);
});

/* ── the status line ───────────────────────────────────────────────────────────────────────────────────────────── */

describe("the status line, option A", () => {
  it("words say whether a step happened; the current one is half orange; Now: replaces Step n of 4", () => {
    render(<StatusLine at={2} />);
    const line = screen.getByTestId("status-line");
    expect(within(line).getAllByTestId("status-seg").map((s) => s.getAttribute("data-state"))).toEqual(["done", "done", "current", "later"]);
    expect(within(line).getAllByTestId("status-label").map((s) => s.textContent)).toEqual(["Analysed", "Form filled", "Record the debrief", "Yet to send"]);
    expect(line).toHaveTextContent("Now: Record the debrief");
    expect(line.textContent).not.toMatch(/Step \d of 4/);
  });

  it("each step's three words", () => {
    expect(stepWords(1, FLOW_V7.en)).toEqual({ done: "Form filled", current: "Fill the form", later: "Form to fill" });
    expect(stepWords(2, FLOW_V7.en)).toEqual({ done: "Debriefed", current: "Record the debrief", later: "Debrief to do" });
    expect(stepWords(3, FLOW_V7.en)).toEqual({ done: "Sent", current: "Send the report", later: "Yet to send" });
  });

  it("all done: Done", () => {
    render(<StatusLine at={4} />);
    expect(screen.getByTestId("status-line")).toHaveTextContent("Done");
    expect(screen.getAllByTestId("status-label").map((s) => s.textContent)).toEqual(["Analysed", "Form filled", "Debriefed", "Sent"]);
  });
});

describe("the debrief is due 3 school days after the visit (Sunday off)", () => {
  it.each([
    ["2026-11-19", "2026-11-23"], // Thu → Mon
    ["2026-11-20", "2026-11-24"], // Fri → Tue
    ["2026-11-21", "2026-11-25"], // Sat → Wed
    ["2026-11-23", "2026-11-26"], // Mon → Thu
  ])("%s → %s", (visit, due) => {
    expect(debriefDueDay(visit)).toBe(due);
  });
});

/* ── the one feedback page ─────────────────────────────────────────────────────────────────────────────────────── */

function renderReport(principal = false) {
  return render(
    <MemoryRouter initialEntries={["/x/cs-1"]}>
      <Routes>
        <Route path="/x/:id" element={principal
          ? <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}><PrincipalFeedbackPage /></ObserveRoutesProvider>
          : <CoachReportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the one feedback page (v7)", () => {
  it("the top card: 38% of behaviours seen, one 5-star row (2 lit), the teacher line; no 3/8", async () => {
    renderReport();
    const hero = await screen.findByTestId("report-hero");
    expect(within(hero).getByTestId("report-pct")).toHaveTextContent("38%");
    expect(hero).toHaveTextContent("behaviours seen");
    expect(hero.querySelectorAll("[data-star]").length).toBe(5);
    expect(hero.querySelectorAll('[data-star="on"]').length).toBe(2);
    expect(hero).toHaveTextContent("Lubna Arif");
    expect(hero.textContent).not.toContain("3/8");
  });

  it("Key Focus Area comes right under the top card", async () => {
    renderReport();
    const body = await screen.findByTestId("report-body");
    const order = Array.from(body.children).map((el) => el.getAttribute("data-testid"));
    expect(order.slice(0, 2)).toEqual(["report-hero", "report-focus"]);
    expect(screen.getByTestId("report-focus")).toHaveTextContent("Key Focus Area");
  });

  it("Respect held is its own green line above the 8 (not one of them); the 8 boxes, seen first; no 3 of 8 chip", async () => {
    renderReport();
    const marks = await screen.findByTestId("report-marks");
    const respect = screen.getByTestId("report-respect");
    expect(respect).toHaveTextContent("Respect held");
    expect(respect).toHaveTextContent("a must every time; not one of the 8");
    expect(marks.contains(respect)).toBe(false);
    expect(respect.compareDocumentPosition(marks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = within(marks).getAllByTestId("behaviour-row");
    expect(rows.length).toBe(8);
    expect(marks.textContent).not.toContain("Respect held");
    expect(rows.slice(0, 3).map((r) => r.getAttribute("data-seen"))).toEqual(["yes", "yes", "yes"]);
    expect(rows.slice(3).every((r) => r.getAttribute("data-seen") === "no")).toBe(true);
    expect(marks.textContent).not.toMatch(/3 of 8/);
  });

  it("Key Focus Area is option B: a tinted card with a purple start edge (not a band)", async () => {
    renderReport();
    const focus = await screen.findByTestId("report-focus");
    expect(focus.className).toContain("bg-[#f1edfd]");
    expect(focus.className).toContain("border-s-[6px]");
    expect(focus).toHaveTextContent("Key Focus Area");
  });

  it("well and missed: 2 shown, then Show N more", async () => {
    renderReport();
    const missed = await screen.findByTestId("report-missed");
    expect(within(missed).getAllByTestId("entry").length).toBe(2);
    fireEvent.click(within(missed).getByRole("button", { name: "Show 3 more" }));
    expect(within(missed).getAllByTestId("entry").length).toBe(5);
    const did = screen.getByTestId("report-did");
    expect(within(did).getAllByTestId("entry").length).toBe(2);
    expect(within(did).getByRole("button", { name: "Show 1 more" })).toBeInTheDocument();
  });

  it("the coach's ending stays; the principal's page is \"Your feedback\", same %, ending \"The choice is yours.\"", async () => {
    const coachView = renderReport();
    expect(await screen.findByText("The choice is yours — you are the coach.")).toBeInTheDocument();
    coachView.unmount();
    renderReport(true);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Your feedback");
    expect(await screen.findByTestId("report-pct")).toHaveTextContent("38%");
    expect(screen.getByText("The choice is yours.")).toBeInTheDocument();
    expect(screen.queryByText(/you are the coach/)).toBeNull();
  });

  it("switch off: the page as on production (3/8, the 8 boxes)", async () => {
    flow.on = false;
    renderReport();
    const hero = await screen.findByTestId("report-hero");
    expect(hero).toHaveTextContent("3/8");
    expect(screen.queryByTestId("report-pct")).toBeNull();
  });
});

/* ── the visit ─────────────────────────────────────────────────────────────────────────────────────────────────── */

function renderVisit(principal = false) {
  const page = <CoachObservation />;
  return render(
    <MemoryRouter initialEntries={["/o/cs-1"]}>
      <Routes>
        <Route path="/o/:id" element={principal ? <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}>{page}</ObserveRoutesProvider> : page} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the visit (v7): the line, the due day, the current step's card", () => {
  it("debrief: Now: Record the debrief, due by Mon 23 Nov, Your debrief with Start recording and Upload recording", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "talk" }));
    L.getObservation.mockResolvedValue(VIEW("talk"));
    renderVisit();
    const line = await screen.findByTestId("status-line");
    await waitFor(() => expect(line).toHaveTextContent("Now: Record the debrief"));
    expect(screen.getByTestId("debrief-due")).toHaveTextContent("Due by Mon 23 Nov");
    const card = screen.getByTestId("stage-debrief");
    expect(card).toHaveTextContent("Talk with the teacher, then record it here.");
    expect(within(card).getByRole("link", { name: /Start recording/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/debrief");
    expect(within(card).getByRole("link", { name: /Upload recording/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/debrief?upload=1");
  });

  it("send: the feedback card (38%) opens the one feedback page; Send Lubna the report", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "report" }));
    L.getObservation.mockResolvedValue(VIEW("report"));
    renderVisit();
    const fb = await screen.findByTestId("visit-feedback");
    await waitFor(() => expect(fb).toHaveTextContent("38%"));
    expect(fb.closest("a")).toHaveAttribute("href", "/portal/coach/report/cs-1");
    const send = screen.getByTestId("stage-send");
    expect(send).toHaveTextContent("Send Lubna the report");
    expect(send).toHaveTextContent("Lubna gets it on WhatsApp.");
    expect(within(send).getByRole("link", { name: /Send report/ })).toHaveAttribute("href", "/portal/coach/observation/cs-1/send");
  });

  it("a principal's visit: the same card opens the principal's feedback page", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "report" }));
    L.getObservation.mockResolvedValue(VIEW("report"));
    renderVisit(true);
    const fb = await screen.findByTestId("visit-feedback");
    expect(fb.closest("a")).toHaveAttribute("href", "/portal/teacher/principal/observation/cs-1/feedback");
  });

  it("switch off: the steps list as on production (Step n of 4)", async () => {
    flow.on = false;
    C.getObservation.mockResolvedValue(OBS({ step: "talk" }));
    L.getObservation.mockResolvedValue(VIEW("talk"));
    renderVisit();
    await screen.findByText(/Step 3 of 4/);
    expect(screen.queryByTestId("status-line")).toBeNull();
  });
});

describe("the visit while the Digital Coach works, and when it stopped (v7)", () => {
  it("analysing: Now: Analysing, and Rumi is listening, the page updates by itself", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "analysing" }));
    L.getObservation.mockResolvedValue(VIEW("analysing"));
    renderVisit();
    const card = await screen.findByTestId("stage-analysing");
    expect(card).toHaveTextContent("Rumi is listening to the lesson");
    expect(card).toHaveTextContent("Usually a few minutes. This page updates by itself; you can leave.");
    expect(screen.getByTestId("status-line")).toHaveTextContent("Now: Analysing");
  });

  it("stopped: one card with a red edge and the plain line; no steps", async () => {
    C.getObservation.mockResolvedValue(OBS({ step: "analysing" }));
    L.getObservation.mockResolvedValue(VIEW("stopped"));
    renderVisit();
    const card = await screen.findByTestId("stage-stopped");
    expect(card.className).toContain("border-[#c8331f]");
    expect(card).toHaveTextContent("Observation stopped");
    expect(screen.queryByTestId("stage-analysing")).toBeNull();
  });
});

describe("v7 words", () => {
  it("every word has Urdu; none says him or her", () => {
    for (const [k, en] of Object.entries(FLOW_V7.en)) {
      const ur = (FLOW_V7.ur as Record<string, unknown>)[k];
      expect(ur, k).toBeTruthy();
      const text = typeof en === "function" ? (en as (...a: unknown[]) => string)("Lubna", 3) : JSON.stringify(en);
      expect(text, k).not.toMatch(/\b(her|him|his|she|he)\b/i);
    }
  });
});
