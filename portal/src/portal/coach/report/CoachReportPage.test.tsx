import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: unknown }) => <>{children as never}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Test", role: "coach" }, loading: false }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
const getCoachReport = vi.fn();
const markOpened = vi.fn(async () => undefined);
const markSeen = vi.fn(async () => undefined);
const getReadyReports = vi.fn();
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), getCoachReport: (id: string) => getCoachReport(id), markOpened: (id: string) => markOpened(id), markSeen: (id: string) => markSeen(id), getReadyReports: () => getReadyReports() }));
const getConfig = vi.fn();
vi.mock("../../services/api", async (orig) => {
  const real = await orig<typeof import("../../services/api")>();
  return { ...real, portal: { ...real.portal, getConfig: () => getConfig() }, language: { get: async () => ({ language: "en", locked: false }), set: async () => ({}) } };
});

import CoachReportPage from "./CoachReportPage";
import { ReadyReportCard } from "./ReadyReportCard";
import { COPY_ENTRY } from "./copy";
import { COPY_MODULES } from "../../teacher/copyRegistry";
import { coachPathReady } from "../training/appReady";
import type { CoachReport } from "./api";

/**
 * Coach reports in the app — the coach's debrief report page and the card on her Home, in the NIETE app's look with the
 * ICT HITL owner's content and order. Pinned here:
 *   - the order: header (count, drawn stars, teacher · class · lesson) → Respect → the 8 boxes → did well → missed →
 *     next focus (why this one, the ready Try line, then the module) → her closing line;
 *   - said once: no reflection question, no praise banner; a box tap goes to its entry and marks it;
 *   - the Try line is the supplied one, or a marked placeholder, never made up;
 *   - Urdu: the same page from the same payload (no second read);
 *   - opening stamps "opened" once; the Home card's ✕ stamps "seen";
 *   - the guard lets every coach reach the page; the server's switch decides.
 */
const ID = "33333333-3333-4333-8333-333333333333";
const both = (en: string, ur: string) => ({ en, ur });
const REPORT: CoachReport = {
  id: ID,
  header: { teacher: "Ms. Sadia", grade: "5", subject: "Islamiyat", topic: "Journey to Taif", at: new Date().toISOString() },
  harmful: false,
  concern: null,
  marks: [
    { key: "opened_with_specific_praise", done: true, name: both("Specific praise", "مخصوص تعریف") },
    { key: "anchored_in_real_moment", done: true, name: both("Real moment", "سبق کے لمحے کا حوالہ") },
    { key: "asked_and_waited", done: false, name: both("Asked & waited", "سوال کے بعد انتظار") },
    { key: "one_improvement_only", done: false, name: both("One improvement", "صرف ایک بہتری") },
    { key: "moves_not_teacher", done: true, name: both("Moves, not person", "تدریس پر بات") },
    { key: "elicited_if_then", done: false, name: both("Teacher’s own step", "استاد کا اپنا اگلا قدم") },
    { key: "righting_reflex_held", done: false, name: both("Talked less", "استاد کو بولنے کا موقع") },
    { key: "rehearsed_the_step", done: false, name: both("Rehearsed aloud", "زبانی مشق") },
  ],
  done: 3,
  total: 8,
  respectHeld: true,
  did: [
    { key: "opened_with_specific_praise", name: both("Specific praise", "مخصوص تعریف"), line: "You said the story was told very well." },
    { key: "anchored_in_real_moment", name: both("Real moment", "سبق کے لمحے کا حوالہ"), line: "You named the moment a student answered." },
    { key: "moves_not_teacher", name: both("Moves, not person", "تدریس پر بات"), line: null },
  ],
  missed: [
    { key: "asked_and_waited", name: both("Asked & waited", "سوال کے بعد انتظار"), line: "You answered it yourself.", why: both("Waiting gives time.", "انتظار سے وقت ملتا ہے۔"), module: 3 },
    { key: "elicited_if_then", name: both("Teacher’s own step", "استاد کا اپنا اگلا قدم"), line: "You gave the step yourself.", why: both("Own words stick.", "اپنے الفاظ"), module: 6 },
  ],
  focus: { key: "elicited_if_then", move: "Let the teacher name the next step", why: "It was missed most often.", module: 6,
    tryLine: { en: "“Next time, what will you do differently? Tell me in your own words.”", ur: "\"اگلی بار آپ کیا مختلف کریں گی؟ اپنے الفاظ میں بتائیں۔\"" } },
};

function renderPage(path = `/portal/coach/report/${ID}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/portal/coach/report/:id" element={<CoachReportPage />} />
        <Route path="/portal/coach" element={<ReadyReportCard />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} }); });
beforeEach(async () => {
  await act(async () => { await i18n.changeLanguage("en"); });
  getCoachReport.mockReset(); markOpened.mockClear(); markSeen.mockClear(); getReadyReports.mockReset(); getConfig.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

describe("the debrief report page", () => {
  it("draws the frame and grey outlines first, then the whole report in its order, and stamps opened once", async () => {
    let answer: (r: CoachReport) => void = () => undefined;
    getCoachReport.mockReturnValue(new Promise<CoachReport>((r) => { answer = r; }));
    renderPage();
    expect(screen.getByTestId("report-outline")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your debrief report");
    await act(async () => { answer(REPORT); });
    expect(screen.queryByTestId("report-outline")).toBeNull();
    const body = screen.getByTestId("report-body");
    const order = Array.from(body.querySelectorAll("[data-testid]")).map((e) => e.getAttribute("data-testid"))
      .filter((t) => ["report-hero", "report-respect", "report-marks", "report-did", "report-missed", "report-focus"].includes(String(t)));
    expect(order).toEqual(["report-hero", "report-respect", "report-marks", "report-did", "report-missed", "report-focus"]);
    expect(within(screen.getByTestId("report-hero")).getByTestId("report-score").textContent).toContain("3/8");
    expect(screen.getByTestId("report-hero").textContent).toContain("Ms. Sadia");
    expect(screen.getByTestId("report-hero").textContent).toContain("Grade 5 Islamiyat");
    expect(markOpened).toHaveBeenCalledTimes(1);
    expect(markOpened).toHaveBeenCalledWith(ID);
  });

  it("says each thing once: no reflection question and no praise banner", async () => {
    getCoachReport.mockResolvedValue(REPORT);
    renderPage();
    await screen.findByTestId("report-body");
    const text = document.body.textContent || "";
    expect(text).not.toMatch(/Ask yourself/i);
    expect(text.split("You said the story was told very well.").length - 1).toBe(1);
  });

  it("boxes: done ones with the green edge, missed ones dashed; a tap takes her to that entry and marks it", async () => {
    getCoachReport.mockResolvedValue(REPORT);
    renderPage();
    await screen.findByTestId("report-body");
    const boxes = within(screen.getByTestId("report-marks")).getAllByRole("button");
    expect(boxes).toHaveLength(8);
    expect(boxes.filter((b) => b.getAttribute("data-mark") === "done")).toHaveLength(3);
    fireEvent.click(boxes[5]); // Teacher's own step
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const entry = document.getElementById("report-entry-elicited_if_then");
    expect(entry?.hasAttribute("data-marked")).toBe(true);
    expect(entry?.textContent).toContain("You gave the step yourself.");
  });

  it("the next focus: the move, why this one, the supplied Try line, THEN its module", async () => {
    getCoachReport.mockResolvedValue(REPORT);
    renderPage();
    const focus = await screen.findByTestId("report-focus");
    expect(focus.textContent).toContain("Next focus — just one thing");
    expect(focus.textContent).toContain("Why this one:");
    const tryLine = within(focus).getByTestId("report-try");
    expect(tryLine.textContent).toBe("Try: “Next time, what will you do differently? Tell me in your own words.”");
    const moduleRow = within(focus).getByTestId("report-module");
    expect(tryLine.compareDocumentPosition(moduleRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(moduleRow.textContent).toContain("The teacher’s own next step");
  });

  it("a focus whose line is not supplied yet: a marked placeholder, never a made-up line", async () => {
    getCoachReport.mockResolvedValue({ ...REPORT, focus: { ...REPORT.focus!, key: "asked_and_waited", module: 3, tryLine: null } });
    renderPage();
    const focus = await screen.findByTestId("report-focus");
    expect(within(focus).queryByTestId("report-try")).toBeNull();
    expect(within(focus).getByTestId("report-try-pending").textContent).toBe("Try: Ready line to come");
  });

  it("Urdu: the same payload, Urdu words and Urdu names, no second read", async () => {
    getCoachReport.mockResolvedValue(REPORT);
    renderPage();
    await screen.findByTestId("report-body");
    await act(async () => { await i18n.changeLanguage("ur"); });
    expect(getCoachReport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("آپ کی ڈی بریف رپورٹ");
    expect(screen.getByTestId("report-marks").textContent).toContain("مخصوص تعریف");
    expect(screen.getByTestId("report-try").textContent).toContain("آزمائیں:");
    expect(screen.getByTestId("report-try").textContent).toContain("اپنے الفاظ میں بتائیں");
  });

  it("another coach's report (403/404) says not available; a report not coached yet says not ready", async () => {
    getCoachReport.mockRejectedValue({ response: { status: 403 } });
    const { unmount } = renderPage();
    expect(await screen.findByTestId("report-problem-not_yours")).toBeTruthy();
    expect(markOpened).not.toHaveBeenCalled();
    unmount();
    getCoachReport.mockRejectedValue({ response: { status: 409 } });
    renderPage();
    expect(await screen.findByTestId("report-problem-not_ready")).toBeTruthy();
  });

  it("is reachable through the coach app's guard for every coach (the server's switch decides)", () => {
    expect(coachPathReady(`/portal/coach/report/${ID}`)).toBe(true);
    expect(coachPathReady("/portal/coach/week/2026-11-02")).toBe(true);
  });

  it("its words are registered for the Urdu completeness checks", () => {
    expect(COPY_MODULES).toContain(COPY_ENTRY);
  });
});

describe("the card on her Home", () => {
  it("switch on and a report ready: the card, teacher · class · time, Open goes to the report", async () => {
    getConfig.mockResolvedValue({ success: true, features: { coachReportsApp: true } });
    getReadyReports.mockResolvedValue([{ kind: "debrief", id: ID, at: "2026-11-05T06:42:00Z", teacher: "Ms. Sadia", subject: "Islamiyat", grade: "5" }]);
    getCoachReport.mockResolvedValue(REPORT);
    renderPage("/portal/coach");
    const card = await screen.findByTestId("coach-report-card");
    expect(card.textContent).toContain("Ready for you");
    expect(card.textContent).toContain("Your debrief report");
    expect(card.textContent).toContain("Ms. Sadia · Grade 5 Islamiyat");
    expect(card.textContent).not.toMatch(/\d\/8/);
    fireEvent.click(within(card).getByRole("button", { name: "Open my report" }));
    expect(await screen.findByTestId("report-body")).toBeTruthy();
  });

  it("✕ closes it and counts as seen (no WhatsApp follows)", async () => {
    getConfig.mockResolvedValue({ success: true, features: { coachReportsApp: true } });
    getReadyReports.mockResolvedValue([{ kind: "debrief", id: ID, at: null, teacher: "Ms. Sadia", subject: null, grade: null }]);
    renderPage("/portal/coach");
    fireEvent.click(await screen.findByTestId("coach-report-card-close"));
    expect(screen.queryByTestId("coach-report-card")).toBeNull();
    expect(markSeen).toHaveBeenCalledWith(ID);
  });

  it("two waiting reports share one card", async () => {
    getConfig.mockResolvedValue({ success: true, features: { coachReportsApp: true } });
    getReadyReports.mockResolvedValue([
      { kind: "debrief", id: ID, at: null, teacher: "Ms. Sadia", subject: null, grade: null },
      { kind: "debrief", id: "44444444-4444-4444-8444-444444444444", at: null, teacher: "Ms. Rubina", subject: null, grade: null },
    ]);
    renderPage("/portal/coach");
    const card = await screen.findByTestId("coach-report-card");
    expect(within(card).getAllByTestId("coach-report-card-row")).toHaveLength(2);
  });

  it("switch off (or unread): nothing drawn and nothing asked", async () => {
    getConfig.mockResolvedValue({ success: true, features: { coachReportsApp: false } });
    renderPage("/portal/coach");
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("coach-report-card")).toBeNull();
    expect(getReadyReports).not.toHaveBeenCalled();
  });
});
