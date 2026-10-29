/**
 * The School card tests' app (tests only): the REAL guard, gates, flag hooks, pages and menu, with only the network mocked.
 * Each test file mocks axios with `axiosMock()` (vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock()))
 * and fills `net.answers` (a path, or a path with `?period=`) before rendering.
 */
import { vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "i18next";
import { AuthContext, type SharedAuth } from "../../hooks/authContext";

export const net = { answers: new Map<string, unknown>(), calls: [] as string[] };

export function axiosMock() {
  const get = vi.fn((url: string, cfg?: { params?: Record<string, string> }) => {
    const period = cfg?.params?.period;
    const key = period ? `${url}?period=${period}` : url;
    net.calls.push(key);
    const hit = net.answers.has(key) ? net.answers.get(key) : net.answers.get(url);
    if (hit === undefined) return new Promise(() => {});
    if (hit instanceof Error) return Promise.reject(hit);
    return Promise.resolve({ data: hit });
  });
  const never = vi.fn(() => new Promise(() => {}));
  const instance = { get, post: never, put: never, patch: never, delete: never, interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } } };
  return { default: { create: () => instance, ...instance } };
}

export const COACH = { firstName: "Test", lastName: "Coach", phoneNumber: "900000000099", role: "coach" } as SharedAuth["user"];

export const moves: string[] = [];
function Where() {
  const { pathname, search } = useLocation();
  const here = `${pathname}${search}`;
  if (moves[moves.length - 1] !== here) moves.push(here);
  return <p data-testid="where">{pathname}</p>;
}

let loaded: Promise<unknown[]> | null = null;
/** The pages, loaded once per file (after the file's axios mock is in place). Call it in a beforeAll with a long timeout. */
export function loadApp() {
  loaded ??= Promise.all([
    import("../training/CoachAppGuard"), import("./CoachLanding"), import("../pages/CoachPeople"), import("../pages/CoachSchool"),
    import("../pages/CoachTeacher"), import("./FeatureGridPage"), import("./HerItemsPage"), import("./HerReportsPage"), import("./SessionReportPage"),
  ]);
  return loaded;
}

type Page = { default: () => JSX.Element };

/** The coach app's routes that matter here, as App.tsx has them. */
export async function renderApp(entry: string, lang: "en" | "ur" = "en") {
  const [{ default: CoachAppGuard }, { default: CoachLanding }, { default: CoachPeople }, { default: CoachSchool }, { default: CoachTeacher },
    { default: FeatureGridPage }, { default: HerItemsPage }, { default: HerReportsPage }, { default: SessionReportPage }] =
    (await loadApp()) as [{ default: (p: { children: React.ReactNode }) => JSX.Element }, Page, Page, Page, Page, Page, Page, Page, Page];
  if (!i18n.isInitialized) await i18n.init({ lng: lang, resources: {} });
  await act(async () => { await i18n.changeLanguage(lang); });
  const value: SharedAuth = { user: COACH, loading: false, request: vi.fn() };
  const view = render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[entry]}>
        <CoachAppGuard>
          <Where />
          <Routes>
            <Route path="/portal/coach" element={<CoachLanding />} />
            <Route path="/portal/coach/people" element={<CoachPeople />} />
            <Route path="/portal/coach/school/:emis" element={<CoachSchool />} />
            <Route path="/portal/coach/school/:emis/feature/:feature" element={<FeatureGridPage />} />
            <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
            <Route path="/portal/coach/teacher/:ext/items/:feature" element={<HerItemsPage />} />
            <Route path="/portal/coach/teacher/:ext/reports" element={<HerReportsPage />} />
            <Route path="/portal/coach/session/:id" element={<SessionReportPage />} />
            <Route path="/portal/coach/training" element={<p data-testid="training">Training Library page</p>} />
            <Route path="*" element={<p data-testid="other">other page</p>} />
          </Routes>
        </CoachAppGuard>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return view;
}

/** Every in-app link on the screen, without its query string. */
export const linkPaths = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("a[href]")).map((a) => (a.getAttribute("href") || "").split("?")[0]).filter((h) => h.startsWith("/"));

export async function resetAll() {
  const [{ resetCoachV2Memory }, { resetSchoolCardMemory }, { resetCoachipMemory }] = await Promise.all([
    import("../useCoachV2"), import("./useSchoolCard"), import("../insights/useCoachip"),
  ]);
  resetCoachV2Memory(); resetSchoolCardMemory(); resetCoachipMemory();
  net.answers.clear(); net.calls.length = 0; moves.length = 0;
}
