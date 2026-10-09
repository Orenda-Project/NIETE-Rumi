import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-fxk3t8 — where data is still on its way, placeholder blocks hold its place; no spinner.
 *
 * The operator: "There should not be a spinner in the first place … only the data to be
 * populated should be where [the loading] appears." Every shared loading state, and every
 * teacher v2 list's, now draws Skeleton blocks in the shape of what is coming, inside the
 * page (the menu and the page's heading stay). The blocks shimmer only when motion is allowed.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn(() => ({ user: null, loading: true })) }));

import LoadingState from "./LoadingState";
import { SkeletonLine, SkeletonChip, SkeletonTile, SkeletonRow, SkeletonList, PageSkeleton } from "./Skeleton";
import { LoadState as LessonsLoad } from "../teacher/lessons/LoadState";
import { LoadState as TrainingLoad } from "../teacher/training/TrainingFrame";
import { LoadState as AttendanceLoad } from "../teacher/attendance/ui";
import { LoadState as AssessmentLoad } from "../teacher/assessment/ui";
import { LoadState as ClassesLoad } from "../teacher/classes/parts";
import PortalAssessment from "../pages/PortalAssessment";
import PortalHomeList from "../pages/PortalHomeList";

const noSpinner = (c: HTMLElement) => {
  expect(c.querySelector(".animate-spin, .lucide-loader-circle, .lucide-loader2")).toBeNull();
  expect(c.textContent).not.toMatch(/Loading\.\.\./);
};
const blocks = (c: HTMLElement) => c.querySelectorAll("[data-skeleton]").length;

describe("the Skeleton kit", () => {
  it.each([
    ["line", <SkeletonLine />],
    ["chip", <SkeletonChip />],
    ["tile", <SkeletonTile />],
    ["row", <SkeletonRow />],
    ["list", <SkeletonList rows={2} />],
    ["page", <PageSkeleton />],
  ])("%s: blocks a screen reader skips, in the static shell's style", (_n, el) => {
    const { container } = render(el);
    const all = [...container.querySelectorAll("[data-skeleton]")];
    expect(all.length).toBeGreaterThan(0);
    for (const b of all) {
      expect(b.getAttribute("aria-hidden")).toBe("true");
      expect(b.classList.contains("as-sk")).toBe(true);
      expect(b.className).not.toMatch(/animate-pulse/); // pulse ignores reduced motion
    }
  });

  it("a list can name what it is loading, for a screen reader", () => {
    const { getByRole } = render(<SkeletonList rows={2} label="Lesson plans" />);
    expect(getByRole("status", { name: "Lesson plans" }).getAttribute("aria-busy")).toBe("true");
  });

  it("the block style is index.html's, with the shimmer behind the motion gate", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../../../index.html"), "utf8");
    const css = html.slice(html.indexOf('<style id="app-shell-css">'), html.indexOf("</style>"));
    expect(css).toMatch(/\.as-sk \{[^}]*background: #e5e7eb/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.as-sk \{[^}]*animation/);
  });
});

describe("LoadingState (every older page's loading)", () => {
  it.each(["full", "card", "list", "table"] as const)("%s: placeholder blocks, no spinner, no pulse", (type) => {
    const { container } = render(<LoadingState type={type} />);
    noSpinner(container);
    expect(blocks(container)).toBeGreaterThan(2);
    expect(container.innerHTML).not.toMatch(/animate-pulse/);
  });

  it("full no longer fills the screen: it sits in the page, under the menu", () => {
    const { container } = render(<LoadingState type="full" />);
    expect(container.innerHTML).not.toMatch(/min-h-screen/);
  });
});

describe("the teacher v2 lists while loading", () => {
  it.each([
    ["Lesson Plans", <LessonsLoad status="loading" empty={false} onRetry={() => {}} />],
    ["Training", <TrainingLoad loading failed={false} onRetry={() => {}} />],
    ["Attendance", <AttendanceLoad loading failed={false} onRetry={() => {}} />],
    ["Assessment", <AssessmentLoad status="loading" onRetry={() => {}} />],
    ["My Classes", <ClassesLoad status="loading" onRetry={() => {}} />],
  ])("%s: rows of placeholders where the list will be, still announced as loading", (_n, el) => {
    const { container, getByRole } = render(el);
    noSpinner(container);
    expect(blocks(container)).toBeGreaterThan(2);
    expect(getByRole("status").getAttribute("aria-busy")).toBe("true");
  });
});

describe("pages that wait for a flag before their layout", () => {
  it.each([
    ["Assessment", <PortalAssessment view={"home" as never} />],
    ["Home lists", <PortalHomeList />],
  ])("%s: the app's frame with placeholders, not a full-screen spinner", (_n, el) => {
    const { container } = render(<MemoryRouter>{el}</MemoryRouter>);
    noSpinner(container);
    expect(container.querySelector("[data-frame]")).not.toBeNull();
  });
});
