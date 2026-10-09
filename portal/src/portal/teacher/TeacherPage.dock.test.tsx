import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../components/PortalLayout", () => ({ default: ({ children }: { children: unknown }) => <div>{children as never}</div> }));
import TeacherPage from "./TeacherPage";

/**
 * bd-fmf24g.15 — the strip of what is being made sits above the bottom menu, so a page's own bottom action
 * (its dock) must stand above the strip too: it reads the strip's height from the page (--notice-h, set by the
 * notices host; 0 when there is no strip).
 */
describe("a page's dock stands above the notices strip", () => {
  it("its bottom offset adds --notice-h to the menu's", () => {
    render(<MemoryRouter><TeacherPage title="T" dock={<button type="button">Go</button>}><p>x</p></TeacherPage></MemoryRouter>);
    const dock = screen.getByRole("button", { name: "Go" }).parentElement as HTMLElement;
    expect(dock.className).toContain("var(--notice-h,0px)");
  });
});
