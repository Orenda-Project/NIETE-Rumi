import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — Analytics in Urdu: the headings, the tiles, the band chart's rows and the area chips
 * (the bot's Urdu band names: بہترین، اچھا، اوسط، اوسط سے کم، مدد درکار), the remark's date; data (area
 * names, a remark's comment) stays as it is. The chart's time axis stays left → right (operator decision,
 * provisional). MACHINE-DRAFTED Urdu (see the review file).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getMyAnalytics: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import "../routes";
import api, { portal } from "../../services/api";
import analyticsRoutes from "./routes";
import { ANALYTICS_HOME } from "./paths";
import { ANALYTICS_V2_COPY_UR as U } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const mine = portal.getMyAnalytics as unknown as ReturnType<typeof vi.fn>;
const plain = (t: string | null) => (t || "").replace(/[⁦⁩]/g, "");

const PROGRESS = {
  lessonPlans: { used: 14 }, training: { completed: 6 }, assessments: { made: 4 },
  attendance: { days: 18 }, coaching: { digitalCoach: 9, observations: 3 },
};
const MINE = {
  success: true,
  analytics: {
    totalSessions: 3, averageScore: 66, domainBreakdown: [], strongestDomain: null, focusDomain: null,
    scoreTrend: [
      { date: "2026-08-12", percentage: 45, points: null, maxPoints: null, teacherName: null },
      { date: "2026-09-28", percentage: 66, points: null, maxPoints: null, teacherName: null },
    ],
    areas: [
      { key: "t", name: "Teaching skills", pct: 72, band: "good", observations: 3 },
      { key: "s", name: "Subject knowledge", pct: 51, band: "average", observations: 3 },
    ],
  },
  presence: { teacher: { records: 20, present: 19, absent: 1, leave: 0, presentPct: 95 }, student: { sessions: 30, totalMarked: 900, present: 783, presentPct: 87 } },
  remarksReceived: [{ cycleName: "Q2", submittedAt: "2026-09-28T09:00:00Z", comment: "Good use of the board.", areas: [] }],
};

beforeEach(async () => {
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: PROGRESS });
  mine.mockResolvedValue(MINE);
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
});

const open = () => render(
  <MemoryRouter initialEntries={[ANALYTICS_HOME]}>
    <Routes>{analyticsRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
  </MemoryRouter>,
);

describe("Analytics in Urdu", () => {
  it("title, sections and tiles in Urdu", async () => {
    open();
    expect(await screen.findByRole("heading", { level: 1, name: U.title })).toBeTruthy();
    expect(await screen.findByRole("group", { name: new RegExp(U.lessonPlansUsed) })).toBeTruthy();
    expect(screen.getAllByText(U.activity).length).toBeGreaterThan(0);
    expect(screen.queryByText("Activity")).toBeNull();
    expect(screen.queryByText("Lesson plans used")).toBeNull();
  });

  it("bands in the bot's Urdu: the chart's rows and the area chips; data stays as it is", async () => {
    open();
    const chart = await screen.findByRole("img", { name: new RegExp(U.bands.average) });
    expect(within(chart).getByText(U.bands.excellent)).toBeTruthy();
    expect(within(chart).getByText(U.bands.needs_support)).toBeTruthy();
    expect(within(chart).queryByText("Excellent")).toBeNull();
    const areas = screen.getByRole("region", { name: U.strongestToWeakest });
    expect(within(areas).getByText("Teaching skills")).toBeTruthy();
    expect(plain(areas.textContent)).toContain(U.bands.good);
  });

  it("the remark's date in Urdu months", async () => {
    open();
    const remarks = await screen.findByRole("region", { name: U.principalRemarks });
    expect(plain(remarks.textContent)).toContain(U.day(28, 8));
    expect(remarks.textContent).toContain("Good use of the board.");
  });
});
