import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * fix-r5 s2 item 9 (qa-rm R1 FAIL 20261027T072541, idea 072624; panel a3): an RM who is a coach-v2 user with
 * `/config features.coachipRm === true` and `coachip !== true` lands on the RM home (/portal/rm), not on Training.
 * Dual-role users (both true) keep "This week". coachipRm false / absent / unreadable: nothing changes (B8), and no
 * /coachip/ request is made (the guard reads /config only).
 *
 * Network boundary only: `services/api` (the /config read) and the child-test switch. The real guard, the real
 * useCoachV2 / useCoachip / useCoachipRm hooks.
 */
vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../lib/useChildTestSa", () => ({ useChildTestSa: () => false }));

import api, { portal } from "../../services/api";
import { AuthContext } from "../../hooks/authContext";
import CoachAppGuard from "./CoachAppGuard";
import { resetCoachV2Memory } from "../useCoachV2";
import { resetCoachipMemory } from "../insights/useCoachip";
import { RM_BASE } from "../../rm/paths";

const COACH = { id: "u-rm", role: "coach", phoneNumber: "+920000000009", firstName: "R" };

type Rm = "absent" | boolean;
function setConfig(coachip: boolean | "absent", coachipRm: Rm, coachV2 = true) {
  const features: Record<string, unknown> = { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: false, coachV2 };
  if (coachip !== "absent") features.coachip = coachip;
  if (coachipRm !== "absent") features.coachipRm = coachipRm;
  vi.mocked(portal.getConfig).mockReset().mockResolvedValue({ success: true, features } as never);
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

async function landAt(path: string) {
  render(
    <AuthContext.Provider value={{ user: COACH, loading: false } as never}>
      <MemoryRouter initialEntries={[path]}>
        <CoachAppGuard>
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </CoachAppGuard>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await settle();
  return screen.getByTestId("where").textContent;
}

const coachipCalls = () =>
  [...vi.mocked(api.get).mock.calls, ...vi.mocked(api.post).mock.calls].map((c) => String(c[0])).filter((u) => u.includes("/coachip/"));

beforeEach(() => {
  resetCoachV2Memory();
  resetCoachipMemory();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});
afterEach(() => cleanup());

describe("item 9: an RM on the coach app v2 lands on the RM home", () => {
  it.each([false, "absent"] as const)("coachip %s + coachipRm true: /portal/leader lands on /portal/rm", async (coachip) => {
    setConfig(coachip, true);
    expect(RM_BASE).toBe("/portal/rm");
    expect(await landAt("/portal/leader")).toBe("/portal/rm");
    expect(coachipCalls()).toEqual([]);
  });

  it("coachip false + coachipRm true: an old page and the coach home also land on /portal/rm", async () => {
    setConfig(false, true);
    expect(await landAt("/portal/dashboard")).toBe("/portal/rm");
    cleanup();
    expect(await landAt("/portal/coach")).toBe("/portal/rm");
  });

  it("coachip false + coachipRm true: Training stays reachable from More (no redirect off a ready page)", async () => {
    setConfig(false, true);
    expect(await landAt("/portal/coach/training")).toBe("/portal/coach/training");
  });

  it("dual role (both true) keeps This week", async () => {
    setConfig(true, true);
    expect(await landAt("/portal/leader")).toBe("/portal/coach/insights");
  });

  it.each([false, "absent"] as const)("coachipRm %s: Training, unchanged, and zero /coachip/ requests", async (rm) => {
    setConfig(false, rm);
    expect(await landAt("/portal/leader")).toBe("/portal/coach/training");
    expect(coachipCalls()).toEqual([]);
  });

  it("config unreadable: today's pages (v2 reads off), zero /coachip/ requests", async () => {
    vi.mocked(portal.getConfig).mockReset().mockRejectedValue(new Error("network"));
    expect(await landAt("/portal/leader")).toBe("/portal/leader");
    expect(coachipCalls()).toEqual([]);
  });

  it("a coach NOT on v2 is untouched even with coachipRm on", async () => {
    setConfig(false, true, false);
    expect(await landAt("/portal/leader")).toBe("/portal/leader");
  });
});
