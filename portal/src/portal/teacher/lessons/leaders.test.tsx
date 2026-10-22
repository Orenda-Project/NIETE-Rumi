import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type SharedAuth } from "../../hooks/authContext";

/**
 * bd-4joiqz — the SAME lesson pages, read by a leader (coach, principal off the teacher app, AEO, supervisor, school
 * leader). What is the teacher's own stays the teacher's:
 *
 *   viewer        no Start DC observation, no Thing to try, no Send on WhatsApp (the plan, its answer key and
 *                 Open in another app stay)
 *   Lesson Plans  no Recent / Being made (her history; not even asked for), and it is the leader's TAB: a top-level
 *                 page with no Back into the teacher's Home (which turns a leader away)
 *   Back          every "back to lesson plans" and "not available" target is a page the leader family may open
 *
 * A teacher, and a principal ON the teacher app, see exactly what they saw.
 */

const toast = vi.hoisted(() => vi.fn());
const cfg = vi.hoisted(() => ({ features: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../../components/PortalLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock("../../components/LessonPlanViewer", () => ({
  default: ({ view }: { view: { title: string } }) => <div data-testid="viewer">{view.title}</div>,
}));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: { getConfig: vi.fn(async () => ({ success: true, features: cfg.features })) },
}));

import api from "../../services/api";
import { resetShareAvailability } from "../share/api";
import { resetLessonPlans } from "../../newui/lessons/lessonPlansApi";
import { resetTeacherV2Memory } from "../useTeacherV2";
import { ViewerPage } from "./ViewerPage";
import { LessonsHomePage } from "./LessonsHome";
import lessonRoutes from "./routes";
import { LESSONS_HOME, LESSONS_VIEWER } from "./paths";
import { LESSONS_V2_COPY as C } from "./copy";
import { TEACHER_COPY } from "../copy";
import { FlnNotAvailable, LESSONS_HOME as FLN_LESSONS_HOME } from "../../fln/FlnGate";
import { NEW_LESSON } from "../../fln/listShared";
import { linkBackTarget } from "../../fln/PlanPage";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

const COACH = { firstName: "Noor", lastName: "", phoneNumber: "923000000002", role: "coach" };
const SUPERVISOR = { firstName: "Asad", lastName: "", phoneNumber: "923000000004", role: "supervisor" };
const PRINCIPAL = { firstName: "Sana", lastName: "", phoneNumber: "923000000003", role: "principal" };
const TEACHER = { firstName: "Ayesha", lastName: "", phoneNumber: "923000000001", role: "teacher" };

const VIEW = { source: { lane: "k5", lessonId: "g4m2", assetKind: "lesson" }, title: "Place value", crumb: "Math · Chap 1" };
const DC = { grade: 4, subjectKey: "maths", plan: "k5:g4m2", lang: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetLessonPlans();
  resetShareAvailability();
  resetTeacherV2Memory();
  cfg.features = {};
  http.get.mockImplementation(async (url: string) => {
    if (url === "/teacher/thing-to-try") return { data: { success: true, thing: { text: "Ask why twice", tag: null, step: null } } };
    if (url === "/share/availability") return { data: { kinds: { lesson: true } } };
    if (url === "/lesson-plans/recent") return { data: { success: true, plans: [] } };
    if (url === "/lp612/mine") return { data: { success: true, lessons: [] } };
    return { data: {} };
  });
});
afterEach(() => cleanup());

function renderAs(user: Record<string, unknown> | null, path: string, element: React.ReactElement, state?: unknown) {
  const value: SharedAuth = { user: user as unknown as SharedAuth["user"], loading: false, request: vi.fn() };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const asked = (url: string) => http.get.mock.calls.some(([u]) => u === url);
const flush = () => new Promise((r) => setTimeout(r, 30));

describe("the viewer, for a leader", () => {
  it.each([["a coach", COACH], ["a supervisor", SUPERVISOR]])("%s: the plan, its answer key and Open in another app — none of the teacher's own", async (_n, user) => {
    renderAs(user, LESSONS_VIEWER, <ViewerPage />, { lessonPlan: VIEW, dc: DC });
    expect(screen.getByRole("heading", { name: "Place value" })).toBeTruthy();
    expect(screen.getByTestId("viewer").textContent).toBe("Place value");
    expect(screen.getByRole("button", { name: C.answerKey })).toBeTruthy();
    expect(screen.getByRole("button", { name: C.openOutside })).toBeTruthy();
    await flush();
    expect(screen.queryByRole("link", { name: new RegExp(C.startDc) })).toBeNull();
    expect(screen.queryByText("Ask why twice")).toBeNull();
    expect(screen.queryByText(C.thingToTry)).toBeNull();
    expect(screen.queryByTestId("share-send")).toBeNull();
    // Not even asked: the strip and the template are hers.
    expect(asked("/teacher/thing-to-try")).toBe(false);
  });

  it("a principal NOT on the teacher app is a leader here", async () => {
    cfg.features = { teacherV2: false };
    renderAs(PRINCIPAL, LESSONS_VIEWER, <ViewerPage />, { lessonPlan: VIEW, dc: DC });
    await flush();
    expect(screen.queryByRole("link", { name: new RegExp(C.startDc) })).toBeNull();
    expect(screen.queryByTestId("share-send")).toBeNull();
  });
});

describe("the viewer, for a teacher: exactly today (golden)", () => {
  it.each([["a teacher", TEACHER, {}], ["a principal ON the teacher app", PRINCIPAL, { teacherV2: true }]])(
    "%s: Start DC observation, Thing to try, Send on WhatsApp, answer key, Open in another app",
    async (_n, user, features) => {
      cfg.features = features;
      renderAs(user, LESSONS_VIEWER, <ViewerPage />, { lessonPlan: VIEW, dc: DC });
      await waitFor(() => expect(screen.getByRole("link", { name: new RegExp(C.startDc) })).toBeTruthy());
      expect(await screen.findByText("Ask why twice")).toBeTruthy();
      expect(await screen.findByTestId("share-send")).toBeTruthy();
      expect(screen.getByRole("button", { name: C.answerKey })).toBeTruthy();
      expect(screen.getByRole("button", { name: C.openOutside })).toBeTruthy();
    },
  );
});

describe("Lesson Plans (the main page)", () => {
  it("a leader: their tab — New lesson plan, no Recent or Being made (not asked for), no Back into the teacher's Home", async () => {
    renderAs(COACH, LESSONS_HOME, <LessonsHomePage />);
    expect(screen.getByText(C.newLessonPlan)).toBeTruthy();
    expect(screen.getByRole("heading", { name: C.title })).toBeTruthy();
    await flush();
    expect(screen.queryByText(C.recent)).toBeNull();
    expect(screen.queryByText(C.preparing)).toBeNull();
    expect(asked("/lesson-plans/recent")).toBe(false);
    expect(screen.queryByRole("link", { name: TEACHER_COPY.back })).toBeNull();
    expect(screen.queryByTestId("page-crumb")).toBeNull();
  });

  it("a teacher: exactly today — Home's crumb, Back to her Home, and her Recent Lesson Plans (golden)", async () => {
    renderAs(TEACHER, LESSONS_HOME, <LessonsHomePage />);
    expect(screen.getByText(C.newLessonPlan)).toBeTruthy();
    expect(screen.getByTestId("page-crumb").textContent).toBe(C.home);
    expect(screen.getByRole("link", { name: TEACHER_COPY.back }).getAttribute("href")).toBe("/portal/teacher");
    expect(await screen.findByText(C.recent)).toBeTruthy();
    expect(asked("/lesson-plans/recent")).toBe(true);
  });
});

describe("every way back to the lesson plans lands on a page a leader may open", () => {
  const leaderPaths = lessonRoutes.filter((r) => (r as { leaders?: boolean }).leaders === true).map((r) => r.path);
  const opensForLeaders = (to: string) => leaderPaths.includes(to.split("?")[0]);

  it("the lesson pages a leader reads are open to them; All Lesson Plans (her own history) is not", () => {
    expect(leaderPaths.sort()).toEqual([
      LESSONS_HOME, `${LESSONS_HOME}/chapters`, `${LESSONS_HOME}/lessons`, `${LESSONS_HOME}/new`,
      `${LESSONS_HOME}/open`, `${LESSONS_HOME}/plan`, `${LESSONS_HOME}/preparing`,
    ].sort());
    expect(opensForLeaders(`${LESSONS_HOME}/all`)).toBe(false);
  });

  it("FLN: 'This lesson isn't available' goes back to the Lesson Plans tab", () => {
    render(<MemoryRouter><FlnNotAvailable lang="en" /></MemoryRouter>);
    const back = screen.getByRole("link").getAttribute("href") as string;
    expect(back).toBe(LESSONS_HOME);
    expect(opensForLeaders(back)).toBe(true);
  });

  it("FLN: the list's Back, the plan's 'not available' and a link-opened plan with no subject all land on leader pages", () => {
    for (const to of [NEW_LESSON, FLN_LESSONS_HOME, linkBackTarget(undefined, undefined)]) {
      expect(opensForLeaders(to)).toBe(true);
    }
  });
});
