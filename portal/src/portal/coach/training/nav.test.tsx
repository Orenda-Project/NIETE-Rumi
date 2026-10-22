import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import TeacherNavigation from "../../teacher/TeacherNavigation";
import { TEACHER_COPY_UR } from "../../teacher/copy";
import { COACH_APP_READY } from "./appReady";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));

/**
 * bd-s42dye.2 — the coach app v2's menu while only some of it is ready: Training Library, then (bd-4joiqz) Lesson
 * Plans — the teacher Lesson Plans pages, read as a leader — and More (her language, profile and Log out). Every
 * formerly shown item is gone; the full menu is still what TeacherNavigation draws by default
 * (TeacherNavigation.coach.test.tsx).
 */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const at = (path = "/portal/coach/training") =>
  render(<MemoryRouter initialEntries={[path]}><TeacherNavigation role="coach" ready={COACH_APP_READY} /></MemoryRouter>);

describe("the coach menu on the ready features", () => {
  it("is Training Library, Lesson Plans and More", () => {
    at();
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Training Library", "Lesson Plans", "More"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/training", "/portal/teacher/lessons", "/portal/coach/more"]);
  });
  it.each(["/portal/teacher/lessons", "/portal/teacher/lessons/new", "/portal/teacher/lessons/plan", "/portal/teacher/lessons/chapters"])(
    "Lesson Plans is current on %s", (p) => {
      at(p);
      expect(screen.getByTestId("teacher-nav").querySelector('a[aria-current="page"]')?.textContent).toBe("Lesson Plans");
    },
  );
  it.each(["Home", "Schedule", "Observe", "Schools", "Reports", "Analytics", "People", "Team"])("has no %s", (w) => {
    at();
    expect(screen.queryByText(w)).toBeNull();
  });
  it("Training Library is current on every library page", () => {
    at("/portal/coach/training/module/m-1");
    expect(screen.getByTestId("teacher-nav").querySelector('a[aria-current="page"]')?.textContent).toBe("Training Library");
  });
  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    at();
    expect(screen.getAllByText(TEACHER_COPY_UR.coachNav.training).length).toBeGreaterThan(0);
    expect(TEACHER_COPY_UR.coachNav.training).toBe("ٹریننگ لائبریری");
    // The teachers' own word for Lesson Plans (TEACHER_COPY_UR.nav.lessons), one menu vocabulary.
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["ٹریننگ لائبریری", "لیسن پلان", "مزید"]);
  });
});
