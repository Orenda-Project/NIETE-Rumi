import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/** bd-4404s7.5 — every Reports screen has a route, and each page is its own chunk. */
const app = readFileSync(resolve(__dirname, "../../../App.tsx"), "utf8");

describe("coach Reports routes", () => {
  it.each([
    ["/portal/coach/reports/all", "CoachReportsAll", "CoachReportsAll"],
    ["/portal/coach/observation/:id/form", "CoachFeedbackForm", "FeedbackForm"],
    ["/portal/coach/observation/:id/debrief", "CoachDebrief", "Debrief"],
    ["/portal/coach/observation/:id/feedback", "CoachYourFeedback", "YourFeedback"],
    ["/portal/coach/observation/:id/send", "CoachSendReport", "SendReport"],
  ])("%s → %s", (path, component, file) => {
    expect(app).toContain(`<Route path="${path}" element={<${component} />} />`);
    expect(app).toContain(`const ${component} = page(() => import("./portal/coach/reports/${file}"))`);
  });

  it("a Reports page gates itself through ReportsFrame (CoachGate)", () => {
    const frame = readFileSync(resolve(__dirname, "ReportsFrame.tsx"), "utf8");
    expect(frame).toMatch(/<CoachGate>\s*<TeacherPage/);
  });
});
