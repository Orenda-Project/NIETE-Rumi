import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { loadApp, net, renderApp, resetAll } from "./harness.testdata";
import { VISIT_REPORT } from "./fixtures.testdata";
import type { Obs612Summary } from "../../lib/obs612";

vi.mock("axios", async () => (await import("./harness.testdata")).axiosMock());
vi.setConfig({ testTimeout: 20_000 });

/**
 * bd-pni007 — an FDE (obs612) visit opened from a teacher's Coach observations: the coach's report view shows FDE's
 * own result (General form: Yes counts, no score) where the Coach score ring would be, and no lesson-plan steps (a FICO
 * reading). The API sends no FICO overall, sections or practices for it (tests/portal/obs612-portal.test.js).
 */
const FDE: Obs612Summary = {
  label: "FDE v1", rubric: "obs612-gen-v1", tool: "gen", toolName: "General form", toolTitle: "Teacher Observation Form General",
  grade: 10, subject: "Social Studies", result: "29/35 Yes", noTotal: true, headline: "Yes on 29 of 35",
  rows: [
    { name: "CLASSROOM ENVIRONMENT", value: "6 of 6 Yes", pct: 100 },
    { name: "STUDENT ASSESSMENT PROCESS", value: "0 of 2 Yes", pct: 0 },
  ],
  feedback: [{ label: "Feedback", text: "A good start: add pair work, and check answers at the end." }],
  footer: "Scored by your coach on FDE's tool (Annexure G, 2026-27). Not a FICO score.",
};

function on() {
  net.answers.set("/config", { success: true, features: { coachV2: true, schoolCard: true, coachip: true } });
  net.answers.set("/coach/session/v-fde", {
    ...VISIT_REPORT, overall: null, whatWentWell: [], nextStep: null, sections: [], practices: [], lpSteps: null, obs612: FDE,
  });
}

beforeAll(async () => { await loadApp(); }, 120_000);
beforeEach(async () => { await resetAll(); });

describe("the coach's report view of an FDE visit", () => {
  it("FDE's result instead of the Coach score; no plan steps, no 'No lesson plan linked', no %", async () => {
    on();
    const { container } = await renderApp("/portal/coach/session/v-fde");
    const block = within(await screen.findByTestId("obs612"));
    expect(block.getByTestId("obs612-tool")).toHaveTextContent("General form");
    expect(block.getByTestId("obs612-headline")).toHaveTextContent("Yes on 29 of 35");
    expect(block.getAllByTestId("obs612-row").map((r) => r.textContent)).toEqual([
      expect.stringContaining("6 of 6 Yes"), expect.stringContaining("0 of 2 Yes"),
    ]);
    expect(block.getByTestId("obs612-label")).toHaveTextContent("FDE v1");
    expect(screen.queryByTestId("overall")).toBeNull();
    expect(screen.queryByTestId("no-plan")).toBeNull();
    expect(screen.queryByTestId("lp-steps")).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|—%|Coach score/);
  });
});
