import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import i18n from "i18next";

/**
 * bd-9652yj (queue #166) — the way back to WhatsApp is on every coach-app Observe screen through the frame
 * (ObservePage): a slim strip on a screen that works, a full green button on one that failed to load (the shared
 * `Failed` card says so), and nothing in the principal app (which shares these screens without the coach gate).
 */
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("../CoachGate", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { firstName: "Hataf", role: "coach" }, loading: false }) }));
vi.mock("../../services/api", () => ({
  coach: { getHome: vi.fn(), getSchedule: vi.fn(), getVisit: vi.fn(), getPeople: vi.fn(), getPending: vi.fn(), handoff: vi.fn() },
  leader: { cancelSchedule: vi.fn() },
}));
import { coach } from "../../services/api";
import CoachObserve from "../pages/CoachObserve";
import CoachVisit from "../pages/CoachVisit";
import { COACH_OBSERVE_ROUTES, ObserveRoutesProvider } from "./observeRoutes";

const C = coach as unknown as Record<string, ReturnType<typeof vi.fn>>;
const VISIT_ID = "0d8a6d1c-1111-4c1c-9a1a-000000000002";

function renderAt(path: string, { principal = false } = {}) {
  const routes = principal ? { ...COACH_OBSERVE_ROUTES, coachGate: false } : COACH_OBSERVE_ROUTES;
  return render(
    <ObserveRoutesProvider value={routes}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/portal/coach/observe" element={<CoachObserve />} />
          <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
        </Routes>
      </MemoryRouter>
    </ObserveRoutesProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => ({ status: 204 })));
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  C.getHome.mockResolvedValue({ success: true, home: { today: [], counts: { week: 0, overdue: 0, waiting: 0, inProgress: 0, teachers: 0, schools: 0 } } });
  C.getPending.mockResolvedValue({ success: true, waiting: 0, ids: [] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the way back to WhatsApp, through the Observe frame", () => {
  it("the hub: the slim strip", async () => {
    renderAt("/portal/coach/observe");
    const strip = await screen.findByTestId("continue-on-whatsapp");
    expect(strip.getAttribute("data-mode")).toBe("strip");
  });

  it("a visit that failed to load: the full green button", async () => {
    C.getVisit.mockRejectedValue(new Error("Network Error"));
    renderAt(`/portal/coach/visit/${VISIT_ID}`);
    await screen.findByText("Could not load");
    expect((await screen.findByTestId("continue-on-whatsapp")).getAttribute("data-mode")).toBe("button");
  });

  it("the principal app (no coach gate): none", async () => {
    renderAt("/portal/coach/observe", { principal: true });
    await screen.findByText(/Take observation/);
    expect(screen.queryByTestId("continue-on-whatsapp")).toBeNull();
  });
});
