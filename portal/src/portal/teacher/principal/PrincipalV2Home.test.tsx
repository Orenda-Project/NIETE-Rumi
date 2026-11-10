import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() }, portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import api, { portal } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { AuthContext } from "../../hooks/authContext";
import { noticeTracker } from "../notices/tracker";
import { forgetConfig } from "../../lib/useNewUi";
import { resetHomeMemo } from "../home/api";
import { resetHomeLookMemory, resetHomeOrderMemory } from "../home/useHomeData";
import i18n from "@/i18n/config";
import Home from "../pages/Home";
import TeacherNavigation from "../TeacherNavigation";
import { currentPrincipalMenuItem } from "../menu";
import { teacherPath } from "../routes";
import { TEACHER_COPY_UR } from "../copy";

/**
 * bd-33wxxi.9.1 — the principal app v2 Home and phone bar (#78; the operator, 10 Nov: "we like C"). For a principal on
 * the principal app only:
 *   Home   option C, today's small tiles reordered: Observations, Attendance, Analytics first, then Lesson Plans (Quizzes
 *          after it), Assessment, Training, My Classes. No Digital Coaching tile ("My own lesson" is on Observe now).
 *   bar    Home · Observe · Lesson Plans · Training · More; Observe is current on Observations, Digital Coaching and the
 *          principal's own observe screens.
 * A teacher, and a principal the switch does not name, keep today's Home and bar exactly.
 */
const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-1", schoolName: "GGPS Sample" };
const TEACHER = { ...PRINCIPAL, firstName: "Amina Sample", role: "teacher", phoneNumber: "test-teacher-1" };
const LOOK = { teacherHomeCard: true, teacherHomeLook: true, teacherV2: true };
const HOME = { success: true, now: new Date().toISOString(), order: null, orderOn: false, card: null, scores: { coach: null, observation: null }, quizHome: null };
const TODAY_TILES = ["Lesson Plans", "Digital Coaching", "Observations", "Training", "Assessment", "Attendance", "My Classes", "Analytics"];

function serve({ features = { ...LOOK, principalApp: true } as Record<string, unknown>, home = HOME as Record<string, unknown> } = {}) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: home });
    if (url === "/principal/school/card") return Promise.resolve({ data: { success: true, school: null } });
    return Promise.resolve({ data: { success: true, items: [] } });
  }) as never);
}

function renderHome(user: typeof PRINCIPAL) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={["/portal/teacher"]}>
      <Routes><Route path="/portal/teacher" element={<Home />} /></Routes>
    </MemoryRouter>,
  );
}

function renderBar(user: typeof PRINCIPAL, path: string) {
  return render(
    <AuthContext.Provider value={{ user, loading: false } as never}>
      <MemoryRouter initialEntries={[path]}><TeacherNavigation /></MemoryRouter>
    </AuthContext.Provider>,
  );
}

const tileWords = async () => {
  const nav = await screen.findByTestId("feature-tiles");
  // a feature tile is a link; the Quizzes tile is a button (it logs its tap, then opens the quiz home)
  return Array.from(nav.querySelectorAll("a, button")).map((a) => a.textContent?.trim());
};
const barWords = () => Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a")).map((a) => a.textContent);

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  noticeTracker.reset();
  forgetConfig();
  resetHomeMemo();
  resetHomeOrderMemory();
  resetHomeLookMemory();
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("the principal app v2 Home (option C)", () => {
  it("a principal on the app: Observations, Attendance, Analytics first; no Digital Coaching tile", async () => {
    serve();
    renderHome(PRINCIPAL);
    await screen.findByTestId("home-my-school");
    await waitFor(async () => expect(await tileWords()).toEqual(
      ["Observations", "Attendance", "Analytics", "Lesson Plans", "Assessment", "Training", "My Classes"],
    ));
    const nav = screen.getByTestId("feature-tiles");
    expect(within(nav).queryByText("Digital Coaching")).toBeNull();
    // Observations opens the Observe page (the principal's Observations)
    expect(within(nav).getByText("Observations").closest("a")?.getAttribute("href")).toBe(teacherPath("observations"));
  });

  it("with the Quizzes tile: right after Lesson Plans, as for a teacher", async () => {
    serve({ home: { ...HOME, quizTile: true, quizHome: "/quiz/teacher/tok" } });
    renderHome(PRINCIPAL);
    await screen.findByTestId("home-my-school");
    await waitFor(async () => expect(await tileWords()).toEqual(
      ["Observations", "Attendance", "Analytics", "Lesson Plans", "Quizzes", "Assessment", "Training", "My Classes"],
    ));
  });

  it("the server's order never reorders a principal's tiles", async () => {
    serve({ home: { ...HOME, orderOn: true, order: ["training", "lessons", "coaching", "observations", "assessment", "attendance", "classes", "analytics"] } });
    renderHome(PRINCIPAL);
    await screen.findByTestId("home-my-school");
    await waitFor(async () => expect((await tileWords())[0]).toBe("Observations"));
  });

  it("a teacher's Home keeps today's eight tiles in today's order", async () => {
    serve({ features: LOOK });
    renderHome(TEACHER);
    await waitFor(async () => expect(await tileWords()).toEqual(TODAY_TILES));
  });

  it("a principal the switch does not name keeps today's tiles", async () => {
    serve({ features: { ...LOOK, principalApp: false } });
    renderHome(PRINCIPAL);
    await waitFor(async () => expect(await tileWords()).toEqual(TODAY_TILES));
  });
});

describe("the principal app v2 phone bar", () => {
  it("a principal on the app: Home · Observe · Lesson Plans · Training · More, with their pages", async () => {
    serve();
    renderBar(PRINCIPAL, "/portal/teacher");
    await waitFor(() => expect(barWords()).toEqual(["Home", "Observe", "Lesson Plans", "Training", "More"]));
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      [teacherPath("home"), teacherPath("observations"), teacherPath("lessons"), teacherPath("training"), teacherPath("more")],
    );
    const glyphs = screen.getByTestId("teacher-nav").querySelectorAll("svg[data-glyph]");
    expect(Array.from(glyphs).map((g) => g.getAttribute("data-glyph"))).toEqual(["home", "observations", "lessons", "training", "more"]);
    // the desk bar has the same items
    expect(Array.from(screen.getByTestId("teacher-top-nav").querySelectorAll("a")).map((a) => a.textContent))
      .toEqual(["Home", "Observe", "Lesson Plans", "Training", "More"]);
  });

  it("Observe is current on Observations, Digital Coaching and her own observe screens", async () => {
    for (const p of ["/portal/teacher/observations", "/portal/teacher/coaching", "/portal/teacher/coaching/new", "/portal/teacher/coaching/report/9",
      "/portal/teacher/principal/pick", "/portal/teacher/principal/visit/t-1", "/portal/teacher/principal/observe/t-1/record", "/portal/teacher/principal/observation/5"]) {
      expect(currentPrincipalMenuItem(p)).toBe("observe");
    }
    expect(currentPrincipalMenuItem("/portal/teacher")).toBe("home");
    expect(currentPrincipalMenuItem("/portal/teacher/lessons/12")).toBe("lessons");
    expect(currentPrincipalMenuItem("/portal/teacher/training")).toBe("training");
    expect(currentPrincipalMenuItem("/portal/teacher/analytics")).toBe("more");
    expect(currentPrincipalMenuItem("/portal/teacher/attendance")).toBe("more");
    serve();
    renderBar(PRINCIPAL, "/portal/teacher/principal/pick");
    await waitFor(() => expect(screen.getByTestId("teacher-nav").querySelector('a[aria-current="page"]')?.textContent).toBe("Observe"));
  });

  it("in Urdu: the coach's Observe word", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    serve();
    renderBar(PRINCIPAL, "/portal/teacher");
    await waitFor(() => expect(barWords()[1]).toBe(TEACHER_COPY_UR.coachNav.observe));
  });

  it("a teacher's bar is unchanged and /config is not read for it", async () => {
    serve({ features: LOOK });
    renderBar(TEACHER, "/portal/teacher/observations");
    expect(barWords()).toEqual(["Home", "Lesson Plans", "Digital Coaching", "Training", "More"]);
    // Observations stays Home's for a teacher
    expect(screen.getByTestId("teacher-nav").querySelector('a[aria-current="page"]')?.textContent).toBe("Home");
  });

  it("a principal the switch does not name keeps the teacher's bar", async () => {
    serve({ features: { ...LOOK, principalApp: false } });
    renderBar(PRINCIPAL, "/portal/teacher");
    await act(async () => { await Promise.resolve(); });
    expect(barWords()).toEqual(["Home", "Lesson Plans", "Digital Coaching", "Training", "More"]);
  });
});
