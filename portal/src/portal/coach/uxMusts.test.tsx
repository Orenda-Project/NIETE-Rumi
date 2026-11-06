import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import i18n from "i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("./CoachGate", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Rifat", role: "coach", phoneNumber: "923001234567" }, loading: false }) }));
vi.mock("../services/api", () => ({
  coach: { getVisit: vi.fn(), getHome: vi.fn() },
  leader: { cancelSchedule: vi.fn(), getObserveRecentPlans: vi.fn() },
  portal: {},
}));
vi.mock("../lib/coachObserve", async (orig) => ({ ...(await orig<typeof import("../lib/coachObserve")>()), sendObservation: vi.fn() }));
vi.mock("../lib/recordingStore", () => ({ deleteRecording: vi.fn(async () => {}), latestUnsent: vi.fn(async () => null) }));

import { coach, leader } from "../services/api";
import { sendObservation } from "../lib/coachObserve";
import { OBSERVE_COPY, OBSERVE_COPY_UR } from "./observe/copy";
import { SCHEDULE_COPY, SCHEDULE_COPY_UR } from "./schedule/copy";
import { REPORTS_EN, REPORTS_UR } from "./reports/copy";
import { PEOPLE_EN, PEOPLE_UR } from "./people/copy";
import { COACH_HOME_EN, COACH_HOME_UR } from "./home/copy";
import { currentCoachMenuItem } from "../teacher/menu";
import CoachVisit from "./pages/CoachVisit";
import CoachCheckSend from "./pages/CoachCheckSend";
import CoachSending from "./pages/CoachSending";
import CoachObserve from "./pages/CoachObserve";
import ReportsFrame from "./reports/ReportsFrame";
import { setDraft, clearDraft } from "./observeDraft";
import { resetSender } from "./observe/sender";

/**
 * bd-jjcofw.10 — the seven MUSTs of the Schedule & Observe UX review (operator yes, 5 Nov 21:00). The banner stays (its
 * words change with M4). Each block names the MUST it pins.
 */

/** Every string a copy object can put on screen (functions called with sample arguments). */
function strings(o: unknown, out: string[] = []): string[] {
  if (typeof o === "string") out.push(o);
  else if (typeof o === "function") { try { const v = (o as (...a: unknown[]) => unknown)(2, "Ayesha"); if (typeof v === "string") out.push(v); } catch { /* not a word */ } }
  else if (Array.isArray(o)) o.forEach((x) => strings(x, out));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => strings(x, out));
  return out;
}
const COPIES = { OBSERVE_COPY, OBSERVE_COPY_UR, SCHEDULE_COPY, SCHEDULE_COPY_UR, REPORTS_EN, REPORTS_UR, PEOPLE_EN, PEOPLE_UR, COACH_HOME_EN, COACH_HOME_UR };

describe("M1 — no 'HITL' or 'DC' on screen", () => {
  it.each(Object.entries(COPIES))("%s says neither HITL nor a bare DC", (_n, copy) => {
    const all = strings(copy);
    expect(all.filter((s) => /HITL/.test(s))).toEqual([]);
    expect(all.filter((s) => /(^|[^A-Za-z])DC([^A-Za-z]|$)/.test(s))).toEqual([]);
  });

  it("the stats read Observations · Digital Coaching · Coach score (avg.), in both languages", () => {
    for (const c of [OBSERVE_COPY, SCHEDULE_COPY, PEOPLE_EN]) {
      expect([c.hitl, c.dc, c.avgHitl]).toEqual(["Observations", "Digital Coaching", "Coach score (avg.)"]);
    }
    for (const c of [OBSERVE_COPY_UR, SCHEDULE_COPY_UR, PEOPLE_UR]) {
      expect([c.hitl, c.dc, c.avgHitl]).toEqual(["مشاہدات", "ڈیجیٹل کوچنگ", "کوچ اسکور (اوسط)"]);
    }
    expect(REPORTS_EN.kpiAvg).toBe("Coach score (avg.)");
  });

  it("the visit's last row is the last OBSERVATION, by whom", () => {
    expect(OBSERVE_COPY.lastVisitOn("14 Sep")).toBe("Last observation · 14 Sep");
    expect(OBSERVE_COPY.hitlBy("You")).toBe("Observation · You");
    expect(OBSERVE_COPY_UR.lastVisitOn("14 Sep")).toBe("آخری مشاہدہ · 14 Sep");
  });
});

describe("M2 — every score says whose", () => {
  it("AI score before her check, Coach score after; no 'Draft'", () => {
    expect(REPORTS_EN.dcScore).toBe("AI score");
    expect(REPORTS_EN.dcScoreOf("64%")).toBe("AI score 64%");
    expect(REPORTS_EN.finalScore("72%")).toBe("Coach score 72%");
    expect(REPORTS_EN.draftBeforeCheck).toBe("Before your check");
    expect(REPORTS_EN.legendYours).toBe("Coach score");
    expect(REPORTS_EN.legendDc).toBe("AI score");
    expect(strings(REPORTS_EN).filter((s) => /\bDraft\b/.test(s))).toEqual([]);
    expect(REPORTS_UR.legendYours).toBe("کوچ اسکور");
    expect(REPORTS_UR.legendDc).toBe("AI اسکور");
  });
});

describe("M4 — her list is My observations; 'report' is only what the teacher receives", () => {
  it("titles and the waiting line", () => {
    expect(REPORTS_EN.title).toBe("My observations");
    expect(OBSERVE_COPY.reports).toBe("My observations");
    expect(REPORTS_UR.title).toBe("میرے مشاہدات");
    expect(OBSERVE_COPY_UR.reports).toBe("میرے مشاہدات");
    for (const c of [REPORTS_EN, OBSERVE_COPY, COACH_HOME_EN]) {
      expect(c.reportsWaiting(1)).toBe("1 observation needs you");
      expect(c.reportsWaiting(3)).toBe("3 observations need you");
    }
    expect(OBSERVE_COPY.goToReports).toBe("Go to My observations");
  });
});

describe("M7 — 'You recorded under 1 min.'", () => {
  it("a length inside the sentence keeps its own case, starting lower-case", () => {
    expect(OBSERVE_COPY.recordedFor(OBSERVE_COPY.underMinute)).toBe("You recorded under 1 min.");
    expect(OBSERVE_COPY.recordedFor("38 min")).toBe("You recorded 38 min.");
  });
});

describe("M5 — a visit opened from Schedule stays in Schedule", () => {
  it("the menu: the visit page is Schedule's; from Observe's list it stays Observe; its steps are Observe's", () => {
    expect(currentCoachMenuItem("/portal/coach/visit/v-1")).toBe("schedule");
    expect(currentCoachMenuItem("/portal/coach/visit/v-1", "?from=observe")).toBe("observe");
    expect(currentCoachMenuItem("/portal/coach/visit/v-1/record")).toBe("observe");
    expect(currentCoachMenuItem("/portal/coach/visit/v-1/check")).toBe("observe");
    expect(currentCoachMenuItem("/portal/coach/observe/pick")).toBe("observe");
  });
});

/* ── rendered ─────────────────────────────────────────────────────────────── */

const C = coach as any;
const send = sendObservation as any;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000002";
const VISIT = {
  success: true,
  visit: { id: VISIT_ID, teacherName: "Ayesha Bibi", teacherExtId: "923001110001", schoolName: "IMSG I-10/1", schoolExtId: "niete:110", scheduledFor: "2026-10-06", scheduledSlot: "11:30", status: "upcoming", overdue: false },
  teacher: { teacherExtId: "923001110001", name: "Ayesha Bibi", phone: "923001110001", hitl: 3, dc: 7, avgHitl: 61, daysSinceTraining: 12 },
  lastVisit: { id: "s-sent", date: "2026-09-14T09:00:00Z", score: 61, step: "sent", byMe: true, observerName: "Hataf Atif", portal: true },
};
const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
      <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
      <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
      <Route path="/portal/coach/observe" element={<CoachObserve />} />
      <Route path="/portal/coach/observation/:id" element={<ReportsFrame title="Ayesha Bibi" crumb="x"><p>body</p></ReportsFrame>} />
      <Route path="*" element={<div>elsewhere</div>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(async () => {
  vi.clearAllMocks();
  resetSender();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T09:30:00+05:00"));
  clearDraft(VISIT_ID);
  C.getVisit.mockResolvedValue(VISIT);
  C.getHome.mockResolvedValue({ success: true, home: { today: [], next: null, counts: { week: 1, overdue: 0, waiting: 2, inProgress: 1, teachers: 9, schools: 2 } } });
  (leader as any).getObserveRecentPlans.mockResolvedValue({ plans: [] });
  send.mockResolvedValue({ coachingSessionId: "cs-1" });
});
afterEach(() => { vi.useRealTimers(); });

describe("the visit page (M1, M5)", () => {
  it("opened from Schedule: crumb My schedule; stats in words; the last row is the last observation", async () => {
    at(`/portal/coach/visit/${VISIT_ID}`);
    expect(await screen.findByText("Ayesha Bibi", { selector: "h1" })).toBeInTheDocument();
    const body = document.body.textContent || "";
    expect(body).toContain("My schedule · ");
    expect(body).not.toContain("Take observation");
    expect(body).not.toMatch(/HITL/);
    expect(screen.getByText("Coach score (avg.)")).toBeInTheDocument();
    // At 390 px "Last observation · 14 Sep" is cut before the date: the title is the words, the date and who go under it.
    const row = screen.getByTestId("last-visit-row");
    expect(within(row).getByText("Last observation")).toBeInTheDocument();
    expect(row).toHaveTextContent("14 Sep · You");
  });

  it("opened from Observe's list (?from=observe): crumb Take observation", async () => {
    at(`/portal/coach/visit/${VISIT_ID}?from=observe`);
    expect(await screen.findByText("Ayesha Bibi", { selector: "h1" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("Take observation · ");
  });
});

describe("M6 — no percentage on the Sent screen", () => {
  it("sent: a tick and 'Observation sent', no '100%'", async () => {
    setDraft(VISIT_ID, {
      blob: new Blob(["x"], { type: "audio/webm" }), filename: "Observation 6 Oct 11.30.webm", durationMs: 38 * 60_000,
      recordingId: null, label: "Ayesha Bibi’s observation", sub: "38 min · just now",
    });
    at(`/portal/coach/visit/${VISIT_ID}/check`);
    const sendBtn = await screen.findByRole("button", { name: "Send observation" }, { timeout: 5000 });
    await act(async () => { fireEvent.click(sendBtn); });
    expect(await screen.findByTestId("send-state", {}, { timeout: 5000 })).toHaveTextContent("Observation sent");
    expect(screen.queryByTestId("send-pct")).toBeNull();
    expect(document.body.textContent).not.toContain("100%");
  });
});

describe("M3 + M4 — one picture for an observation; the list is My observations", () => {
  it("the observation's frame draws the Observe art, never the Reports chart", () => {
    const { container } = at("/portal/coach/observation/cs-1");
    expect(container.querySelector('svg[data-feature-art="observations"]')).not.toBeNull();
    expect(container.querySelector('svg[data-feature-art="reports"]')).toBeNull();
  });

  it("the Observe hub: Take observation and My observations, both with the Observe art", async () => {
    const { container } = at("/portal/coach/observe");
    const tile = await screen.findByRole("link", { name: /My observations/ });
    expect(tile).toHaveAttribute("href", "/portal/coach/reports");
    expect(within(tile).queryByText("Reports")).toBeNull();
    expect(container.querySelector('svg[data-feature-art="reports"]')).toBeNull();
  });
});
