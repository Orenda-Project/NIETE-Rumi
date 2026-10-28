import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "i18next";
import { AuthContext, type SharedAuth } from "../../hooks/authContext";

/**
 * A coach on the coach app v2 has a school list: "My schools" in the menu opens the Schools & teachers pages, a school
 * opens, a teacher opens, and nothing on those pages leads to a page the coach app is not showing yet (the guard
 * would send it to the Training Library — a tap that goes somewhere else is a broken button).
 *
 * Only the network (axios) is mocked: the real guard, gate, flag hooks, pages and menu run.
 */

const SCHOOL = { schoolExtId: "niete:SCH-1", emis: "E-100", name: "Model School One", teachers: 1, visits: 2, daysSinceVisit: 9, avgHitl: 61 };
const TEACHER = {
  teacherExtId: "T-1", name: "Teacher One", phone: null, schoolName: SCHOOL.name, emis: SCHOOL.emis, schoolExtId: SCHOOL.schoolExtId,
  hitl: 2, dc: 1, avgHitl: 61, daysSinceVisit: 9, daysSinceTraining: 3, trainingModules: 2, examsGenerated: 1, lpOpened: 4,
};
const ANSWERS: Record<string, unknown> = {
  "/config": { success: true, features: { coachV2: true } },
  "/coach/people": { success: true, schools: [SCHOOL], teachers: [TEACHER] },
  [`/coach/school/${SCHOOL.emis}`]: { success: true, school: SCHOOL, teachers: [TEACHER] },
  [`/coach/teacher/${TEACHER.teacherExtId}`]: {
    success: true, teacher: TEACHER, nextVisit: null,
    history: [
      { id: "obs-1", date: "2026-10-20T05:00:00Z", kind: "HITL", score: 61, step: null, open: "report" },
      { id: "dc-1", date: "2026-10-12T05:00:00Z", kind: "DC", score: 55 },
    ],
  },
  // two reports waiting on the coach: the pending banner has something to say
  "/coach/pending": { success: true, waiting: 2, ids: ["obs-1", "obs-2"] },
};

vi.mock("axios", () => {
  const get = vi.fn((url: string) => (url in ANSWERS ? Promise.resolve({ data: ANSWERS[url] }) : new Promise(() => {})));
  const instance = {
    get,
    post: vi.fn(() => new Promise(() => {})),
    put: vi.fn(() => new Promise(() => {})),
    delete: vi.fn(() => new Promise(() => {})),
    interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } },
  };
  return { default: { create: () => instance } };
});

import CoachAppGuard from "../training/CoachAppGuard";
import { COACH_APP_READY, coachPathReady } from "../training/appReady";
import { resetCoachV2Memory } from "../useCoachV2";
import TeacherNavigation from "../../teacher/TeacherNavigation";
import { TEACHER_COPY_UR } from "../../teacher/copy";
import CoachPeople from "../pages/CoachPeople";
import CoachSchool from "../pages/CoachSchool";
import CoachTeacher from "../pages/CoachTeacher";

const coach = { firstName: "Test", lastName: "Coach", phoneNumber: "923000000000", role: "coach" } as SharedAuth["user"];

const moves: string[] = [];
function Where() {
  const { pathname } = useLocation();
  if (moves[moves.length - 1] !== pathname) moves.push(pathname);
  return <p data-testid="where">{pathname}</p>;
}

function renderAt(entry: string) {
  const value: SharedAuth = { user: coach, loading: false, request: vi.fn() };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[entry]}>
        <CoachAppGuard>
          <Where />
          <Routes>
            <Route path="/portal/coach/people" element={<CoachPeople />} />
            <Route path="/portal/coach/school/:emis" element={<CoachSchool />} />
            <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
            <Route path="*" element={<p data-testid="other">other page</p>} />
          </Routes>
        </CoachAppGuard>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

/** Every in-app link on the screen, without its query string. */
const linkPaths = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("a[href]")).map((a) => (a.getAttribute("href") || "").split("?")[0]).filter((h) => h.startsWith("/"));

beforeEach(async () => {
  moves.length = 0;
  resetCoachV2Memory();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("a v2 coach's school pages are open", () => {
  it.each([
    "/portal/coach/people", "/portal/coach/people?tab=teachers", `/portal/coach/school/${SCHOOL.emis}`,
    `/portal/coach/teacher/${TEACHER.teacherExtId}`, "/portal/coach/schools/add", "/portal/coach/add-teacher",
    `/portal/coach/school/${SCHOOL.emis}/add-teacher`, `/portal/coach/school/${SCHOOL.emis}/remove-teachers`,
    `/portal/coach/teacher/${TEACHER.teacherExtId}/edit`,
  ])("the guard lets %s through", async (entry) => {
    renderAt(entry);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByTestId("where")).toHaveTextContent(entry.split("?")[0]);
    expect(moves).toEqual([entry.split("?")[0]]);
  });

  it.each(["/portal/coach", "/portal/coach/new-visit", "/portal/coach/scheduling", "/portal/coach/observe", "/portal/coach/observation/obs-1", "/portal/coach/reports"])(
    "what is still not ready stays shut: %s goes to the Training Library", async (entry) => {
      renderAt(entry);
      await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/training"));
    },
  );
});

describe("the school pages lead only to pages the coach app shows", () => {
  it.each([
    ["the school list", "/portal/coach/people", SCHOOL.name],
    ["the teachers tab", "/portal/coach/people?tab=teachers", TEACHER.name],
    ["a school", `/portal/coach/school/${SCHOOL.emis}`, TEACHER.name],
    ["a teacher", `/portal/coach/teacher/${TEACHER.teacherExtId}`, TEACHER.name],
  ])("%s: it loads, and every link on it opens", async (_l, entry, shows) => {
    const { container } = renderAt(entry);
    await waitFor(() => expect(screen.getAllByText(shows as string).length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const paths = linkPaths(container);
    expect(paths.length).toBeGreaterThan(0);
    const shut = paths.filter((p) => !coachPathReady(p, COACH_APP_READY));
    expect(shut, `links the coach app would turn away: ${shut.join(", ")}`).toEqual([]);
    // and the page never moved by itself
    expect(moves).toEqual([(entry as string).split("?")[0]]);
  });

  it("the school list opens a school", async () => {
    const { container } = renderAt("/portal/coach/people");
    await waitFor(() => expect(screen.getAllByText(SCHOOL.name).length).toBeGreaterThan(0));
    expect(linkPaths(container)).toContain(`/portal/coach/school/${SCHOOL.emis}`);
  });
});

describe("My schools is in the coach app's menu", () => {
  const menu = (path = "/portal/coach/training") =>
    render(<MemoryRouter initialEntries={[path]}><TeacherNavigation role="coach" ready={COACH_APP_READY} /></MemoryRouter>);

  it("after Training Library and Lesson Plans, before More; Training Library stays first", () => {
    menu();
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Training Library", "Lesson Plans", "My schools", "More"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/training", "/portal/teacher/lessons", "/portal/coach/people", "/portal/coach/more"]);
  });

  it.each(["/portal/coach/people", `/portal/coach/school/${SCHOOL.emis}`, `/portal/coach/teacher/${TEACHER.teacherExtId}`, "/portal/coach/schools/add"])(
    "My schools is current on %s", (p) => {
      menu(p);
      expect(screen.getByTestId("teacher-nav").querySelector('a[aria-current="page"]')?.textContent).toBe("My schools");
    },
  );

  it("in Urdu: «میرے سکول»", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    menu();
    expect(TEACHER_COPY_UR.coachNav.schools).toBe("میرے سکول");
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["ٹریننگ لائبریری", "لیسن پلان", "میرے سکول", "مزید"]);
  });
});
