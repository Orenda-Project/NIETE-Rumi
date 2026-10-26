import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("../../../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, F, http, renderAt, serve } from "../../tests/harness";

/**
 * bd-sex15q.16 — B7 goldens for the player (SPEC v2 §6).
 *
 *   The kit AudioPlayer is untouched: the player wraps it (finds its <audio> inside its own container to seek and to
 *   read the clock), so `newui/AudioPlayer.tsx` imports nothing of COACHIP and its own tests (newui/audioPlayer*.test.tsx)
 *   run unchanged; the report carries their run.
 *   With portal_coachip off (absent, false) S4's address renders no player and makes no /coachip/m/ request: the coach
 *   lands on the Training Library exactly as CoachAppGuard sends a v2 coach without the switch.
 */
const ID = F.moment.moment_id as string;

describe("the kit player is not edited by COACHIP", () => {
  it("newui/AudioPlayer.tsx knows nothing of the coach insights", () => {
    const src = readFileSync(resolve(__dirname, "../../../../newui/AudioPlayer.tsx"), "utf8");
    expect(src).not.toMatch(/coachip|insights|MomentPlayer|lesson_s/i);
  });
});

describe.each([
  ["absent", { coachV2: true }],
  ["false", { coachV2: true, coachip: false }],
] as const)("portal_coachip %s", (_mode, features) => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  beforeEach(async () => {
    http.get.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    await boot("en", features as Record<string, unknown>);
  });

  it(`/portal/coach/insights/m/<id> renders no player and reads no moment`, async () => {
    serve({ [`/coachip/m/${ID}`]: F.moment });
    const { container } = await renderAt(`/m/${ID}`);
    expect(screen.queryByTestId("insights-moment")).toBeNull();
    expect(screen.queryByTestId("moment-player")).toBeNull();
    expect(container.querySelector("audio")).toBeNull();
    const urls = http.get.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes("/coachip/m/"))).toEqual([]);
    expect(urls.filter((u) => u.includes("/coachip/"))).toEqual([]);
  }, 30000);
});
