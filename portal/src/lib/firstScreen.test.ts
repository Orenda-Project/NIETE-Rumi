import { vi } from "vitest";
import { warmFirstScreen } from "./firstScreen";

const loaders = () => ({ dashboard: vi.fn(() => Promise.resolve()), teacherHome: vi.fn(() => Promise.resolve()) });

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

  it("a failed early download is ignored (the page retries when it is opened)", async () => {
    const l = { dashboard: vi.fn(() => Promise.reject(new Error("offline"))), teacherHome: vi.fn(() => Promise.reject(new Error("offline"))) };
    expect(() => warmFirstScreen("/", "teacher", l)).not.toThrow();
    await Promise.resolve();
  });
});
