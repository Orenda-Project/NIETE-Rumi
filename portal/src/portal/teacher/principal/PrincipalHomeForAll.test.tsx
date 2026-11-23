import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
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
import { PrincipalObserve } from "./observe";
import { usePrincipalApp, usePrincipalObserve, usePrincipalObserveState } from "./usePrincipalApp";
import { OBS_HOME } from "../observations/paths";
import { currentPrincipalMenuItem } from "../menu";

/**
 * bd-33wxxi.11 (queue #236, option B; the operator, 23 Nov: "principals should get the new portal without the HITL
 * because that is not ready yet"). /config now answers two things for a principal:
 *
 *   principalApp       every principal (no switch): the principal Home — her Principal chip, My school card, her tiles,
 *                      her bar, Analytics → My school
 *   principalObserve   portal_principal_app names her: observing in the app — the Observations tile and the Observe
 *                      item, her observe screens, the v6 Home
 *
 * A principal with the Home and not observe: the principal Home with no Observations tile and no Observe item; her
 * observe screens send her to Observations, as for anyone the switch does not name. With both: exactly as before.
 */
const PRINCIPAL = { firstName: "Saima Sample", lastName: null, role: "principal", phoneNumber: "test-principal-1", schoolName: "GGPS Sample" };
const TEACHER = { ...PRINCIPAL, firstName: "Amina Sample", role: "teacher", phoneNumber: "test-teacher-1" };
const LOOK = { teacherHomeCard: true, teacherHomeLook: true, teacherV2: true };
const HOME_ONLY = { ...LOOK, principalApp: true, principalObserve: false };
const BOTH = { ...LOOK, principalApp: true, principalObserve: true };
const HOME = { success: true, now: new Date().toISOString(), order: null, orderOn: false, card: null, scores: { coach: null, observation: null }, quizHome: null };

function serve(features: Record<string, unknown>) {
  vi.mocked(portal.getConfig).mockResolvedValue({ features } as never);
  vi.mocked(api.get).mockImplementation(((url: string) => {
    if (url === "/me/home") return Promise.resolve({ data: HOME });
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

function renderBar(user: typeof PRINCIPAL, path = "/portal/teacher") {
  return render(
    <AuthContext.Provider value={{ user, loading: false } as never}>
      <MemoryRouter initialEntries={[path]}><TeacherNavigation /></MemoryRouter>
    </AuthContext.Provider>,
  );
}

const tileWords = async () => {
  const nav = await screen.findByTestId("feature-tiles");
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

describe("the principal Home for every principal (no switch)", () => {
  it("Home only: the Principal chip and My school card, her tiles without Observations", async () => {
    serve(HOME_ONLY);
    renderHome(PRINCIPAL);
    const band = await screen.findByTestId("home-band");
    await waitFor(() => expect(within(band).getByText("Principal")).toBeTruthy());
    await screen.findByTestId("home-my-school");
    await waitFor(async () => expect(await tileWords()).toEqual(
      ["Attendance", "Analytics", "Lesson Plans", "Assessment", "Training", "My Classes"],
    ));
    expect(within(screen.getByTestId("feature-tiles")).queryByText("Observations")).toBeNull();
    expect(within(screen.getByTestId("feature-tiles")).queryByText("Digital Coaching")).toBeNull();
  });

  it("Home and observe (the switch names her): Observations first, exactly as before", async () => {
    serve(BOTH);
    renderHome(PRINCIPAL);
    await screen.findByTestId("home-my-school");
    await waitFor(async () => expect(await tileWords()).toEqual(
      ["Observations", "Attendance", "Analytics", "Lesson Plans", "Assessment", "Training", "My Classes"],
    ));
  });

  it("the coach's v6 flow switch alone never gives a principal the v6 (observe) Home", async () => {
    serve({ ...HOME_ONLY, coachFlowV2: true, coachFullApp: true });
    renderHome(PRINCIPAL);
    await screen.findByTestId("home-my-school");
    await screen.findByTestId("feature-tiles");
    expect(screen.queryByTestId("principal-home-v6")).toBeNull();
  });

  it("Home only: the bar is Home · Lesson Plans · Training · More", async () => {
    serve(HOME_ONLY);
    renderBar(PRINCIPAL);
    await waitFor(() => expect(barWords()).toEqual(["Home", "Lesson Plans", "Training", "More"]));
  });

  it("Home and observe: Home · Observe · Lesson Plans · Training · More, as before", async () => {
    serve(BOTH);
    renderBar(PRINCIPAL);
    await waitFor(() => expect(barWords()).toEqual(["Home", "Observe", "Lesson Plans", "Training", "More"]));
  });

  it("without Observe, a page that Observe would hold leaves Home current", () => {
    expect(currentPrincipalMenuItem("/portal/teacher/observations", { observe: false })).toBe("home");
    expect(currentPrincipalMenuItem("/portal/teacher/coaching", { observe: false })).toBe("home");
    expect(currentPrincipalMenuItem("/portal/teacher/observations")).toBe("observe");
  });

  it("a teacher keeps today's bar", async () => {
    serve(LOOK);
    renderBar(TEACHER);
    await waitFor(() => expect(barWords()).toEqual(["Home", "Lesson Plans", "Digital Coaching", "Training", "More"]));
  });
});

describe("the two answers, from /config", () => {
  const as = (user: typeof PRINCIPAL) => vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);

  it("Home only: principalApp yes, principalObserve no", async () => {
    serve(HOME_ONLY);
    const app = renderHook(() => usePrincipalApp(PRINCIPAL));
    const observe = renderHook(() => usePrincipalObserveState(PRINCIPAL));
    await waitFor(() => expect(app.result.current).toBe(true));
    await waitFor(() => expect(observe.result.current).toBe(false));
  });

  it("observe: only a real true, and never for a teacher", async () => {
    serve({ ...LOOK, principalObserve: true });
    const t = renderHook(() => usePrincipalObserve(TEACHER));
    const p = renderHook(() => usePrincipalObserve(PRINCIPAL));
    await waitFor(() => expect(p.result.current).toBe(true));
    expect(t.result.current).toBe(false);
  });

  it("her observe screens send a Home-only principal to Observations", async () => {
    serve(HOME_ONLY);
    as(PRINCIPAL);
    render(
      <MemoryRouter initialEntries={["/portal/teacher/principal/pick"]}>
        <Routes>
          <Route path="/portal/teacher/principal/pick" element={<PrincipalObserve><div>pick a teacher</div></PrincipalObserve>} />
          <Route path={OBS_HOME} element={<div>observations page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("observations page");
    expect(screen.queryByText("pick a teacher")).toBeNull();
  });

  it("…and open for a principal the switch names", async () => {
    serve(BOTH);
    as(PRINCIPAL);
    render(
      <MemoryRouter initialEntries={["/portal/teacher/principal/pick"]}>
        <Routes>
          <Route path="/portal/teacher/principal/pick" element={<PrincipalObserve><div>pick a teacher</div></PrincipalObserve>} />
          <Route path={OBS_HOME} element={<div>observations page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("pick a teacher");
  });
});
