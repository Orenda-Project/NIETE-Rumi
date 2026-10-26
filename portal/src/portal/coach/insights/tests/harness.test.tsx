import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderAt, serve, F } from "./harness";

/** The harness itself: the gate opens with the switch on, sends the coach away with it off, and the fixture loads. */
describe("insights test harness", () => {
  beforeEach(() => serve({ "/coachip/home": F.home }));
  afterEach(() => cleanup());

  it("switch on: the insight route mounts (no redirect)", async () => {
    await boot("en");
    await renderAt("/m/00000000-0000-4000-8000-040000000001");
    expect(screen.queryByTestId("elsewhere")).toBeNull();
    expect(screen.getByTestId("insights-moment")).toBeTruthy();
  });

  it("switch off: the coach is sent to the Training Library", async () => {
    await boot("en", { coachV2: true, coachip: false });
    await renderAt("/m/00000000-0000-4000-8000-040000000001");
    expect(screen.getByTestId("elsewhere")).toBeTruthy();
  });

  it("the fixture is the contract's (fictional, C-03, today 26 Oct)", () => {
    expect(F._meta.fictional).toBe(true);
    expect(F.home.moves[0].count).toEqual({ n: 17, d: 49, window_id: "w4-2026-09-28" });
  });
});
