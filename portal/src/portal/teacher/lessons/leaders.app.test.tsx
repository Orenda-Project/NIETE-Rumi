import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";

/**
 * bd-4joiqz — "why can't a coach see LPs in their IAB? Shouldnt we make them available?" (operator, 22 Oct 2026).
 *
 * Through the REAL App (BrowserRouter, CoachAppGuard, AnalyticsOnlyGuard, the TeacherGate around every teacher route,
 * PortalLayout and its menu): a leader opens the teacher Lesson Plans pages and is not sent away.
 *
 *   coach on portal_coach_v2         the coach bar has Lesson Plans; /portal/teacher/lessons/* opens (picker, viewer)
 *   coach with the coach app off     the same pages open (the leader family passes the gate on the lesson pages)
 *   principal NOT on the teacher app the leader menu has Lesson Plans; the pages open
 *   a teacher on the teacher app     exactly today's page
 *   a leader on All Lesson Plans     not a page for them (it is her own history): sent away, as before
 *
 * Mocked: the HTTP boundary only (services/api answers from a table; FLN's fetch), and the PDF canvas.
 */

type User = { id: string; firstName: string; lastName: string; phoneNumber: string; role: string; analyticsOnly?: boolean };
const state = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  features: {} as Record<string, unknown>,
  gets: [] as string[],
}));

vi.mock("@/portal/services/api", async (orig) => {
  const real = await orig<typeof import("@/portal/services/api")>();
  const answer = (url: string): unknown => {
    if (url === "/me/grade-subjects") return { success: true, combos: [] };
    if (url === "/curriculum/grades") return { success: true, grades: [{ grade: 4, subject_count: 1 }] };
    if (url === "/lp612/grades") return { success: true, grades: [{ grade: 9 }] };
    if (url === "/curriculum/subjects") return { success: true, subjects: [{ subject_key: "math", subject: "Math", lesson_count: 8 }] };
    if (url === "/lp612/subjects") return { success: true, subjects: [{ subject: "Physics", lesson_count: 4 }] };
    if (url === "/lesson-plans/recent") return { success: true, plans: [] };
    if (url === "/lp612/mine") return { success: true, lessons: [] };
    return { success: true };
  };
  const http = {
    get: vi.fn(async (url: string) => { state.gets.push(url); return { data: answer(url) }; }),
    post: vi.fn(async () => ({ data: { success: true } })),
    put: vi.fn(async () => ({ data: { success: true } })),
    patch: vi.fn(async () => ({ data: { success: true } })),
    delete: vi.fn(async () => ({ data: { success: true } })),
  };
  const known: Record<string, unknown> = {
    getMe: vi.fn(async () => {
      if (!state.user) throw Object.assign(new Error("401"), { response: { status: 401 } });
      return { success: true, user: state.user };
    }),
    getDashboard: vi.fn(async () => ({ success: true, user: state.user })),
    getConfig: vi.fn(async () => ({ success: true, features: state.features })),
  };
  const anything = (t: Record<string, unknown>, k: string) => (k in t ? t[k] : vi.fn(async () => ({ success: true })));
  const portal = new Proxy(known, { get: anything });
  // My Patch's numbers: not what these tests are about, and never the network.
  const leader = new Proxy({ getOverview: vi.fn(async () => ({ success: true, overview: null })) } as Record<string, unknown>, { get: anything });
  return {
    ...real,
    default: http,
    portal,
    leader,
    language: { get: vi.fn(async () => ({ language: "en", locked: false })), set: vi.fn(async () => ({ success: true })) },
  };
});
vi.mock("@/portal/components/LessonPlanViewer", () => ({
  default: ({ view }: { view: { title: string } }) => <div data-testid="pdf">{view.title}</div>,
}));

const COACH: User = { id: "c-1", firstName: "Noor", lastName: "", phoneNumber: "923000000002", role: "coach" };
const PRINCIPAL: User = { id: "p-1", firstName: "Sana", lastName: "", phoneNumber: "923000000003", role: "principal" };
const TEACHER: User = { id: "t-1", firstName: "Ayesha", lastName: "", phoneNumber: "923000000001", role: "teacher" };

const VIEW = { source: { lane: "k5", lessonId: "grade_4_math_ch1_seg1", assetKind: "lesson" }, title: "Counting to 100", crumb: "Math · Chap 1" };

function stubMatchMedia() {
  if (window.matchMedia) return;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
}

async function openApp(path: string, user: User, features: Record<string, unknown>, historyState?: unknown) {
  state.user = user;
  state.features = features;
  stubMatchMedia();
  // FLN's door (FlnBand) asks /api/portal/fln/me with fetch: lessons on, so a leader sees the band.
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/portal/fln/me")) {
      return new Response(JSON.stringify({ lessons: true, share: false, role: user.role, ui_lang: "en" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
  }));
  window.history.pushState(historyState ?? null, "", path);
  const { default: App } = await import("@/App");
  render(<App />);
}

const here = () => window.location.pathname;

beforeEach(async () => {
  state.gets.length = 0;
  const { resetCoachV2Memory } = await import("@/portal/coach/useCoachV2");
  const { resetTeacherV2Memory } = await import("@/portal/teacher/useTeacherV2");
  resetCoachV2Memory();
  resetTeacherV2Memory();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("a coach on the coach app (portal_coach_v2)", () => {
  it("opens New lesson plan (every grade) and stays there — not sent to the Training Library", async () => {
    await openApp("/portal/teacher/lessons/new", COACH, { coachV2: true, teacherV2: false });
    await waitFor(() => expect(screen.getByTestId("lessons-new")).toBeTruthy(), { timeout: 10_000 });
    expect(here()).toBe("/portal/teacher/lessons/new");
    // The coach's own bar, with Lesson Plans the current item.
    const bar = screen.getByTestId("teacher-nav");
    const current = bar.querySelector('a[aria-current="page"]');
    expect(current?.textContent).toBe("Lesson Plans");
    expect(current?.getAttribute("href")).toBe("/portal/teacher/lessons");
  }, 30_000);

  it("opens a plan in the viewer and stays there, without the teacher's Start DC observation", async () => {
    await openApp("/portal/teacher/lessons/plan", COACH, { coachV2: true, teacherV2: false }, { usr: { lessonPlan: VIEW }, key: "k1", idx: 0 });
    await waitFor(() => expect(screen.getByTestId("pdf")).toBeTruthy(), { timeout: 10_000 });
    expect(here()).toBe("/portal/teacher/lessons/plan");
    expect(screen.getByRole("heading", { name: "Counting to 100" })).toBeTruthy();
    expect(screen.queryByText("Start DC observation")).toBeNull();
  }, 30_000);

  it("has Lesson Plans in the bar of the Training Library, linking to the Lesson Plans tab", async () => {
    await openApp("/portal/coach/training", COACH, { coachV2: true, teacherV2: false });
    await waitFor(() => expect(screen.getByTestId("teacher-nav")).toBeTruthy(), { timeout: 10_000 });
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Training Library", "Lesson Plans", "My schools", "More"]);
    expect(links[1].getAttribute("href")).toBe("/portal/teacher/lessons");
  }, 30_000);

  it("is still sent away from the teacher's other pages (Home, Digital Coaching)", async () => {
    await openApp("/portal/teacher/coaching", COACH, { coachV2: true, teacherV2: false });
    await waitFor(() => expect(here()).toBe("/portal/coach/training"), { timeout: 10_000 });
  }, 30_000);
});

describe("a leader off the coach app and the teacher app", () => {
  it("a principal NOT on the teacher app: Lesson Plans is in the leader menu, and the tab opens", async () => {
    await openApp("/portal/leader", PRINCIPAL, { coachV2: false, teacherV2: false });
    const link = await waitFor(() => {
      const a = Array.from(document.querySelectorAll("a")).find((x) => x.getAttribute("href") === "/portal/teacher/lessons");
      expect(a).toBeTruthy();
      return a as HTMLAnchorElement;
    }, { timeout: 10_000 });
    expect(link.textContent).toContain("Lesson Plans");
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByText("New lesson plan")).toBeTruthy(), { timeout: 10_000 });
    expect(here()).toBe("/portal/teacher/lessons");
    // Hers is not a teacher's history: no Recent Lesson Plans, and nothing asked for it.
    expect(screen.queryByText("Recent Lesson Plans")).toBeNull();
    expect(state.gets).not.toContain("/lesson-plans/recent");
  }, 30_000);

  it("a coach with the coach app off opens the picker too", async () => {
    await openApp("/portal/teacher/lessons/new", COACH, { coachV2: false, teacherV2: false });
    await waitFor(() => expect(screen.getByTestId("lessons-new")).toBeTruthy(), { timeout: 10_000 });
    expect(here()).toBe("/portal/teacher/lessons/new");
  }, 30_000);

  // bd-a73p5m — a coach's "lesson plan" on WhatsApp now opens /go, which lands on /portal/teacher/lessons itself. A
  // coach is not on the teacher app and may be off the coach app (the classic leader portal): the tab opens there too,
  // with no FLN share (this table's /fln/me answers share: false).
  it.each([
    ["off the coach app (the classic leader portal)", false],
    ["on the coach app", true],
  ])("a coach %s lands on the Lesson Plans tab from the WhatsApp link and stays", async (_l, coachV2) => {
    await openApp("/portal/teacher/lessons", COACH, { coachV2, teacherV2: false });
    await waitFor(() => expect(screen.getByText("New lesson plan")).toBeTruthy(), { timeout: 10_000 });
    expect(here()).toBe("/portal/teacher/lessons");
    expect(screen.queryByText("Recent Lesson Plans")).toBeNull();
  }, 30_000);

  it("All Lesson Plans (a teacher's own history) is not theirs: sent away, as before", async () => {
    await openApp("/portal/teacher/lessons/all", PRINCIPAL, { coachV2: false, teacherV2: false });
    await waitFor(() => expect(here()).not.toBe("/portal/teacher/lessons/all"), { timeout: 10_000 });
  }, 30_000);
});

describe("a teacher on the teacher app: exactly today (golden)", () => {
  it("Lesson Plans: her Recent, under Home", async () => {
    await openApp("/portal/teacher/lessons", TEACHER, { coachV2: false, teacherV2: true });
    await waitFor(() => expect(screen.getByText("Recent Lesson Plans")).toBeTruthy(), { timeout: 10_000 });
    expect(here()).toBe("/portal/teacher/lessons");
    expect(state.gets).toContain("/lesson-plans/recent");
    expect(screen.getByTestId("page-crumb").textContent).toBe("Home");
    const bar = screen.getByTestId("teacher-nav");
    expect(within(bar).getAllByRole("link").map((a) => a.textContent)).toEqual(["Home", "Lesson Plans", "Digital Coaching", "Training", "More"]);
  }, 30_000);
});
