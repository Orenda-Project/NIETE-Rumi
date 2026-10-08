import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
import TeacherPage from "./TeacherPage";

/**
 * bd-fmf24g.1 — ONE header for every teacher v2 page: an optional feature tile (the D2
 * illustration, as on the canvas page headings) and titles that wrap — a long lesson-plan
 * title shows in full, never cut to one line.
 */
const LONG = "Adding fractions with like denominators using fraction strips and number lines";

function page(props: Partial<Parameters<typeof TeacherPage>[0]>) {
  return render(
    <MemoryRouter>
      <TeacherPage title={LONG} {...props}><p>body</p></TeacherPage>
    </MemoryRouter>,
  );
}

describe("TeacherPage header", () => {
  it("an inner page with a feature shows its D2 illustration beside the title", () => {
    page({ backTo: "/portal/teacher/lessons", crumb: "Grade 4 · General Science", feature: "lessons" });
    const tile = screen.getByTestId("page-feature-tile");
    expect(tile.querySelector('svg[data-feature-art="lessons"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).closest("header")?.contains(tile)).toBe(true);
  });

  it("a top-level page can carry the tile too", () => {
    page({ feature: "coaching" });
    expect(screen.getByTestId("page-feature-tile").querySelector('svg[data-feature-art="coaching"]')).not.toBeNull();
  });

  it("no feature: no tile (Home, More)", () => {
    page({ backTo: "/portal/teacher/more" });
    expect(screen.queryByTestId("page-feature-tile")).toBeNull();
  });

  it.each([
    ["inner page", { backTo: "/portal/teacher/lessons", crumb: "Grade 4 · General Science · Chap 1 · Fractions and decimals" }],
    ["top-level page", {}],
  ])("%s: the title wraps in full, never truncated", (_l, props) => {
    page(props as never);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(LONG);
    expect(h1.className).not.toMatch(/\btruncate\b|line-clamp|whitespace-nowrap/);
    expect(h1.className).toMatch(/break-words|\[overflow-wrap:anywhere\]/);
  });

  it("an inner page's crumb wraps too", () => {
    page({ backTo: "/portal/teacher/lessons", crumb: "Grade 4 · General Science · Chap 1 · Fractions and decimals" });
    const crumb = screen.getByTestId("page-crumb");
    expect(crumb.className).not.toMatch(/\btruncate\b|whitespace-nowrap/);
  });
});
