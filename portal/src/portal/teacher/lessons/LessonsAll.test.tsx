import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * bd-fmf24g.3 — All lesson plans (v28 canvas LessonsAll), reached from Recent's See all:
 *
 *   DateRangeBar      This month by default; the API is asked for exactly the dates it shows, and the
 *                     period before it compares with (so the ▲▼ match the "vs …" under the tiles)
 *   Filter by class   her classes with lesson plans (the same pairs as Select your class); Show all
 *                     classes clears it; the numbers and the list narrow together (server-side)
 *   KpiTiles          Lesson plans (with its trend), Classes covered, Sent on WhatsApp, Days active —
 *                     each with its change against the period before (GET /lesson-plans/history)
 *   the list          every plan in the range by Pakistan day, each reopening by key
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { LessonsAllPage } from "./LessonsAll";
import lessonRoutes from "./routes";
import { LESSONS_ALL, LESSONS_OPEN } from "./paths";
import { LESSONS_V2_COPY as C } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };

const HISTORY = {
  success: true,
  range: { key: "custom", from: "2026-10-01", to: "2026-10-08", timezone: "Asia/Karachi" },
  previous: { from: "2026-09-01", to: "2026-09-08" },
  filter: null,
  kpis: {
    lessonPlans: { value: 4, previous: 1 },
    classesCovered: { value: 3, previous: 1 },
    sentOnWhatsapp: { value: 3, previous: 3 },
    daysActive: { value: 4, previous: 2 },
  },
  trend: { bucketDays: 1, points: [1, 1, 0, 0, 0, 1, 0, 2] },
  items: [
    { planKey: "k5:a", kind: "k5", found: true, title: "Parts of a plant", grade: 4, subject: "General Science", subjectKey: "science",
      chapterNumber: 1, chapterTitle: "Plants", dayLabel: "Day 1", pagesLabel: null, lastUsedAt: "2026-10-08T04:00:00.000Z",
      day: "2026-10-08", via: "portal", open: { lane: "k5", lessonId: "a" } },
    { planKey: "g612:c", kind: "g612", found: true, title: "Speed", grade: 9, subject: "Physics", subjectKey: "physics",
      chapterNumber: 2, chapterTitle: "Motion", dayLabel: null, pagesLabel: null, lastUsedAt: "2026-10-05T05:00:00.000Z",
      day: "2026-10-05", via: "whatsapp", open: { lane: "g612", segmentId: "c", lang: "ur" } },
  ],
  total: 2,
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00Z")); // 15:00 in Pakistan, Thursday 8 Oct
  http.get.mockImplementation(async (url: string) => {
    if (url === "/lesson-plans/history") return { data: HISTORY };
    if (url === "/me/grade-subjects") return { data: { success: true, combos: [
      { grade: 4, gradeCode: "grade_4", subject: "Mathematics", subjectKey: "maths", source: "class", featureKey: "math", available: true },
      { grade: 4, gradeCode: "grade_4", subject: "Social Studies", subjectKey: "social_studies", source: "class", featureKey: null, available: false },
    ] } };
    throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
  });
});
afterEach(() => vi.useRealTimers());

const renderAll = () => render(
  <MemoryRouter initialEntries={[LESSONS_ALL]}>
    <Routes><Route path={LESSONS_ALL} element={<LessonsAllPage />} /></Routes>
  </MemoryRouter>,
);
const lastParams = () => http.get.mock.calls.filter(([u]) => u === "/lesson-plans/history").pop()?.[1]?.params;

describe("the range", () => {
  it("This month by default: the API is asked for the dates shown and the period before", async () => {
    renderAll();
    expect(screen.getByRole("heading", { name: C.all.title })).toBeTruthy();
    await waitFor(() => expect(lastParams()).toEqual({
      range: "custom", from: "2026-10-01", to: "2026-10-08", prevFrom: "2026-09-01", prevTo: "2026-09-08",
    }));
  });

  it("All time: asked for everything, no period before", async () => {
    renderAll();
    fireEvent.click(await screen.findByRole("button", { name: /This month/ }));
    fireEvent.click(screen.getByRole("radio", { name: "All time" }));
    await waitFor(() => expect(lastParams()).toEqual({ range: "all" }));
  });
});

describe("the numbers", () => {
  it("four tiles from the server's counts, each against the period before", async () => {
    renderAll();
    expect(await screen.findByRole("group", { name: `4 ${C.all.kpis.lessonPlans}, up 3` })).toBeTruthy();
    expect(screen.getByRole("group", { name: `3 ${C.all.kpis.classesCovered}, up 2` })).toBeTruthy();
    expect(screen.getByRole("group", { name: new RegExp(`^3 ${C.all.kpis.sentOnWhatsapp}`) })).toBeTruthy();
    expect(screen.getByRole("group", { name: `4 ${C.all.kpis.daysActive}, up 2` })).toBeTruthy();
  });
});

describe("the list", () => {
  it("by Pakistan day, each row reopening its plan by key", async () => {
    renderAll();
    const row = await screen.findByRole("link", { name: /Parts of a plant/ });
    expect(new URL(row.getAttribute("href") as string, "https://x").pathname).toBe(LESSONS_OPEN);
    expect(screen.getByText(C.days.today)).toBeTruthy();
    const speed = screen.getByRole("link", { name: /Speed/ });
    expect(new URL(speed.getAttribute("href") as string, "https://x").searchParams.get("lang")).toBe("ur");
  });
});

describe("Filter by class", () => {
  it("her classes with lesson plans; picking one narrows by grade + subject key; Show all classes clears it", async () => {
    renderAll();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(C.all.filterLabel) }));
    const sheet = screen.getByRole("dialog", { name: C.all.filterLabel });
    expect(within(sheet).queryByText(/Social Studies/)).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: /Mathematics/ }));
    await waitFor(() => expect(lastParams()).toEqual(expect.objectContaining({ grade: 4, subject: "maths" })));
    fireEvent.click(screen.getByRole("button", { name: C.all.showAllClasses }));
    await waitFor(() => expect(lastParams()).not.toHaveProperty("grade"));
  });
});

describe("routes", () => {
  it("registers All lesson plans", () => {
    expect(lessonRoutes.map((r) => r.path)).toContain(LESSONS_ALL);
  });
});
