import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-v04lsh (queue #257) — Principal Training on My Patch. 68 of the 555 production principals (25 Nov: Gilgit-Baltistan
 * and others no app switch names) land on My Patch (/portal/leader), not the principal app's Home, so the Home tile never
 * reaches them. My Patch carries one Principal Training card for a principal, whatever her patch says (no school too).
 * The leader menu is not touched (its flag-off snapshot pins it), and nobody else's My Patch changes.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({
  leader: { getOverview: vi.fn() },
}));

import i18n from "@/i18n/config";
import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import LeaderHome from "./LeaderHome";

const OVERVIEW = {
  totalTeachers: 14, onRumi: 12, notOnRumi: 2, totalCoachingSessions: 37, totalLessonPlans: 90,
  totalAttendanceSessions: 0, totalTrainingModules: 0, teachersMarkingAttendance: 3, teachersInTraining: 4,
  scoredTeachers: 0, avgLastScore: null, focus: [],
};

function signIn(role: string) {
  vi.mocked(useAuth).mockReturnValue({ user: { firstName: "Sample", role }, loading: false, logout: vi.fn() } as never);
}
const renderPatch = () => render(<MemoryRouter initialEntries={["/portal/leader"]}><LeaderHome /></MemoryRouter>);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(leader.getOverview).mockResolvedValue({ success: true, overview: OVERVIEW } as never);
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("My Patch: the Principal Training card", () => {
  it("a principal: one Principal Training card, the ten modules' line, opening Principal Training", async () => {
    signIn("principal");
    renderPatch();
    const card = await screen.findByTestId("principal-training-card");
    expect(card).toHaveTextContent("Principal Training");
    expect(card).toHaveTextContent("Ten coaching modules");
    expect(card.closest("a")?.getAttribute("href") ?? card.getAttribute("href")).toBe("/portal/teacher/principal-training");
  });

  it("a principal with no school still gets it (her training is hers, not her school's)", async () => {
    vi.mocked(leader.getOverview).mockResolvedValue({ success: true, overview: OVERVIEW, noSchool: true } as never);
    signIn("principal");
    renderPatch();
    await screen.findByTestId("patch-no-school");
    expect(screen.getByTestId("principal-training-card")).toBeTruthy();
  });

  it("a coach, an AEO: My Patch exactly as before, no card", async () => {
    for (const role of ["coach", "aeo"]) {
      signIn(role);
      const { unmount } = renderPatch();
      await waitFor(() => expect(screen.getByTestId("feature-reach")).toBeTruthy());
      expect(screen.queryByTestId("principal-training-card")).toBeNull();
      expect(screen.queryByText("Principal Training")).toBeNull();
      unmount();
    }
  });
});
