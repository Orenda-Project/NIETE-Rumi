import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * bd-o15qnr — every v2 screen has a route. Each page gates itself (CoachPage →
 * CoachGate), so a route reached without the flag sends her to My Patch.
 */
const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");

describe("coach v2 routes", () => {
  it.each([
    ["/portal/coach", "CoachHome"],
    ["/portal/coach/scheduling", "CoachScheduling"],
    ["/portal/coach/schedule", "CoachSchedule"],
    ["/portal/coach/team", "CoachTeam"],
    ["/portal/coach/new-visit", "CoachNewVisit"],
    ["/portal/coach/observe", "CoachObserve"],
    ["/portal/coach/observe/pick", "CoachObservePick"],
    ["/portal/coach/visit/:id", "CoachVisit"],
    ["/portal/coach/visit/:id/record", "CoachRecord"],
    ["/portal/coach/visit/:id/attach", "CoachAttach"],
    ["/portal/coach/visit/:id/check", "CoachCheckSend"],
    ["/portal/coach/reports", "CoachReports"],
    ["/portal/coach/people", "CoachPeople"],
    ["/portal/coach/school/:emis", "CoachSchool"],
    ["/portal/coach/teacher/:ext", "CoachTeacher"],
  ])("%s → %s", (path, component) => {
    expect(app).toContain(`<Route path="${path}" element={<${component} />} />`);
    expect(app).toMatch(new RegExp(`import ${component} from "\\./portal/coach/pages/${component}";`));
  });

  it("every v2 page gates itself through CoachPage", () => {
    const ui = readFileSync(resolve(__dirname, "ui.tsx"), "utf8");
    expect(ui).toMatch(/<CoachGate>\s*<PortalLayout[ >]/);
  });
});
