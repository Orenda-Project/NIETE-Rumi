import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The Lessons page lists BOTH kinds of observation, each labelled — Human
 * Observation (a coach or principal in class) or Digital Coach Observation
 * (the teacher recorded her own lesson) — and only a Human one carries a
 * rating (operator, 2026-09-29). It used to list every analysed session as
 * "a lesson a coach sat in on", which was true of 17% of them.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../services/api", () => ({ leader: { getSchoolAnalytics: vi.fn() } }));

import { useAuth } from "../hooks/useAuth";
import { leader } from "../services/api";
import SchoolLessons from "./SchoolLessons";

const PAYLOAD = {
  success: true,
  school: { name: "S" }, focusTeacher: null, teachers: [],
  analytics: {
    totalSessions: 3, averageScore: 64, humanObservations: 1, digitalCoachObservations: 2,
    scoreTrend: [{ date: "2026-09-15T09:00:00Z", percentage: 64, points: 64, maxPoints: 100, teacherName: "Ayesha Bibi" }],
    observations: [
      { date: "2026-09-20T09:00:00Z", kind: "digital_coach", percentage: null, teacherName: "Sana Riaz" },
      { date: "2026-09-15T09:00:00Z", kind: "human", percentage: 64, teacherName: "Ayesha Bibi" },
      { date: "2026-09-02T09:00:00Z", kind: "digital_coach", percentage: null, teacherName: "Ayesha Bibi" },
    ],
    domainBreakdown: [], strongestDomain: null, focusDomain: null,
  },
};

function mount(payload: any = PAYLOAD) {
  (useAuth as any).mockReturnValue({ user: { firstName: "Atifa", role: "principal" }, loading: false, logout: vi.fn() });
  (leader.getSchoolAnalytics as any).mockResolvedValue(payload);
  render(<MemoryRouter><SchoolLessons /></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

describe("SchoolLessons — both kinds, each labelled", () => {
  it("lists every observation of both kinds, newest first", async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId(/^lesson-row-/)).toHaveLength(3));
    const rows = screen.getAllByTestId(/^lesson-row-/);
    expect(rows[0]).toHaveTextContent("Digital Coach Observation");
    expect(rows[1]).toHaveTextContent("Human Observation");
  });

  it("only a Human Observation carries a rating", async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId(/^lesson-row-/)).toHaveLength(3));
    const rows = screen.getAllByTestId(/^lesson-row-/);
    expect(rows[1]).toHaveTextContent("Good");
    expect(rows[0].textContent).not.toMatch(/Excellent|Good|Average|Needs support/);
    expect(screen.getAllByTestId("score-band")).toHaveLength(1);
  });

  it("no longer says every lesson was one a coach sat in on", async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId(/^lesson-row-/)).toHaveLength(3));
    expect(document.body.textContent).not.toMatch(/coach sits in|coach sat in/i);
  });
});
