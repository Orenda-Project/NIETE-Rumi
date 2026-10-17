import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import TeacherNavigation from "../../teacher/TeacherNavigation";
import { TEACHER_COPY_UR } from "../../teacher/copy";
import { COACH_APP_READY } from "./appReady";

vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));

/**
 * bd-s42dye.2 — the coach app v2's menu while only Training is ready: Training Library, and More (her language,
 * profile and Log out). Every formerly shown item is gone; the full menu is still what TeacherNavigation draws
 * by default (TeacherNavigation.coach.test.tsx).
 */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const at = (path = "/portal/coach/training") =>
  render(<MemoryRouter initialEntries={[path]}><TeacherNavigation role="coach" ready={COACH_APP_READY} /></MemoryRouter>);

describe("the coach menu on the ready features", () => {
  it("is Training Library and More", () => {
    at();
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Training Library", "More"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/portal/coach/training", "/portal/coach/more"]);
  });
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
  });
});
