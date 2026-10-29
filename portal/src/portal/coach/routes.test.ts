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
    ["/portal/coach/visit/:id/sending", "CoachSending"],
    ["/portal/coach/reports", "CoachReports"],
    ["/portal/coach/people", "CoachPeople"],
    ["/portal/coach/school/:emis", "CoachSchool"],
    ["/portal/coach/teacher/:ext", "CoachTeacher"],
    ["/portal/coach/observation/:id", "CoachObservation"],
    ["/portal/coach/teacher/:ext/edit", "CoachEditTeacher"],
  ])("%s → %s", (path, component) => {
    expect(app).toContain(`<Route path="${path}" element={<${component} />} />`);
    // bd-fxk3t8: a page is either imported or its own chunk (page(() => import(…))).
    expect(app).toMatch(new RegExp(
      `(import ${component} from "|const ${component} = page\\(\\(\\) => import\\(")\\./portal/coach/pages/${component}"`,
    ));
  });

  it("/portal/coach → CoachLanding: the slim Home with the School card switch on, else CoachHome as before", () => {
    expect(app).toContain('<Route path="/portal/coach" element={<CoachLanding />} />');
    expect(app).toContain('const CoachLanding = page(() => import("./portal/coach/card/CoachLanding"));');
  });

  it.each([
    ["/portal/coach/school/:emis/feature/:feature", "CoachFeatureGrid", "FeatureGridPage"],
    ["/portal/coach/teacher/:ext/items/:feature", "CoachHerItems", "HerItemsPage"],
    // her Digital Coaching and her Coach observations: one page, two addresses
    ["/portal/coach/teacher/:ext/dc", "CoachTeacherScores", "TeacherScoresPage"],
    ["/portal/coach/teacher/:ext/observations", "CoachTeacherScores", "TeacherScoresPage"],
    // the old Her coaching reports, her DC / coach-visit lists and option A's page open those (nothing 404s)
    ["/portal/coach/teacher/:ext/coaching", "CoachCoachingRedirect", "CoachingRedirect"],
    ["/portal/coach/teacher/:ext/reports", "CoachCoachingRedirect", "CoachingRedirect"],
    ["/portal/coach/teacher/:ext/items/dc", "CoachCoachingRedirect", "CoachingRedirect"],
    ["/portal/coach/teacher/:ext/items/coach", "CoachCoachingRedirect", "CoachingRedirect"],
    ["/portal/coach/session/:id", "CoachSessionReport", "SessionReportPage"],
  ])("the School card's %s → %s, its own chunk", (path, component, file) => {
    expect(app).not.toContain("HerReportsPage");
    expect(app).not.toContain("CoachingPage\"");
    expect(app).toContain(`<Route path="${path}" element={<${component} />} />`);
    expect(app).toContain(`const ${component} = page(() => import("./portal/coach/card/${file}"));`);
  });

  it("Analytics (bd-fmf24g.27): the page and one teacher, each its own chunk", () => {
    expect(app).toContain('<Route path="/portal/coach/analytics" element={<CoachAnalytics />} />');
    expect(app).toContain('<Route path="/portal/coach/analytics/teacher/:ext" element={<CoachTeacherAnalytics />} />');
    expect(app).toContain('import("./portal/coach/analytics/CoachAnalytics")');
  });

  it("Disagreements (bd-tbprit.3): the list and one teacher's card, each its own chunk", () => {
    expect(app).toContain('<Route path="/portal/coach/disagreements" element={<CoachDisagreements />} />');
    expect(app).toContain('<Route path="/portal/coach/disagreements/:id" element={<CoachDisagreement />} />');
    expect(app).toContain('import("./portal/coach/disagreements/DisagreementsPage")');
    expect(app).toContain('import("./portal/coach/disagreements/DisagreementCard")');
  });

  it("every v2 page gates itself through CoachPage", () => {
    const ui = readFileSync(resolve(__dirname, "ui.tsx"), "utf8");
    expect(ui).toMatch(/<CoachGate>\s*<PortalLayout[ >]/);
  });
});
