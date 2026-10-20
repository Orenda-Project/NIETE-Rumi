import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getConfig: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import api, { portal } from "../../services/api";
import { noticeTracker } from "../notices/tracker";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import { resetHomeMemo } from "../home/api";
import { resetHomeOrderMemory } from "../home/useHomeData";
import Home from "./Home";
import { teacherPath } from "../routes";
import type { TeacherFeature } from "../paths";

/**
 * Home with portal_teacher_home_card ON (the build contract): the full card first under the band (unless "Ready for you"
 * has rows), the chips, the tiles in the server's order, the slim card spanning both columns after tile 1, and each
 * tap logged before it goes.
 */
const TEACHER = { firstName: "Amina Testwala", lastName: null, role: "teacher", phoneNumber: "test-teacher-1", schoolName: "IMSG I-10/1" };
const FIXED = ["lessons", "coaching", "observations", "training", "assessment", "attendance", "classes", "analytics"];
const QUIZ = "/quiz/teacher/tok123";

type Body = Record<string, unknown>;
const body = (over: Body = {}): Body => ({
  success: true, now: new Date().toISOString(), order: FIXED, orderOn: false, card: null,
  scores: { coach: null, observation: null }, quizHome: QUIZ, ...over,
});
const COACH_CARD = { kind: "coach_report", title: "Fractions", score: 72, max: 100, at: "2026-10-18T09:00:00Z", href: "/x", id: "s-1" };
const LESSON_CARD = { kind: "lesson", title: "Parts of a Plant", from: "lp", href: QUIZ, id: "lp-1" };
const READY_ITEM = (id: string) => {
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  return {
    id, kind: "paper", state: "ready", title: null, grade: 4, subject: "Science", chapterNumber: 2, questions: 15,
    startedAt: iso(-600_000), readyAt: iso(-300_000), seenAt: iso(-290_000), openedAt: null, homeUntil: iso(3_600_000),
    paperId: `pp-${id}`, renderId: null, lessonId: null, lang: null, errorCode: null,
  };
};

function serve({ home, notices = [], features = { teacherHomeCard: true } }: { home?: Body; notices?: unknown[]; features?: Body }) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: home ?? body() });
    return Promise.resolve({ data: { success: true, items: notices } });
  }) as never);
  vi.mocked(api.post).mockResolvedValue({ status: 204 } as never);
}

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function renderHome() {
  vi.mocked(useAuth).mockReturnValue({ user: TEACHER, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes>
        <Route path="/portal/teacher" element={<Home />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The tiles' features, in the order drawn (each tile links to teacherPath(feature)). */
const labels = () => within(screen.getByTestId("feature-tiles")).getAllByRole("link")
  .map((a) => FIXED.find((k) => teacherPath(k as TeacherFeature) === a.getAttribute("href")));

describe("teacher v2 Home, card switch ON", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    noticeTracker.reset();
    forgetConfig();
    resetHomeMemo();
    resetHomeOrderMemory();
  });

  it("the full card is the first thing under the band, then the chips, then the tiles; one GET /me/home", async () => {
    serve({ home: body({ card: COACH_CARD, scores: { coach: { marks: 31, max: 40, at: "", id: "s-1" }, observation: { marks: 29, max: 38, at: "", id: "o-1" } } }) });
    renderHome();
    const card = await screen.findByTestId("home-next-card");
    const body_ = card.parentElement as HTMLElement;
    expect(body_.firstElementChild).toBe(card);
    const chips = screen.getByTestId("home-scores");
    // The coach chip repeats the card: only the observation chip.
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Observation 29/38"]);
    expect(card.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chips.compareDocumentPosition(screen.getByTestId("feature-tiles")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vi.mocked(api.get).mock.calls.filter(([u]) => u === "/me/home")).toHaveLength(1);
  });

  it("yields to 'Ready for you': with rows in the tray the full card is not drawn", async () => {
    serve({ home: body({ card: COACH_CARD }), notices: [READY_ITEM("a")] });
    renderHome();
    await screen.findByRole("region", { name: "Ready for you" });
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("home-next-card")).toBeNull();
  });

  it("the slim card is unaffected by the tray, and spans both columns after tile index 1", async () => {
    serve({ home: body({ card: LESSON_CARD }), notices: [READY_ITEM("b")] });
    renderHome();
    const slim = await screen.findByTestId("home-slim-card");
    const grid = screen.getByTestId("feature-tiles");
    expect(slim.parentElement).toBe(grid);
    expect(Array.from(grid.children).indexOf(slim)).toBe(2);
    expect(slim.className).toMatch(/\bcol-span-2\b/);
    expect(screen.queryByTestId("home-next-card")).toBeNull();
  });

  it("with the slim card, the chips sit under it (the card region), not above the tiles", async () => {
    serve({ home: body({ card: LESSON_CARD, scores: { coach: null, observation: { marks: 29, max: 38, at: "", id: "o-1" } } }) });
    renderHome();
    const slim = await screen.findByTestId("home-slim-card");
    const grid = screen.getByTestId("feature-tiles");
    const chips = await screen.findByTestId("home-scores");
    expect(Array.from(grid.children).indexOf(slim)).toBe(2);
    expect(grid.contains(chips)).toBe(true);
    expect(Array.from(grid.children).findIndex((c) => c.contains(chips))).toBe(3);
  });

  it("tiles in the server's order when the order switch is on and it lands in time", async () => {
    const order = ["coaching", "lessons", "training", "observations", "assessment", "attendance", "classes", "analytics"];
    serve({ home: body({ order, orderOn: true }), features: { teacherHomeCard: true, teacherHomeOrder: true } });
    renderHome();
    await waitFor(() => expect(labels()).toEqual(order));
  });

  it("the order switch off: the fixed order, whatever the server sends", async () => {
    const order = ["coaching", "lessons", "training", "observations", "assessment", "attendance", "classes", "analytics"];
    serve({ home: body({ order, orderOn: true, card: COACH_CARD }), features: { teacherHomeCard: true } });
    renderHome();
    await screen.findByTestId("home-next-card");
    expect(labels()).toEqual(FIXED);
  });

  it("a tap is logged, then goes: See report → the coaching report (router)", async () => {
    serve({ home: body({ card: COACH_CARD }) });
    renderHome();
    await userEvent.setup().click(await screen.findByRole("button", { name: "See report" }));
    expect(vi.mocked(api.post)).toHaveBeenCalledWith("/me/home/tap", { kind: "coach_report" });
    expect(screen.getByTestId("where").textContent).toBe("/portal/teacher/coaching/report/s-1");
  });

  it("Quiz this → the signed quiz home, outside the router (a page load)", async () => {
    const assign = vi.fn();
    const real = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...real, assign } });
    try {
      serve({ home: body({ card: LESSON_CARD }) });
      renderHome();
      await userEvent.setup().click(await screen.findByRole("button", { name: "Quiz this" }));
      expect(vi.mocked(api.post)).toHaveBeenCalledWith("/me/home/tap", { kind: "lesson" });
      expect(assign).toHaveBeenCalledWith(QUIZ);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: real });
    }
  });

  it("no card and no scores: the tiles are the first thing under the band, as today", async () => {
    serve({ home: body() });
    renderHome();
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    await new Promise((r) => setTimeout(r, 0));
    const tiles = screen.getByTestId("feature-tiles");
    expect(tiles.parentElement?.firstElementChild).toBe(tiles);
    expect(labels()).toEqual(FIXED);
  });

  it("GET /me/home fails: Home is today's", async () => {
    serve({});
    vi.mocked(api.get).mockImplementation(((url: string) => (url === "/me/home"
      ? Promise.reject({ response: { status: 503 } })
      : Promise.resolve({ data: { success: true, items: [] } }))) as never);
    renderHome();
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith("/me/home"));
    expect(screen.queryByTestId("home-next-card")).toBeNull();
    expect(labels()).toEqual(FIXED);
  });
});
