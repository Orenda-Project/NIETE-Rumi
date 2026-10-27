import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthContext, type SharedAuth } from "../../hooks/authContext";

/**
 * A coach on the coach app v2 must never be bounced between two pages.
 *
 * The app-wide guard (CoachAppGuard) sends a v2 coach from any page that is not ready to the Training Library; the
 * Training Library's own gate (CoachGate) sends anyone who is not a v2 coach to /portal/leader. Both ask "is this a v2
 * coach?". If they ever answer differently at the same moment, the coach ping-pongs between the two pages for as long as the
 * browser lets the app navigate — the screen never settles and nothing on it loads.
 *
 * Nothing here is mocked but the network (axios): the real guard, the real gate, the real flag hook, the real shared
 * /config read and the real getConfig (with its fail-closed fallback) all run.
 */

type Answer = { features: Record<string, unknown> } | "network-error";
const configAnswers: Answer[] = [];

vi.mock("axios", () => {
  const get = vi.fn((url: string) => {
    if (url === "/config") {
      const next = configAnswers.shift();
      if (!next || next === "network-error") return Promise.reject(new Error("Network Error"));
      return Promise.resolve({ data: { success: true, ...next } });
    }
    // every other read (the coach's language, counts, ...) stays in flight: this test is about the redirects only
    return new Promise(() => {});
  });
  const instance = {
    get,
    post: vi.fn(() => new Promise(() => {})),
    put: vi.fn(() => new Promise(() => {})),
    delete: vi.fn(() => new Promise(() => {})),
    interceptors: { response: { use: vi.fn() }, request: { use: vi.fn() } },
  };
  return { default: { create: () => instance } };
});

import CoachAppGuard from "./CoachAppGuard";
import CoachGate from "../CoachGate";
import { resetCoachV2Memory } from "../useCoachV2";

const coach = { firstName: "Test", lastName: "Coach", phoneNumber: "923000000000", role: "coach" } as SharedAuth["user"];

/** Every place the coach is taken to, in order. */
const visits: string[] = [];
const LOOP_LIMIT = 25;

/**
 * Records each page the coach lands on. Past LOOP_LIMIT moves it stops rendering the app, which ends a ping-pong that
 * would otherwise never stop (the assertion then fails instead of the test hanging).
 */
function Visits({ children }: { children: ReactNode }) {
  const { key, pathname } = useLocation();
  if (visits[visits.length - 1] !== `${key} ${pathname}`) visits.push(`${key} ${pathname}`);
  if (visits.length > LOOP_LIMIT) return <p data-testid="loop">redirect loop</p>;
  return <>{children}</>;
}

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

/** What the coach taps: a link to another page of the coach app. */
function Tap({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>{`go ${to}`}</button>;
}

/**
 * Two pages of the coach app, each behind its own CoachGate as in the app (the Training Library and More are different
 * page components, so moving between them mounts a new gate, and the new gate reads the flag again).
 */
function LibraryPage() { return <CoachGate><p data-testid="page">library</p></CoachGate>; }
function MorePage() { return <CoachGate><p data-testid="page">more</p></CoachGate>; }

function renderApp(entry: string) {
  const value: SharedAuth = { user: coach, loading: false, request: vi.fn() };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[entry]}>
        <Visits>
          <CoachAppGuard>
            <Where />
            <Tap to="/portal/coach/training" />
            <Tap to="/portal/coach/more" />
            <Routes>
              {/* the old leader home: what a coach without v2 gets */}
              <Route path="/portal/leader" element={<p data-testid="page">my patch</p>} />
              <Route path="/portal/coach/training" element={<LibraryPage />} />
              <Route path="/portal/coach/more" element={<MorePage />} />
            </Routes>
          </CoachAppGuard>
        </Visits>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

/** Pathnames only, in order. */
const pages = () => visits.map((v) => v.split(" ")[1]);

beforeEach(() => {
  visits.length = 0;
  configAnswers.length = 0;
  resetCoachV2Memory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T07:00:00Z"));
});

afterEach(() => { vi.useRealTimers(); });

/** A v2 coach opens the app and lands on the Training Library, then on More. */
async function openAsV2Coach() {
  configAnswers.push({ features: { coachV2: true } });
  renderApp("/portal/leader");
  await waitFor(() => expect(screen.getByTestId("page")).toHaveTextContent("library"));
  await act(async () => { screen.getByText("go /portal/coach/more").click(); });
  await waitFor(() => expect(screen.getByTestId("page")).toHaveTextContent("more"));
}

describe("a v2 coach whose flag reads differently later in the same visit", () => {
  it("one /config read that fails (the app comes back after a long time in the background) does not loop the coach", async () => {
    await openAsV2Coach();
    // Long enough that the kept /config answer is stale; the next read goes to the network, and that read fails.
    vi.setSystemTime(new Date("2026-01-01T07:25:00Z"));
    configAnswers.push("network-error");
    await act(async () => { screen.getByText("go /portal/coach/training").click(); });
    // let the failed read settle and every redirect it causes run
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(screen.queryByTestId("loop"), `the coach was moved: ${pages().join(" > ")}`).toBeNull();
    // the coach ends on ONE page, not on a page about to redirect again
    const settled = screen.getByTestId("where").textContent;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByTestId("where").textContent).toBe(settled);
    expect(pages().filter((p) => p === "/portal/leader").length).toBeLessThanOrEqual(2);
  });

  it("the flag turned off on the server mid-visit does not loop the coach either", async () => {
    await openAsV2Coach();
    vi.setSystemTime(new Date("2026-01-01T07:25:00Z"));
    configAnswers.push({ features: { coachV2: false } });
    await act(async () => { screen.getByText("go /portal/coach/training").click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(screen.queryByTestId("loop"), `the coach was moved: ${pages().join(" > ")}`).toBeNull();
    // the flag is off: the coach gets what a coach without v2 gets, the leader home
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/leader");
    expect(screen.getByTestId("page")).toHaveTextContent("my patch");
  });

  it("and with the flag still on, nothing changes: the Training Library, no extra moves", async () => {
    await openAsV2Coach();
    vi.setSystemTime(new Date("2026-01-01T07:25:00Z"));
    configAnswers.push({ features: { coachV2: true } });
    await act(async () => { screen.getByText("go /portal/coach/training").click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(screen.queryByTestId("loop"), `the coach was moved: ${pages().join(" > ")}`).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent("/portal/coach/training");
    expect(screen.getByTestId("page")).toHaveTextContent("library");
    expect(pages()).toEqual(["/portal/leader", "/portal/coach/training", "/portal/coach/more", "/portal/coach/training"]);
  });
});
