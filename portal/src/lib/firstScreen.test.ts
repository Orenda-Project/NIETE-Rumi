import { vi } from "vitest";
import { isCoachipEntry, warmFirstScreen } from "./firstScreen";

const loaders = () => ({
  dashboard: vi.fn(() => Promise.resolve()),
  teacherHome: vi.fn(() => Promise.resolve()),
  coachInsights: vi.fn(() => Promise.resolve()),
  rm: vi.fn(() => Promise.resolve()),
  config: vi.fn(() => Promise.resolve()),
});

describe("warmFirstScreen (bd-sex15q.34)", () => {
  it("a teacher opening the dashboard: its chunk is asked for at boot", () => {
    const l = loaders();
    warmFirstScreen("/portal/dashboard", "classic", l);
    expect(l.dashboard).toHaveBeenCalledTimes(1);
    expect(l.teacherHome).not.toHaveBeenCalled();
  });

  it("the app's cold start at / on a teacher-app device: the dashboard and the teacher Home", () => {
    const l = loaders();
    warmFirstScreen("/", "teacher", l);
    expect(l.dashboard).toHaveBeenCalledTimes(1);
    expect(l.teacherHome).toHaveBeenCalledTimes(1);
  });

  it("a signed-out device at /: nothing (the sign-in page is in the app's own chunk)", () => {
    const l = loaders();
    warmFirstScreen("/", null, l);
    expect(l.dashboard).not.toHaveBeenCalled();
  });

  it("a coach opening the insight pages: nothing of the teacher app", () => {
    for (const path of ["/portal/coach/insights", "/portal/coach/insights/w/ip", "/portal/rm", "/portal/leader"]) {
      const l = loaders();
      warmFirstScreen(path, "classic", l);
      expect(l.dashboard).not.toHaveBeenCalled();
      expect(l.teacherHome).not.toHaveBeenCalled();
    }
  });

  it("a coach opening the insight pages: their pages and the flags are asked for at boot, side by side", () => {
    for (const path of ["/portal/coach/insights", "/portal/coach/insights/", "/portal/coach/insights/w/ip/where"]) {
      const l = loaders();
      warmFirstScreen(path, null, l);
      expect(l.coachInsights).toHaveBeenCalledTimes(1);
      expect(l.config).toHaveBeenCalledTimes(1);
      expect(l.rm).not.toHaveBeenCalled();
    }
  });

  it("an RM opening their pages: the RM pages and the flags", () => {
    const l = loaders();
    warmFirstScreen("/portal/rm/coach/x", null, l);
    expect(l.rm).toHaveBeenCalledTimes(1);
    expect(l.config).toHaveBeenCalledTimes(1);
    expect(l.coachInsights).not.toHaveBeenCalled();
  });

  it("any other page warms nothing of COACHIP", () => {
    for (const path of ["/portal/coach", "/portal/coach/insightsx", "/portal/rmx", "/portal/login", "/portal/dashboard"]) {
      const l = loaders();
      warmFirstScreen(path, "classic", l);
      expect(l.coachInsights).not.toHaveBeenCalled();
      expect(l.rm).not.toHaveBeenCalled();
      if (path !== "/portal/dashboard") expect(l.config).not.toHaveBeenCalled();
    }
  });

  it("isCoachipEntry: the coach insight pages and the RM pages, nothing else", () => {
    expect(isCoachipEntry("/portal/coach/insights")).toBe(true);
    expect(isCoachipEntry("/portal/coach/insights/stats/results")).toBe(true);
    expect(isCoachipEntry("/portal/rm")).toBe(true);
    expect(isCoachipEntry("/portal/rm/circle")).toBe(true);
    expect(isCoachipEntry("/portal/coach")).toBe(false);
    expect(isCoachipEntry("/portal/rmx")).toBe(false);
    expect(isCoachipEntry("/portal/login")).toBe(false);
  });

  it("a failed early download is ignored (the page retries when it is opened)", async () => {
    const no = () => vi.fn(() => Promise.reject(new Error("offline")));
    const l = { dashboard: no(), teacherHome: no(), coachInsights: no(), rm: no(), config: no() };
    expect(() => warmFirstScreen("/", "teacher", l)).not.toThrow();
    expect(() => warmFirstScreen("/portal/coach/insights", null, l)).not.toThrow();
    await Promise.resolve();
  });
});
