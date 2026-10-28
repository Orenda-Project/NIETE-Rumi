import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * fix-r5 s5 (red-3 challenge 161108, accepted by the COS): where a dual (coachip AND coachipRm both true) lands.
 *   config A: the RM sector is NOT among the coach's school sectors (/coachip/me rm.coachesHere === false) → the RM home
 *   config B: the RM sector is one they coach in (coachesHere true)                                       → This week
 * Only a literal `false` moves a dual: /me unreadable, rm null or the key absent keep This week (today's behaviour).
 * The guard asks /coachip/me only when both switches are on, so with coachipRm off nothing new is requested (B8).
 *
 * Network boundary only: `services/api` (/config and /coachip/me) and the child-test switch. The real guard and hooks.
 */
vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../lib/useChildTestSa", () => ({ useChildTestSa: () => false }));

import api, { portal } from "../../services/api";
import { AuthContext } from "../../hooks/authContext";
import CoachAppGuard from "./CoachAppGuard";
import { resetCoachV2Memory } from "../useCoachV2";
import { resetCoachipMemory } from "../insights/useCoachip";
import { coachLandingFor, coachReadyFor, COACH_INSIGHTS_BASE } from "./appReady";
import { RM_BASE } from "../../rm/paths";

const COACH = { id: "u-dual", role: "coach", phoneNumber: "+920000000010", firstName: "D" };

function setConfig(coachip: boolean, coachipRm: boolean) {
  const features = { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: false, coachV2: true, coachip, coachipRm };
  vi.mocked(portal.getConfig).mockReset().mockResolvedValue({ success: true, features } as never);
}
const me = (rm: unknown) => ({ data: { coach: { schoolCount: 5, teacherCount: 20 }, rm, decode: false, lang: "en", computed_at: "2026-10-28T10:00:00.000Z" } });
function setMe(answer: unknown | Error) {
  vi.mocked(api.get).mockReset().mockImplementation((url: string) => {
    if (url !== "/coachip/me") return Promise.reject(new Error(`unexpected ${url}`));
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as never);
  });
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); });
}
function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
async function landAt(path: string) {
  render(
    <AuthContext.Provider value={{ user: COACH, loading: false } as never}>
      <MemoryRouter initialEntries={[path]}>
        <CoachAppGuard>
          <Routes><Route path="*" element={<Where />} /></Routes>
        </CoachAppGuard>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await settle();
  return screen.getByTestId("where").textContent;
}
const meCalls = () => vi.mocked(api.get).mock.calls.map((c) => String(c[0])).filter((u) => u === "/coachip/me");

beforeEach(() => {
  resetCoachV2Memory();
  resetCoachipMemory();
  vi.mocked(api.post).mockReset();
});
afterEach(() => cleanup());

describe("s5: a dual lands by where they coach", () => {
  it.each(["/portal/leader", "/portal/coach", "/portal/dashboard"])("config A (coachesHere false): %s lands on the RM home", async (from) => {
    setConfig(true, true);
    setMe(me({ sector: "Tarnol", schoolCount: 9, coachCount: 3, coachesHere: false }));
    expect(await landAt(from)).toBe(RM_BASE);
  });

  it("config B (coachesHere true): This week", async () => {
    setConfig(true, true);
    setMe(me({ sector: "Urban-I", schoolCount: 9, coachCount: 3, coachesHere: true }));
    expect(await landAt("/portal/leader")).toBe(COACH_INSIGHTS_BASE);
  });

  it.each([
    ["key absent (an older server)", me({ sector: "Urban-I", schoolCount: 9, coachCount: 3 })],
    ["rm null", me(null)],
    ["/me unreadable", new Error("network")],
  ])("%s: This week, unchanged", async (_label, answer) => {
    setConfig(true, true);
    setMe(answer);
    expect(await landAt("/portal/leader")).toBe(COACH_INSIGHTS_BASE);
  });

  it("a ready page is never redirected: a config-A dual opening This week stays there", async () => {
    setConfig(true, true);
    setMe(me({ sector: "Tarnol", schoolCount: 9, coachCount: 3, coachesHere: false }));
    expect(await landAt(COACH_INSIGHTS_BASE)).toBe(COACH_INSIGHTS_BASE);
  });

  it("coachipRm off: the guard never asks /coachip/me (B8)", async () => {
    setConfig(true, false);
    setMe(me(null));
    expect(await landAt("/portal/leader")).toBe(COACH_INSIGHTS_BASE);
    expect(meCalls()).toEqual([]);
  });
});

describe("coachLandingFor (pure)", () => {
  it("only a literal coachesHere === false moves a dual", () => {
    expect(coachLandingFor(coachReadyFor(true), true, true, false)).toBe(RM_BASE);
    for (const v of [true, null, undefined]) expect(coachLandingFor(coachReadyFor(true), true, true, v)).toBe(COACH_INSIGHTS_BASE);
    expect(coachLandingFor(coachReadyFor(true), false, true, true)).toBe(RM_BASE);   // an RM who is not a COACHIP coach
    expect(coachLandingFor(coachReadyFor(false), false, false, false)).not.toBe(RM_BASE);        // coachipRm off: never the RM home
  });
});
