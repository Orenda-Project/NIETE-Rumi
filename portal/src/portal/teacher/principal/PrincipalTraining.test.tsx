import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * bd-v04lsh (queue #257) — Principal Training. The operator, 24 Nov 2026: "Coach Trainings needs to go live for Principal
 * as well. Showing as Principal Training. Same feature, same trainings."
 *
 *   list     /portal/teacher/principal-training: "Principal Training" («ہیڈ ٹیچر ٹریننگ»), the coach's ten modules in the
 *            coach's order and words, her own "N of 10 done" (the same progress API, her own row)
 *   module   /portal/teacher/principal-training/<n>: PDF or Video (the same pages), Mark done / Mark not done
 *   who      a principal, on the principal app or not (68 prod principals are on My Patch); a coach who lands here goes
 *            to her own Coach Training; a teacher goes Home
 *   back     the principal's own Home: the teacher app's Home when she is on it, else My Patch
 */

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
// the real module (main's principal routes register a native plugin at import), never on a phone here
vi.mock("@capacitor/core", async (orig) => {
  const real = await orig<typeof import("@capacitor/core")>();
  return { ...real, Capacitor: { ...real.Capacitor, isNativePlatform: () => false } };
});
const progress = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../../services/api", async (orig) => ({
  ...(await orig<typeof import("../../services/api")>()),
  portal: { getConfig: vi.fn() },
  language: { get: vi.fn(), set: vi.fn() },
  coach: { getCoachTrainingProgress: progress.get, setCoachModuleDone: progress.set },
}));

import { portal } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { forgetConfig } from "../../lib/useNewUi";
import { resetTeacherV2Memory } from "../useTeacherV2";
import i18n from "@/i18n/config";
import { COACH_MODULES, COACH_TRAINING_PATH } from "../../coach/coachTraining/modules";
import { PRINCIPAL_TRAINING_PATH, PRINCIPAL_MODULE_PATH, trainingListPath, trainingModulePath } from "../../coach/coachTraining/audience";
import { PrincipalTrainingPage, PrincipalTrainingModulePage } from "./training";
import principalRoutes from "./routes";
import { currentPrincipalMenuItem } from "../menu";
import { teacherPath } from "../routes";

vi.setConfig({ testTimeout: 30_000 });

const PRINCIPAL = { firstName: "Saima Sample", role: "principal", phoneNumber: "test-principal-pt" };
const COACH = { firstName: "Noor Sample", role: "coach", phoneNumber: "test-coach-pt" };
const TEACHER = { firstName: "Amina Sample", role: "teacher", phoneNumber: "test-teacher-pt" };

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function at(path: string, user: Record<string, unknown>, features: Record<string, unknown> = { teacherV2: true, principalApp: true }) {
  vi.mocked(portal.getConfig).mockResolvedValue({ success: true, features } as never);
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path={PRINCIPAL_TRAINING_PATH} element={<PrincipalTrainingPage />} />
        <Route path={PRINCIPAL_MODULE_PATH} element={<PrincipalTrainingModulePage />} />
        <Route path="*" element={<p data-testid="elsewhere">elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  forgetConfig();
  resetTeacherV2Memory();
  progress.get.mockReset().mockResolvedValue({ success: true, done: { praise: "2026-11-20T10:00:00.000Z", one: "2026-11-21T10:00:00.000Z" } });
  progress.set.mockReset();
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the Principal Training list: the coach's ten modules, under the principal's own name", () => {
  it("English: Principal Training, the ten modules in the coach's order and words, and her own count", async () => {
    at(PRINCIPAL_TRAINING_PATH, PRINCIPAL);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Principal Training");
    const rows = await screen.findAllByTestId("coach-module");
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.textContent)).toEqual(COACH_MODULES.map((m) => expect.stringContaining(m.title.en)));
    rows.forEach((r, i) => expect(r.closest("a")?.getAttribute("href") ?? r.getAttribute("href")).toBe(trainingModulePath("principal", COACH_MODULES[i])));
    await waitFor(() => expect(screen.getByTestId("coach-training-count")).toHaveTextContent("2 of 10 done"));
    expect(progress.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Coach Training")).toBeNull();
  });

  it("Urdu: «ہیڈ ٹیچر ٹریننگ», the modules' Urdu titles", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    at(PRINCIPAL_TRAINING_PATH, PRINCIPAL);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("ہیڈ ٹیچر ٹریننگ");
    const rows = await screen.findAllByTestId("coach-module");
    expect(rows.map((r) => r.textContent)).toEqual(COACH_MODULES.map((m) => expect.stringContaining(m.title.ur)));
  });

  it("a principal on the teacher app goes back to its Home; one off it, to My Patch", async () => {
    const { container, unmount } = at(PRINCIPAL_TRAINING_PATH, PRINCIPAL);
    await screen.findAllByTestId("coach-module");
    expect(container.querySelector(`a[href="${teacherPath("home")}"]`)).not.toBeNull();
    unmount();
    forgetConfig(); resetTeacherV2Memory();
    const off = at(PRINCIPAL_TRAINING_PATH, PRINCIPAL, { teacherV2: false, principalApp: false });
    await screen.findAllByTestId("coach-module");
    expect(off.container.querySelector('a[href="/portal/leader"]')).not.toBeNull();
  });
});

describe("a Principal Training module: the same PDF, Video and Mark done", () => {
  it("module 8: its title, Principal Training above it, the same two pages, and Mark done saves to her own row", async () => {
    const open = vi.fn(); vi.stubGlobal("open", open);
    progress.set.mockResolvedValue({ success: true, done: { rehearse: "2026-11-25T00:00:00.000Z" } });
    const { container } = at(`${PRINCIPAL_TRAINING_PATH}/8`, PRINCIPAL);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Rehearse it aloud");
    expect(screen.getByTestId("coach-training-module")).toHaveTextContent("Module 8");
    expect(container.querySelector(`a[href="${PRINCIPAL_TRAINING_PATH}"]`)).not.toBeNull();
    expect(container.textContent).toContain("Principal Training");
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C", "_blank", "noopener,noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Video" }));
    expect(open).toHaveBeenLastCalledWith("https://claude.ai/artifact/FnhqM4ae3uV1XwwwgSYfYs", "_blank", "noopener,noreferrer");
    fireEvent.click(await screen.findByTestId("coach-mark-done"));
    await waitFor(() => expect(progress.set).toHaveBeenCalledWith("rehearse", true));
    expect(await screen.findByTestId("coach-module-done")).toBeTruthy();
  });

  it("a number that is not a module goes back to the Principal Training list", async () => {
    at(`${PRINCIPAL_TRAINING_PATH}/11`, PRINCIPAL);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(new RegExp(`^${PRINCIPAL_TRAINING_PATH}$`)));
  });
});

describe("who sees Principal Training", () => {
  it("a coach who lands on it goes to her own Coach Training", async () => {
    at(PRINCIPAL_TRAINING_PATH, COACH, { coachV2: true });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(COACH_TRAINING_PATH));
    expect(screen.queryByText("Principal Training")).toBeNull();
  });

  it("a teacher who lands on it goes Home", async () => {
    at(`${PRINCIPAL_TRAINING_PATH}/3`, TEACHER, { teacherV2: true });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(new RegExp(`^${teacherPath("home")}$`)));
    expect(progress.get).not.toHaveBeenCalled();
  });
});

describe("where it lives", () => {
  it("both pages are registered teacher-app routes a leader may open (a principal on My Patch is not on the teacher app)", () => {
    const list = principalRoutes.find((r) => r.path === PRINCIPAL_TRAINING_PATH);
    const mod = principalRoutes.find((r) => r.path === PRINCIPAL_MODULE_PATH);
    expect(list?.leaders).toBe(true);
    expect(mod?.leaders).toBe(true);
  });

  it("the coach's list is still where it was (audience.ts writes modules.ts's path out)", () => {
    expect(trainingListPath("coach")).toBe(COACH_TRAINING_PATH);
    expect(trainingModulePath("coach", COACH_MODULES[2])).toBe(`${COACH_TRAINING_PATH}/3`);
  });

  it("the principal app's bar keeps Home current on it (it opens from a Home tile, as the coach's does)", () => {
    expect(currentPrincipalMenuItem(PRINCIPAL_TRAINING_PATH)).toBe("home");
    expect(currentPrincipalMenuItem(`${PRINCIPAL_TRAINING_PATH}/4`)).toBe("home");
    // her observe screens keep Observe
    expect(currentPrincipalMenuItem("/portal/teacher/principal/pick")).toBe("observe");
  });
});
