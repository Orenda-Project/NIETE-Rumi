import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import TeacherNavigation from "./TeacherNavigation";
import TeacherPage from "./TeacherPage";
import { currentCoachMenuItem, COACH_MENU_PATHS } from "./menu";
import { TEACHER_COPY_UR } from "./copy";
import { vi } from "vitest";

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const at = (path: string, role?: "teacher" | "coach") => render(<MemoryRouter initialEntries={[path]}><TeacherNavigation role={role} /></MemoryRouter>);

describe("role-aware bottom menu (bd-4404s7.1)", () => {
  it("the teacher's menu is unchanged by default", () => {
    at("/portal/teacher");
    const nav = screen.getByTestId("teacher-nav");
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Home", "Lesson Plans", "Digital Coaching", "Training", "More"]);
  });
  it("the coach's: Home, Schedule, Observe, Schools, More — with their routes", () => {
    at("/portal/coach", "coach");
    const links = Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Home", "Schedule", "Observe", "Schools", "More"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(Object.values(COACH_MENU_PATHS));
  });
  it("icons stay STILL (Schedule and Schools glyphs included)", () => {
    at("/portal/coach", "coach");
    const glyphs = screen.getByTestId("teacher-nav").querySelectorAll("svg[data-glyph]");
    expect(Array.from(glyphs).map((g) => g.getAttribute("data-glyph"))).toEqual(["home", "schedule", "observations", "schools", "more"]);
    glyphs.forEach((g) => expect(g.getAttribute("data-still")).toBe("true"));
  });
  it("a feature stays current on every page inside it", () => {
    expect(currentCoachMenuItem("/portal/coach")).toBe("home");
    expect(currentCoachMenuItem("/portal/coach/new-visit")).toBe("schedule");
    expect(currentCoachMenuItem("/portal/coach/team")).toBe("schedule");
    expect(currentCoachMenuItem("/portal/coach/visit/12/record")).toBe("observe");
    expect(currentCoachMenuItem("/portal/coach/observation/9")).toBe("observe");
    expect(currentCoachMenuItem("/portal/coach/reports")).toBe("observe");
    expect(currentCoachMenuItem("/portal/coach/teacher/5/edit")).toBe("schools");
    expect(currentCoachMenuItem("/portal/coach/school/123")).toBe("schools");
    expect(currentCoachMenuItem("/portal/coach/more")).toBe("more");
    expect(currentCoachMenuItem("/portal/training")).toBeNull();
    at("/portal/coach/team", "coach");
    expect(screen.getByTestId("teacher-nav").querySelector('a[aria-current="page"]')?.textContent).toBe("Schedule");
  });
  it("Urdu words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    at("/portal/coach", "coach");
    for (const w of Object.values(TEACHER_COPY_UR.coachNav)) expect(screen.getAllByText(w).length).toBeGreaterThan(0);
  });
});

describe("TeacherPage action slot (bd-4404s7.1)", () => {
  const page = (props: object) => render(<MemoryRouter><TeacherPage title="Schedule" {...props}><p>x</p></TeacherPage></MemoryRouter>);
  it("a top-level page can carry an action at the end of its header", () => {
    page({ action: <button type="button">New visit</button> });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.closest("header")).toContainElement(screen.getByRole("button", { name: "New visit" }));
  });
  it("an inner page still does", () => {
    page({ backTo: "/x", action: <button type="button">Edit</button> });
    expect(screen.getByRole("heading", { level: 1 }).closest("header")).toContainElement(screen.getByRole("button", { name: "Edit" }));
  });
  it("a coach feature's art can stand beside the title", () => {
    page({ feature: "schools" });
    expect(screen.getByTestId("page-feature-tile").querySelector('svg[data-feature-art="schools"]')).not.toBeNull();
  });
});
