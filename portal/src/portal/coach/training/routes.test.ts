import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/** bd-s42dye.2 — the Training Library's four routes sit beside the other /portal/coach/* routes, and the guard wraps them all. */
const app = readFileSync(resolve(__dirname, "../../../App.tsx"), "utf8");

describe("coach library routes", () => {
  it.each([
    ["/portal/coach/training", "CoachLibraryHome"],
    ["/portal/coach/training/module/:id", "CoachLibraryModule"],
    ["/portal/coach/training/preview", "CoachLibraryPreview"],
    ["/portal/coach/training/:vendorKey", "CoachLibraryProvider"],
  ])("%s → %s", (path, component) => {
    expect(app).toContain(`<Route path="${path}" element={<${component} />} />`);
    expect(app).toMatch(new RegExp(`const ${component} = page\\(\\(\\) => import\\("\\./portal/coach/training/LibraryPages"\\)`));
  });

  it("the CoachAppGuard wraps the route table", () => {
    expect(app).toMatch(/<CoachAppGuard>\s*<AnalyticsOnlyGuard>\s*<Routes>/);
    expect(app).toMatch(/<\/Routes>\s*<\/AnalyticsOnlyGuard>\s*<\/CoachAppGuard>/);
  });
});
