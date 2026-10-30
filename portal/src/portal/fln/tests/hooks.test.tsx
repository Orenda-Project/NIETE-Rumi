import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";

/**
 * The FLN hook lines in shared files, each executed through its real caller:
 *
 *   coach/training/appReady.ts   ALWAYS_OPEN lets a v2 coach reach /portal/fln/* (CoachAppGuard would bounce the coach
 *                                to the Training Library otherwise); nothing else that merely starts with "fln".
 *   OpenPlanPage.tsx             `?plan=fln:<id>` (Recent / Home lists, the open key) → /portal/fln/p/<id>, replacing
 *                                the open page; k5 / g612 are the goldens' (golden.flagOff.test.tsx).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../coach/useCoachV2", async (orig) => ({ ...(await orig<Record<string, unknown>>()), useCoachV2: vi.fn() }));
// The guard also reads portal_coachip (useCoachip). These cases are that switch OFF, answered false at once, as the
// guard's own goldens do (CoachAppGuard.test.tsx); without it the guard waits on the skeleton and nothing routes.
vi.mock("../../coach/insights/useCoachip", async (orig) => ({ ...(await orig<Record<string, unknown>>()), useCoachip: vi.fn(() => false), useCoachipRm: vi.fn(() => false) }));

import api from "../../services/api";
import { coachPathReady, coachReadyHome } from "../../coach/training/appReady";
import { OpenPlanPage } from "../../teacher/lessons/OpenPlanPage";
import CoachAppGuard from "../../coach/training/CoachAppGuard";
import { useCoachV2 } from "../../coach/useCoachV2";
import { AuthContext, type SharedAuth } from "../../hooks/authContext";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

describe("appReady ALWAYS_OPEN: a v2 coach reaches the FLN pages", () => {
  it.each(["/portal/fln", "/portal/fln/", "/portal/fln/p/1", "/portal/fln/list/rh-en", "/portal/fln/send"])("%s is open", (p) => {
    expect(coachPathReady(p)).toBe(true);
  });

  it.each(["/portal/flnx", "/portal/fln-old/p/1", "/portal/teacher/fln/p/1", "/portal/coach"])("%s is not", (p) => {
    expect(coachPathReady(p)).toBe(false);
  });

  it("the rest of the guard is unchanged", () => {
    expect(coachPathReady("/portal/coach/training/module/3")).toBe(true);
    expect(coachPathReady("/portal/delete-account")).toBe(true);
    expect(coachPathReady("/portal/dashboard")).toBe(false);
    expect(coachReadyHome()).toBe("/portal/coach/training");
  });
});

describe("CoachAppGuard (the real caller of ALWAYS_OPEN): a v2 coach is not bounced off /portal/fln/*", () => {
  const coach = { firstName: "Test", lastName: "", phoneNumber: "900000000002", role: "coach" } as SharedAuth["user"];
  function at(entry: string) {
    vi.mocked(useCoachV2).mockReturnValue(true);
    const Where = () => <output data-testid="where">{useLocation().pathname}</output>;
    render(
      <AuthContext.Provider value={{ user: coach, loading: false, request: vi.fn() } as SharedAuth}>
        <MemoryRouter initialEntries={[entry]}>
          <CoachAppGuard>
            <Where />
            <Routes>
              <Route path="/portal/fln/*" element={<p data-testid="page">fln</p>} />
              <Route path="*" element={<p data-testid="page">other</p>} />
            </Routes>
          </CoachAppGuard>
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    return screen.getByTestId("where").textContent;
  }
  afterEach(() => cleanup());

  it.each(["/portal/fln/p/1", "/portal/fln/list/rh-ur", "/portal/fln/send"])("%s stays and mounts", (p) => {
    expect(at(p)).toBe(p);
    expect(screen.getByTestId("page").textContent).toBe("fln");
  });

  it("/portal/flnx still goes to the Training Library", () => {
    expect(at("/portal/flnx")).toBe("/portal/coach/training");
  });
});

describe("OpenPlanPage: an fln: key opens the FLN plan page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no fetch expected"); }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  function Where() {
    const loc = useLocation();
    const how = useNavigationType();
    return <output data-testid="where" data-path={loc.pathname} data-search={loc.search} data-how={how} />;
  }

  async function open(search: string) {
    render(
      <MemoryRouter initialEntries={["/portal/teacher/lessons", { pathname: "/portal/teacher/lessons/open", search }]} initialIndex={1}>
        <Routes>
          <Route path="/portal/teacher/lessons/open" element={<OpenPlanPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("where").getAttribute("data-path")).not.toBe("/portal/teacher/lessons/open"));
    return screen.getByTestId("where");
  }

  it("fln:11156 → /portal/fln/p/11156, replacing the open page", async () => {
    const w = await open("?plan=fln:11156");
    expect(w.getAttribute("data-path")).toBe("/portal/fln/p/11156");
    expect(w.getAttribute("data-search")).toBe("");
    expect(w.getAttribute("data-how")).toBe("REPLACE");
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it("the id is encoded as one path segment", async () => {
    const w = await open(`?plan=${encodeURIComponent("fln:a/b?c")}`);
    expect(w.getAttribute("data-path")).toBe("/portal/fln/p/a%2Fb%3Fc");
  });

  it("an unknown key still goes to the lessons home", async () => {
    const w = await open("?plan=xyz:1");
    expect(w.getAttribute("data-path")).toBe("/portal/teacher/lessons");
  });
});
