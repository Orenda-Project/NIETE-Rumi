import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import api, { language, portal } from "../../../services/api";
import { noticeTracker } from "../../notices/tracker";
import { useAuth } from "../../../hooks/useAuth";
import { forgetConfig } from "../../../lib/useNewUi";
import { resetHomeMemo } from "../api";
import { resetHomeLookMemory, resetHomeOrderMemory } from "../useHomeData";
import Home from "../../pages/Home";
import { ROWS_WAIT_MS } from "./LookHome";
import { teacherPath } from "../../routes";
import type { TeacherFeature } from "../../paths";

/**
 * The "Last 30 days" block on both Home trees (GET /me/home `activity`, only sent with portal_teacher_home_activity on):
 * the look draws band → card → block → progress strip → tiles; the card build draws card → block → strip → tiles. No
 * `activity` (switch off, no numbers) → today's Home, no block.
 */
const TEACHER = { firstName: "Amina Testwala", lastName: null, role: "teacher", phoneNumber: "test-teacher-1", schoolName: "IMSG I-10/1" };
const FIXED = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const QUIZ = "/quiz/teacher/tok123";
const LOOK = { teacherHomeCard: true, teacherHomeLook: true };

type Body = Record<string, unknown>;
const body = (over: Body = {}): Body => ({
  success: true, now: new Date().toISOString(), order: FIXED, orderOn: false, card: null,
  scores: { coach: null, observation: null }, quizHome: QUIZ, ...over,
});
const COACH_CARD = { kind: "coach_report", title: "Fractions", score: 72, max: 100, at: "2026-10-18T09:00:00Z", href: "/x", id: "s-1" };
const LESSON_CARD = { kind: "lesson", title: "Parts of a Plant", from: "lp", href: QUIZ, id: "lp-1" };
const OBS = { marks: 29, max: 38, at: "", id: "o-1" };
const READY_ITEM = (id: string) => {
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  return {
    id, kind: "paper", state: "ready", title: null, grade: 4, subject: "Science", chapterNumber: 2, questions: 15,
    startedAt: iso(-600_000), readyAt: iso(-300_000), seenAt: iso(-290_000), openedAt: null, homeUntil: iso(3_600_000),
    paperId: `pp-${id}`, renderId: null, lessonId: null, lang: null, errorCode: null,
  };
};

function serve({ home, notices = [], features = LOOK }: { home?: Body; notices?: unknown[]; features?: Body }) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: home ?? body() });
    return Promise.resolve({ data: { success: true, items: notices } });
  }) as never);
  vi.mocked(api.post).mockResolvedValue({ status: 204 } as never);
}

function renderHome() {
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes>
        <Route path="/portal/teacher" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The rows' features, in the order drawn (each links to teacherPath(feature)). */
const rows = () => within(screen.getByTestId("feature-tiles")).getAllByRole("link")
  .map((a) => FIXED.find((k) => teacherPath(k as TeacherFeature) === a.getAttribute("href")));

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const ACTIVITY = {
  updatedAt: new Date().toISOString(), slot: "day",
  tiles: { opened: { now: 14, prev: 9 }, taught: { now: 3, prev: 1 }, coached: { now: 2, prev: 2 }, quizzes: { now: 4, prev: 0 }, papers: { now: 1, prev: 0 } },
  trend: [], tip: null,
};

describe("teacher Home, the activity block", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    noticeTracker.reset();
    forgetConfig();
    resetHomeMemo();
    resetHomeOrderMemory();
    resetHomeLookMemory();
  });

  it("the look: card, then the block, then the progress strip, then the tiles", async () => {
    serve({ home: body({ card: COACH_CARD, scores: { coach: null, observation: OBS }, activity: ACTIVITY }) });
    renderHome();
    const card = await screen.findByTestId("home-look-card");
    const block = await screen.findByTestId("home-activity");
    const strip = screen.getByTestId("home-scores");
    const grid = screen.getByTestId("feature-tiles");
    expect(follows(card, block) && follows(block, strip) && follows(strip, grid)).toBe(true);
    expect(rows()).toEqual(FIXED);
  });

  it("the look, no activity: no block, Home as today", async () => {
    serve({ home: body({ card: COACH_CARD, scores: { coach: null, observation: OBS } }) });
    renderHome();
    await screen.findByTestId("home-look-card");
    await screen.findByTestId("feature-tiles");
    expect(screen.queryByTestId("home-activity")).toBeNull();
  });

  it("the card build: card, then the block, then the tiles", async () => {
    serve({ home: body({ card: COACH_CARD, activity: ACTIVITY }), features: { teacherHomeCard: true } });
    renderHome();
    const card = await screen.findByTestId("home-next-card");
    const block = await screen.findByTestId("home-activity");
    expect(follows(card, block) && follows(block, screen.getByTestId("feature-tiles"))).toBe(true);
  });

  it("the card build, no activity: no block", async () => {
    serve({ home: body({ card: COACH_CARD }), features: { teacherHomeCard: true } });
    renderHome();
    await screen.findByTestId("home-next-card");
    expect(screen.queryByTestId("home-activity")).toBeNull();
  });

  it("no activity but My journey on: only the My journey row, under the card", async () => {
    serve({ home: body({ card: COACH_CARD }), features: { ...LOOK, teacherJourney: true } });
    renderHome();
    const block = await screen.findByTestId("home-activity");
    expect(within(block).getAllByRole("button")).toHaveLength(1);
    expect(follows(block, screen.getByTestId("feature-tiles"))).toBe(true);
  });
});
