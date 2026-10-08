import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13.2 — Observations in Urdu: the main page (Next visit, In progress, Reports) and a coach visit's
 * report take every word from OBSERVATIONS (bilingual), none left in English; a report's band is the bot's
 * Urdu band word (Digital Coaching's `bands`); data (the coach's name, the school, the slot, the topic) stays
 * as the API sends it. MACHINE-DRAFTED Urdu (see the review file).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useRecordingClock: () => 0 }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Ayesha", lastName: "Bibi" } }) }));
const portal = vi.hoisted(() => ({ getCoachingSessions: vi.fn(), getCoachingProgress: vi.fn(), getCoachingSession: vi.fn() }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal,
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import "../routes";
import api from "../../services/api";
import { ObservationsHomePage } from "./ObservationsHome";
import observationRoutes from "./routes";
import { OBS_HOME, OBS_REPORT, obsReportPath } from "./paths";
import { OBSERVATIONS_COPY_UR as U } from "./copy";
import { COACHING_V2_COPY_UR } from "../coaching/copy";
import { reportGroups } from "./api";
import { LESSONS_V2_COPY_UR } from "../lessons/copy";
import { dayName, pkToday } from "../lessons/days";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const DAYS = LESSONS_V2_COPY_UR.days;
const BANDS = COACHING_V2_COPY_UR.bands;
const plain = (t: string | null | undefined) => (t || "").replace(/[⁦⁩]/g, "");
const ENGLISH_DAY = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d/;
/** English labels still on the page, read without the isolates (an isolated "⁦Good⁩" is still English). */
const englishLeft = (words: string[]) => words.filter((w) => plain(document.body.textContent).includes(w));

const SESSIONS = [
  { id: "dc1", date: "2026-10-06T05:00:00Z", duration: 1800, overallScore: 30, maxScore: 52, percentage: 58, topic: "My own lesson", subject: "Science", observation: null },
  { id: "o1", date: "2026-09-28T05:00:00Z", duration: 1900, overallScore: 33, maxScore: 52, percentage: 63, topic: "Fractions", subject: "Mathematics",
    observation: { observerName: "Hataf Atif", observedAt: "2026-09-28T05:00:00Z", sentAt: "2026-09-30T05:00:00Z" } },
];

let visits: unknown;
beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
  visits = { success: true,
    next: { date: "2026-10-12", slot: "Morning", coachName: "Hataf Atif", schoolName: "IMSG I-10/1" },
    inProgress: [
      { sessionId: "v1", date: "2026-10-07", coachName: "Hataf Atif", stage: "debrief" },
      { sessionId: "v2", date: "2026-10-05", coachName: "Hataf Atif", stage: "reviewing" },
      { sessionId: "v3", date: "2026-10-03", coachName: "Hataf Atif", stage: "report" },
    ] };
  http.get.mockImplementation(async (url: string) => {
    if (url === "/teacher/visits") return { data: visits };
    throw new Error(`unexpected GET ${url}`);
  });
  portal.getCoachingSessions.mockResolvedValue({ sessions: SESSIONS, pagination: { total: 2, page: 1, limit: 50, totalPages: 1 } });
});

const open = () => render(
  <MemoryRouter initialEntries={[OBS_HOME]}><Routes><Route path={OBS_HOME} element={<ObservationsHomePage />} /></Routes></MemoryRouter>,
);

describe("Observations in Urdu — the main page", () => {
  it("title and crumb, Next visit with an Urdu day; data as it is", async () => {
    open();
    const next = await screen.findByRole("region", { name: U.nextVisit });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(U.title);
    expect(screen.getByTestId("page-crumb").textContent).toBe(U.home);
    expect(screen.getByRole("heading", { name: U.nextVisit })).toBeTruthy();
    const text = plain(next.textContent);
    expect(text).toContain(dayName("2026-10-12", pkToday(), DAYS));
    expect(text).toContain("Morning");
    expect(text).toContain("Hataf Atif · IMSG I-10/1");
    expect(text).not.toMatch(ENGLISH_DAY);
    expect(englishLeft(["Next visit", "Observations", "Home"])).toEqual([]);
  });

  it("In progress: Coach visit and each stage in Urdu", async () => {
    open();
    expect(await screen.findByRole("heading", { name: U.inProgress })).toBeTruthy();
    expect(screen.getAllByText(U.coachVisit)).toHaveLength(3);
    for (const w of Object.values(U.stages)) expect(screen.getByText(w)).toBeTruthy();
    expect(englishLeft(["In progress", "Coach visit", "Debrief with coach", "Coach reviewing", "Report coming"])).toEqual([]);
    expect(plain(document.body.textContent)).not.toMatch(ENGLISH_DAY);
  });

  it("Reports: heading and the band in Urdu; the topic as it is", async () => {
    open();
    expect(await screen.findByRole("link", { name: /Fractions/ })).toBeTruthy();
    expect(screen.getByText(U.reports)).toBeTruthy();
    expect(screen.getByText(BANDS.good)).toBeTruthy();
    expect(englishLeft(["Good", "Reports"])).toEqual([]);
  });

  it("no visit planned and no reports: said in Urdu", async () => {
    visits = { success: true, next: null, inProgress: [] };
    portal.getCoachingSessions.mockResolvedValue({ sessions: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } });
    open();
    expect(await screen.findByText(U.noVisit)).toBeTruthy();
    expect(await screen.findByText(U.noReports)).toBeTruthy();
    expect(englishLeft(["No visit planned", "No reports yet"])).toEqual([]);
  });
});

describe("Observations in Urdu — a coach visit's report", () => {
  it("the shared report page, with Observations (Urdu) as its crumb", async () => {
    portal.getCoachingProgress.mockResolvedValue({ id: "o1", status: "failed", stage: "stopped", reflection: null });
    const route = observationRoutes.find((r) => r.path === OBS_REPORT);
    render(
      <MemoryRouter initialEntries={[obsReportPath("o1")]}><Routes><Route path={OBS_REPORT} element={route?.element} /></Routes></MemoryRouter>,
    );
    expect(await screen.findByText(COACHING_V2_COPY_UR.stopped)).toBeTruthy();
    expect(screen.getByTestId("page-crumb").textContent).toBe(U.title);
  });
});

describe("Observations in Urdu — reportGroups takes the words given", () => {
  it("the band and the day in Urdu", () => {
    const [g] = reportGroups(SESSIONS.filter((s) => s.observation) as never, "2026-10-09", BANDS, DAYS);
    expect(g.day).toBe(dayName("2026-09-28", "2026-10-09", DAYS));
    expect(g.items[0].chip).toEqual({ text: BANDS.good, tone: "done" });
  });
});
