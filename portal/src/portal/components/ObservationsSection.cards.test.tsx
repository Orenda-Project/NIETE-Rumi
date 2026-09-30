import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * Each kind of observation is explained INSIDE its own count card, not as two
 * loose lines of text above the cards (operator, 2026-09-30: "looks so bland
 * and boring … bring it inside the boxes where we show the numbers").
 */

vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="chart" /> }));
import ObservationsSection from "./ObservationsSection";

const ANALYTICS: any = {
  totalSessions: 5, humanObservations: 2, digitalCoachObservations: 3, averageScore: 60,
  scoreTrend: [], areas: [], byMonth: [], observations: [],
  domainBreakdown: [], strongestDomain: null, focusDomain: null,
};

describe.each([
  ["principal", /you or a coach watched the lesson in class/i, /the teacher recorded (her|their) own lesson/i],
  ["teacher", /your principal or a coach watched your lesson in class/i, /you recorded your own lesson/i],
] as const)("the count cards explain themselves (%s)", (audience, human, digital) => {
  it("puts each definition inside its own card, beside its number", () => {
    render(<ObservationsSection analytics={ANALYTICS} showTeacher={false} audience={audience} />);
    const h = screen.getByTestId("count-human");
    const d = screen.getByTestId("count-digital");
    expect(within(h).getByTestId("def-human")).toHaveTextContent(human);
    expect(within(d).getByTestId("def-digital")).toHaveTextContent(digital);
    expect(within(h).getByTestId("count-human-value")).toHaveTextContent("2");
    expect(within(d).getByTestId("count-digital-value")).toHaveTextContent("3");
  });

  it("leaves no loose definition lines above the cards", () => {
    render(<ObservationsSection analytics={ANALYTICS} showTeacher={false} audience={audience} />);
    for (const id of ["def-human", "def-digital"]) {
      expect(screen.getByTestId(id).closest('[data-testid^="count-"]')).not.toBeNull();
    }
  });
});
