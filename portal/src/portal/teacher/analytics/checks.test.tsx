import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";

/**
 * bd-fmf24g.8 — the Analytics page keeps the kit's rules (teacher/ui/checks.test.tsx): start/end only,
 * motion only under motion-safe:, no lying theme classes; every word from copy.ts (≤4 words, never a
 * sentence); every target 56px.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(async () => ({ data: { lessonPlans: { used: 2 }, coaching: { digitalCoach: 1, observations: 1 } } })), post: vi.fn() },
  portal: {
    getMyAnalytics: vi.fn(async () => ({
      success: true, totals: { lessonPlans: 2, examsGenerated: 1 },
      analytics: { totalSessions: 1, averageScore: 60, domainBreakdown: [], strongestDomain: null, focusDomain: null,
        scoreTrend: [{ date: "2026-09-03", percentage: 63, points: null, maxPoints: null, teacherName: null }],
        areas: [{ key: "t", name: "Teaching skills", pct: 72, band: "good", observations: 1 }] },
      presence: { teacher: { records: 2, present: 2, absent: 0, leave: 0, presentPct: 100 }, student: { sessions: 1, totalMarked: 30, present: 27, presentPct: 90 } },
      remarksReceived: [],
    })),
  },
}));

import "../routes";
import analyticsRoutes from "./routes";
import { ANALYTICS_V2_COPY } from "./copy";
import { ANALYTICS_HOME } from "./paths";

const files = () => newUiSourceFiles(resolve(__dirname)).filter((f) => !/\.test\.tsx?$/.test(f.rel));

describe("analytics: style", () => {
  it("reads the page's source", () => {
    expect(files().map((f) => f.rel)).toEqual(expect.arrayContaining(["AnalyticsPage.tsx", "BandChart.tsx"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour");
    expect(problems).toEqual([]);
  });
});

describe("analytics: copy", () => {
  it("every word is a label: at most 4 words, never a sentence", () => {
    const bad = collectCopy(ANALYTICS_V2_COPY).filter((c) => copyProblem(c.text)).map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("no words written into the page (they come from copy.ts)", () => {
    const problems = files().filter((f) => f.rel !== "copy.ts").flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });
});

describe("analytics: every target is 56px or more", () => {
  it("the range, the tiles' See all rows, Back", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={[ANALYTICS_HOME]}>
        <Routes>{analyticsRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
      </MemoryRouter>,
    );
    await screen.findByText(ANALYTICS_V2_COPY.allLessonPlans);
    await screen.findByText("Teaching skills");
    expect(tapProblems(container)).toEqual([]);
  });
});
