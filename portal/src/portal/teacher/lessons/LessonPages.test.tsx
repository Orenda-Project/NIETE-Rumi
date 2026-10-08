import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans pages INSIDE the feature (v28 canvas: LessonsChapters,
 * LessonsList, LessonPreparing, LessonViewer), built on the kit (ListRow) and on the lesson-plan
 * client every grade already uses (newui/lessons/lessonPlansApi — grades 1–12, one model).
 *
 *   chapters   "Chap" over the number, the title, "p.x-y · N lessons" → that chapter's lessons
 *   lessons    "LP #" over the number; Worksheet / Revision as icons; ✓ Used when it reached her;
 *              a tap OPENS it: ready → the v2 viewer, being written → Preparing
 *   preparing  a countdown while a 6–12 plan is written; opens the viewer by itself (replacing
 *              itself); failed → Try again / Other lessons
 *   viewer     the plan; Start DC observation (option A card) → Digital Coaching with grade·subject
 *              and this plan prefilled; Answer key (grades 1–5); Open in another app — and while a
 *              lesson records, neither Start DC nor Open outside (another app silences the mic)
 */

const toast = vi.hoisted(() => vi.fn());
const recording = vi.hoisted(() => ({ active: false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../components/LessonPlanViewer", () => ({
  default: ({ view }: { view: { title: string } }) => <div data-testid="viewer">{view.title}</div>,
}));
vi.mock("../../lib/recordingSession", () => ({
  useRecordingSession: () => (recording.active ? { active: true } : null),
}));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { ChaptersPage } from "./ChaptersPage";
import { LessonsPage } from "./LessonsPage";
import { PreparingPage } from "./PreparingPage";
import { ViewerPage } from "./ViewerPage";
import lessonRoutes from "./routes";
import { lessonsUrl, LESSONS_VIEWER } from "./paths";
import { featurePath } from "../paths";
import { LESSONS_V2_COPY } from "./copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const C = LESSONS_V2_COPY;

type Answer = (params?: Record<string, unknown>) => unknown;
let routes: Record<string, Answer>;

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  recording.active = false;
  routes = {
    "/curriculum/grades": () => ({ grades: [{ grade: 4, subject_count: 4 }] }),
    "/lp612/grades": () => ({ grades: [{ grade: 9 }] }),
    "/curriculum/subjects": () => ({ subjects: [{ subject_key: "math", subject: "Math", lesson_count: 80 }] }),
    "/lp612/subjects": () => ({ subjects: [{ subject: "Physics", lesson_count: 40 }] }),
    "/curriculum/chapters": () => ({ chapters: [
      { chapter_number: 1, chapter_title: "Numbers", pages_label: "p.1-12", lesson_count: 9 },
      { chapter_number: 2, chapter_title: "Shapes", pages_label: null, lesson_count: 1 },
    ] }),
    "/lp612/chapters": () => ({ chapters: [{ chapter_key: "c02", chapter_number: 2, chapter_title: "Motion", lesson_count: 3 }] }),
    "/curriculum/lps": () => ({ lessons: [
      { lesson_id: "g4m1", lp_type: "content", day_label: "Day 1", topic: "Counting to 100", pages_label: "p.2", downloaded: true },
      { lesson_id: "g4m2", lp_type: "content", day_label: "Day 2", topic: "Place value", pages_label: "p.4", downloaded: false },
      { lesson_id: "g4mw", lp_type: "assessment", day_label: null, topic: "Worksheet", pages_label: null, downloaded: false },
      { lesson_id: "g4mr", lp_type: "revision", day_label: null, topic: "Revision", pages_label: null, downloaded: false },
    ] }),
    "/lp612/lessons": () => ({ lessons: [{ segment_id: "phy9.c02.p010", title: "Speed", pages_label: "p.10", sent: false }] }),
  };
  http.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
    const r = Object.entries(routes).find(([k]) => url === k || url.startsWith(`${k}/`));
    if (!r) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
    return { data: r[1](cfg?.params) };
  });
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where" data-path={loc.pathname} data-search={loc.search} data-state={JSON.stringify(loc.state ?? null)} />;
}

/** The page at its own path only (as App mounts it); anywhere else, nothing — and Where, always. */
function renderAt(path: string, element: React.ReactElement, state?: unknown) {
  const pathname = path.split("?")[0];
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: path.includes("?") ? `?${path.split("?")[1]}` : "", state }]}>
      <Routes>
        <Route path={pathname} element={element} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where");

describe("chapters", () => {
  it("each chapter: Chap over its number, its title, pages · lessons, linking to its lessons", async () => {
    renderAt(lessonsUrl("chapters", { grade: 4, subject: "math", key: "maths" }), <ChaptersPage />);
    const row = await screen.findByRole("link", { name: /Numbers/ });
    expect(within(row).getByText(C.chapterPrefix)).toBeTruthy();
    expect(within(row).getByText("1")).toBeTruthy();
    expect(within(row).getByText(`p.1-12 · ${C.lessonsCount(9)}`)).toBeTruthy();
    expect(row.getAttribute("href")).toBe(lessonsUrl("lessons", { grade: 4, subject: "math", key: "maths", chapter: "1" }));
    expect(screen.getByRole("link", { name: /Shapes/ }).textContent).toContain(C.lessonsCount(1));
  });

  it("the heading: Grade over the subject's own name", async () => {
    renderAt(lessonsUrl("chapters", { grade: 4, subject: "math" }), <ChaptersPage />);
    expect(await screen.findByRole("heading", { name: "Math" })).toBeTruthy();
    expect(screen.getByText(C.grade(4))).toBeTruthy();
  });

  it("a load that fails says so, with Try again", async () => {
    routes["/curriculum/chapters"] = () => { throw new Error("down"); };
    renderAt(lessonsUrl("chapters", { grade: 4, subject: "math" }), <ChaptersPage />);
    expect(await screen.findByText(C.loadFailed)).toBeTruthy();
    const asked = http.get.mock.calls.filter(([u]) => u === "/curriculum/chapters").length;
    fireEvent.click(screen.getByRole("button", { name: C.tryAgain }));
    await waitFor(() => expect(http.get.mock.calls.filter(([u]) => u === "/curriculum/chapters").length).toBe(asked + 1));
  });
});

describe("lessons", () => {
  const AT = { grade: 4, subject: "math", key: "maths", chapter: "1" };

  it("LP # over the number; Worksheet and Revision as icons; Used when it reached her", async () => {
    renderAt(lessonsUrl("lessons", AT), <LessonsPage />);
    const first = await screen.findByRole("button", { name: /Counting to 100/ });
    expect(within(first).getByText(C.lessonPrefix)).toBeTruthy();
    expect(within(first).getByText("1")).toBeTruthy();
    expect(within(first).getByText("Used")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /Place value/ })).queryByText("Used")).toBeNull();
    const ws = screen.getByRole("button", { name: new RegExp(C.worksheet) });
    expect(ws.querySelector('[data-icon="worksheet"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(C.revision) }).querySelector('[data-icon="revision"]')).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Numbers" })).toBeTruthy();
  });

  it("a grades 1–5 tap opens the v2 viewer with the plan and the DC prefill", async () => {
    renderAt(lessonsUrl("lessons", AT), <LessonsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Place value/ }));
    await waitFor(() => expect(where().dataset.path).toBe(LESSONS_VIEWER));
    const state = JSON.parse(where().dataset.state as string);
    expect(state.lessonPlan).toEqual(expect.objectContaining({
      source: { lane: "k5", lessonId: "g4m2", assetKind: "lesson" }, title: "Place value",
    }));
    expect(state.dc).toEqual({ grade: 4, subjectKey: "maths", plan: "k5:g4m2", lang: null });
  });

  it("a grades 6–12 plan being written goes to Preparing", async () => {
    http.post.mockResolvedValue({ data: { state: "authoring", renderId: "R9" } });
    const at = { grade: 9, subject: "Physics", key: "physics", chapter: "c02" };
    renderAt(lessonsUrl("lessons", at), <LessonsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Speed/ }));
    await waitFor(() => expect(where().dataset.path).toBe(`${lessonsUrl("preparing", at).split("?")[0]}`));
    const q = new URLSearchParams(where().dataset.search);
    expect([q.get("lesson"), q.get("render"), q.get("chapter")]).toEqual(["phy9.c02.p010", "R9", "c02"]);
  });

  it("held back: said, and nothing opens", async () => {
    http.post.mockRejectedValue(Object.assign(new Error("403"), { response: { status: 403 } }));
    renderAt(lessonsUrl("lessons", { grade: 9, subject: "Physics", chapter: "c02" }), <LessonsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Speed/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: C.notAvailable })));
    expect(where().dataset.path).not.toBe(LESSONS_VIEWER);
  });
});

describe("preparing", () => {
  const AT = { grade: 9, subject: "Physics", key: "physics", chapter: "c02", lesson: "phy9.c02.p010", render: "R9" };

  it("written: opens the viewer by itself, in place of this page, with the DC prefill", async () => {
    routes["/lp612/status"] = () => ({ state: "ready" });
    renderAt(lessonsUrl("preparing", AT), <PreparingPage />);
    expect(screen.getByText(C.preparing)).toBeTruthy();
    await waitFor(() => expect(where().dataset.path).toBe(LESSONS_VIEWER), { timeout: 5000 });
    const state = JSON.parse(where().dataset.state as string);
    expect(state.lessonPlan.source).toEqual({ lane: "g612", renderId: "R9" });
    expect(state.dc).toEqual({ grade: 9, subjectKey: "physics", plan: "g612:phy9.c02.p010", lang: "en" });
  }, 8000);

  it("failed: says so, with Try again and Other lessons", async () => {
    routes["/lp612/status"] = () => ({ state: "failed" });
    renderAt(lessonsUrl("preparing", AT), <PreparingPage />);
    expect(await screen.findByText(C.notPrepared, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: C.tryAgain })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: C.otherLessons }));
    expect(where().dataset.search).toContain("chapter=c02");
  }, 8000);
});

describe("viewer", () => {
  const VIEW = { source: { lane: "k5", lessonId: "g4m2", assetKind: "lesson" }, title: "Place value", crumb: "Math · Chap 1" };
  const DC = { grade: 4, subjectKey: "maths", plan: "k5:g4m2", lang: null };

  it("the plan, under its title; Start DC observation → Digital Coaching with grade, subject and this plan", () => {
    renderAt(LESSONS_VIEWER, <ViewerPage />, { lessonPlan: VIEW, dc: DC });
    expect(screen.getByRole("heading", { name: "Place value" })).toBeTruthy();
    expect(screen.getByTestId("viewer").textContent).toBe("Place value");
    const dc = screen.getByRole("link", { name: new RegExp(C.startDc) });
    const url = new URL(dc.getAttribute("href") as string, "https://x");
    // The v2 Digital Coaching hub (registered: #1987/#1992), reached through the routes registry —
    // never today's /portal/coaching, which would drop her into the old flow without the prefill.
    expect(url.pathname).toBe(featurePath("coaching"));
    expect(url.pathname).toBe("/portal/teacher/coaching");
    expect(Object.fromEntries(url.searchParams)).toEqual({ grade: "4", subject: "maths", plan: "k5:g4m2" });
    expect(screen.getByRole("button", { name: C.answerKey })).toBeTruthy();
    expect(screen.getByRole("button", { name: C.openOutside })).toBeTruthy();
  });

  it("grades 6–12: the plan's language rides along; no answer key", () => {
    renderAt(LESSONS_VIEWER, <ViewerPage />, {
      lessonPlan: { source: { lane: "g612", renderId: "R9" }, title: "Speed" },
      dc: { grade: 9, subjectKey: "physics", plan: "g612:phy9.c02.p010", lang: "en" },
    });
    const url = new URL(screen.getByRole("link", { name: new RegExp(C.startDc) }).getAttribute("href") as string, "https://x");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(screen.queryByRole("button", { name: C.answerKey })).toBeNull();
  });

  it("while a lesson records: no Start DC observation, no Open in another app", () => {
    recording.active = true;
    renderAt(LESSONS_VIEWER, <ViewerPage />, { lessonPlan: VIEW, dc: DC });
    expect(screen.queryByRole("link", { name: new RegExp(C.startDc) })).toBeNull();
    expect(screen.queryByRole("button", { name: C.openOutside })).toBeNull();
    expect(screen.getByTestId("viewer")).toBeTruthy();
  });

  it("answer key opens in the same viewer, keeping the DC prefill", async () => {
    renderAt(LESSONS_VIEWER, <ViewerPage />, { lessonPlan: VIEW, dc: DC });
    fireEvent.click(screen.getByRole("button", { name: C.answerKey }));
    await waitFor(() => expect(JSON.parse(where().dataset.state as string).lessonPlan.source.assetKind).toBe("answer_key"));
    expect(JSON.parse(where().dataset.state as string).dc).toEqual(DC);
  });
});

describe("routes", () => {
  it("registers the inner pages (the main page and open: LessonsHome.test.tsx)", () => {
    const paths = lessonRoutes.map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining([
      lessonsUrl("chapters", { grade: 1, subject: "x" }).split("?")[0],
      lessonsUrl("lessons", { grade: 1, subject: "x" }).split("?")[0],
      lessonsUrl("preparing", { grade: 1, subject: "x" }).split("?")[0],
      LESSONS_VIEWER,
    ]));
  });
});
