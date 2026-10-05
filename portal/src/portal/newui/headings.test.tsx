import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MainHeading } from "./MainHeading";
import { InnerBar } from "./InnerBar";
import { FeatureIcon } from "./FeatureIcon";
import { DESK_COLUMN as DESK_COLUMN_CLASSES } from "./styles";
import { newUiSourceFiles } from "./checks/source";

/**
 * bd-5rz1v.19 — the two page headings (deep-screens.html, "bar spacing" + "inner-page
 * heading" blocks; DESIGN.md "Headings"). A feature's MAIN page gets the flat indigo band;
 * a page INSIDE a flow gets the light bar with a back button and a breadcrumb.
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

describe("MainHeading — a feature's main page", () => {
  it("is a flat indigo band (square corners) with a 24px/800 white title as the page's heading", () => {
    render(<MainHeading feature="training" title="Training" />);
    const band = screen.getByTestId("newui-main-heading");
    expect(classes(band)).toEqual(expect.arrayContaining(["bg-nu-ink", "text-white"]));
    expect(band.className).not.toMatch(/\brounded/);
    const h1 = screen.getByRole("heading", { level: 1, name: "Training" });
    expect(classes(h1)).toEqual(expect.arrayContaining(["text-2xl", "font-extrabold", "truncate"]));
  });

  it("puts the status-bar area on indigo too, and sits 14px above the content", () => {
    render(<MainHeading feature="training" title="Training" />);
    const band = screen.getByTestId("newui-main-heading");
    expect(classes(band)).toEqual(expect.arrayContaining(["pt-[env(safe-area-inset-top)]", "mb-[14px]"]));
  });

  it("holds a 44px soft-white tile with the feature's icon in its LIGHT tint", () => {
    render(<MainHeading feature="training" title="Training" />);
    const tile = screen.getByTestId("newui-heading-tile");
    expect(classes(tile)).toEqual(expect.arrayContaining(["h-11", "w-11", "bg-nu-f-tile"]));
    expect(classes(tile.querySelector("svg")!)).toContain("text-nu-f-training");
  });

  it("Home shows the NIETE mark instead of a feature icon", () => {
    render(<MainHeading feature="home" title="Salaam, Hataf" />);
    const tile = screen.getByTestId("newui-heading-tile");
    expect(tile.tagName).toBe("IMG");
    expect(tile.getAttribute("alt")).toBe("");
    expect(classes(tile)).toEqual(expect.arrayContaining(["h-11", "w-11"]));
  });

  it("has an optional right slot and a context row: 10px 16px padding, 12px gaps, 10px between rows, 16px under", () => {
    render(
      <MainHeading feature="home" title="Salaam, Hataf" right={<button type="button">HA</button>}
        context={<span data-testid="ctx">This month</span>} />,
    );
    const band = screen.getByTestId("newui-main-heading");
    expect(within(band).getByRole("button", { name: "HA" })).toBeInTheDocument();
    const ctx = screen.getByTestId("newui-heading-context");
    expect(within(ctx).getByTestId("ctx")).toBeInTheDocument();
    const row = screen.getByTestId("newui-heading-row");
    expect(classes(row)).toEqual(expect.arrayContaining(["gap-x-3", "gap-y-[10px]", "px-4", "pt-[10px]", "pb-4"]));
  });

  it("without a context row the title row ends 14px above the band's edge, and there is no empty strip", () => {
    render(<MainHeading feature="training" title="Training" />);
    expect(screen.queryByTestId("newui-heading-context")).toBeNull();
    expect(classes(screen.getByTestId("newui-heading-row"))).toContain("pb-[14px]");
  });

  it("the right slot's 56px target does not make the band taller than the 44px tile row", () => {
    render(<MainHeading feature="home" title="Salaam" right={<button type="button">HA</button>} />);
    expect(classes(screen.getByRole("button", { name: "HA" }).parentElement!)).toContain("-my-2");
  });
});

describe("InnerBar — a page inside a flow", () => {
  const bar = (props: Partial<React.ComponentProps<typeof InnerBar>> = {}) => (
    <InnerBar feature="training" crumb="Training · NIETE · Level 2" title="Group Work" {...props} />
  );

  it("is a light bar: white with a 1px bottom line, and a 20px/800 dark title as the page's heading", () => {
    render(<MemoryRouter>{bar()}</MemoryRouter>);
    const el = screen.getByTestId("newui-inner-bar");
    expect(classes(el)).toEqual(expect.arrayContaining(["bg-nu-inner", "border-b", "border-nu-inner-border"]));
    const h1 = screen.getByRole("heading", { level: 1, name: "Group Work" });
    expect(classes(h1)).toEqual(expect.arrayContaining(["text-xl", "font-extrabold", "text-nu-surface-text", "truncate"]));
  });

  it("leads its 12px muted breadcrumb with the feature's icon in its HUE", () => {
    render(<MemoryRouter>{bar()}</MemoryRouter>);
    const crumb = screen.getByTestId("newui-crumb");
    expect(crumb).toHaveTextContent("Training · NIETE · Level 2");
    expect(classes(crumb)).toEqual(expect.arrayContaining(["text-xs", "font-bold", "text-nu-inner-crumb"]));
    expect(classes(crumb.querySelector("svg")!)).toContain("text-nu-f-training-crumb");
  });

  it("has a 56px back button: a soft indigo-tint circle whose arrow flips in RTL", () => {
    render(<MemoryRouter>{bar()}</MemoryRouter>);
    const back = screen.getByRole("button", { name: "Back" });
    expect(classes(back)).toEqual(expect.arrayContaining(["min-h-[56px]", "min-w-[56px]"]));
    const circle = back.querySelector("[data-circle]")!;
    expect(classes(circle)).toEqual(expect.arrayContaining(["h-10", "w-10", "rounded-full", "bg-nu-inner-back", "text-nu-inner-back-icon"]));
    expect(classes(back.querySelector("svg")!)).toContain("rtl:-scale-x-100");
  });

  it("the back label comes in through props (for Urdu later)", () => {
    render(<MemoryRouter>{bar({ backLabel: "واپس" })}</MemoryRouter>);
    expect(screen.getByRole("button", { name: "واپس" })).toBeInTheDocument();
  });

  it("goes back a page when there is one", () => {
    render(
      <MemoryRouter initialEntries={["/portal/dashboard", "/portal/dashboard/coaching"]} initialIndex={1}>
        <Routes><Route path="*" element={<>{bar({ backTo: "/portal/dashboard" })}<Where /></>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/dashboard$/);
  });

  it("with nothing behind (she opened a link straight to it), back goes to backTo", () => {
    render(
      <MemoryRouter initialEntries={["/portal/dashboard/coaching"]}>
        <Routes><Route path="*" element={<>{bar({ backTo: "/portal/dashboard" })}<Where /></>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/portal\/dashboard$/);
  });

  it("onBack replaces the default", () => {
    const onBack = vi.fn();
    render(<MemoryRouter>{bar({ onBack })}</MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

/**
 * bd-5rz1v.32 — on a desktop the page's title is a CARD under the menu (operator, approved from the
 * v13 "card-24" mockup): no longer one indigo block with the top bar. The heading stands in the
 * page content's own column — centred, 1120px at most, 40px each side (1040px of card at 1280; a
 * 40px gutter below 1120) — 24px under the menu. The phone keeps today's full-bleed band and bar.
 */
const unprefixed = (el: Element) => classes(el).filter((c) => !c.includes(":"));
const DESK_COLUMN = ["md:mx-auto", "md:max-w-[1120px]", "md:px-10"];

describe("MainHeading on a desktop — an indigo card in the page's column (bd-5rz1v.32)", () => {
  it("the band is the page's column: centred, 1120px at most, 40px each side, 24px above and below, no fill of its own", () => {
    render(<MainHeading feature="training" title="Training" context={<span>ctx</span>} />);
    const band = screen.getByTestId("newui-main-heading");
    expect(classes(band)).toEqual(expect.arrayContaining([...DESK_COLUMN, "md:my-6", "md:bg-transparent", "md:pt-0", "md:pb-0"]));
  });

  it("the title row is the card: indigo, 20px corners, 32px each side", () => {
    render(<MainHeading feature="training" title="Training" context={<span>ctx</span>} />);
    const row = screen.getByTestId("newui-heading-row");
    expect(classes(row)).toEqual(expect.arrayContaining(["md:bg-nu-ink", "md:rounded-[20px]", "md:px-8", "md:pt-5", "md:pb-6"]));
    expect(classes(row)).not.toContain("md:px-10");
  });

  it("the column is the one every page body uses: each 1120px column in new-UI source has the 40px desktop gutter", () => {
    // The heading's edges are the content's only while both use the same column. A page body is
    // `mx-auto max-w-[1120px] px-[14px] md:px-10`; DESK_COLUMN (styles.ts) is its desktop half.
    const columns = newUiSourceFiles().flatMap((f) =>
      [...f.text.matchAll(/(['"`])((?:(?!\1)[^\n])*max-w-\[1120px\](?:(?!\1)[^\n])*)\1/g)].map((m) => [f.rel, m[2]]));
    expect(columns.length).toBeGreaterThan(5);
    for (const [rel, cls] of columns) expect(cls.split(/\s+/), rel).toContain("md:px-10");
    expect(DESK_COLUMN_CLASSES.split(/\s+/)).toEqual(DESK_COLUMN);
  });

  it("the phone keeps the full-bleed square band, the status-bar area on indigo, 14px above the content", () => {
    render(<MainHeading feature="training" title="Training" />);
    const band = screen.getByTestId("newui-main-heading");
    const row = screen.getByTestId("newui-heading-row");
    expect(unprefixed(band)).toEqual(expect.arrayContaining(["bg-nu-ink", "pt-[env(safe-area-inset-top)]", "mb-[14px]", "pb-[2px]"]));
    expect(unprefixed(band).join(" ")).not.toMatch(/\b(mx-|max-w-|px-|rounded)/);
    expect(unprefixed(row).join(" ")).not.toMatch(/\brounded/);
    expect(unprefixed(row)).toEqual(expect.arrayContaining(["px-4", "pt-[10px]", "pb-[14px]"]));
  });
});

describe("InnerBar on a desktop — a white card in the page's column (bd-5rz1v.32)", () => {
  const bar = () => render(<MemoryRouter><InnerBar feature="home" crumb="Home" title="Lesson plans used" /></MemoryRouter>);

  it("the bar is the page's column: centred, 1120px at most, 40px each side, 24px above, 20px below, no line or fill of its own", () => {
    bar();
    const el = screen.getByTestId("newui-inner-bar");
    expect(classes(el)).toEqual(expect.arrayContaining([...DESK_COLUMN, "md:mt-6", "md:mb-5", "md:pt-0", "md:border-b-0", "md:bg-transparent"]));
  });

  it("its row is the card: white, 16px corners, a FULL 1.5px line (not only the bottom one), 20px each side", () => {
    bar();
    const row = screen.getByTestId("newui-inner-bar").firstElementChild!;
    expect(classes(row)).toEqual(expect.arrayContaining([
      "md:bg-nu-inner", "md:rounded-2xl", "md:border-[1.5px]", "md:border-nu-inner-border", "md:px-5", "pt-3", "pb-3",
    ]));
    expect(classes(row)).not.toContain("md:px-10");
  });

  it("the phone keeps the full-bleed white bar with its bottom line and the status-bar area", () => {
    bar();
    const el = screen.getByTestId("newui-inner-bar");
    expect(unprefixed(el)).toEqual(expect.arrayContaining(["bg-nu-inner", "border-b", "border-nu-inner-border", "pt-[env(safe-area-inset-top)]", "mb-3"]));
    expect(unprefixed(el).join(" ")).not.toMatch(/\b(mx-|max-w-|px-|rounded)/);
  });

  it("its row has 12px on top, not 6px: the 40px back circle sits evenly (about 15px above, 16px below)", () => {
    bar();
    const row = screen.getByTestId("newui-inner-bar").firstElementChild!;
    expect(unprefixed(row)).toEqual(expect.arrayContaining(["pt-3", "pb-3", "px-[14px]"]));
    expect(classes(row)).not.toContain("pt-1.5");
  });
});

describe("FeatureIcon — the only place a feature colour is drawn", () => {
  it.each([
    ["lessonPlans", "light", "text-nu-f-lesson-plans-crumb"],
    ["training", "light", "text-nu-f-training-crumb"],
    ["assessment", "light", "text-nu-f-assessment-crumb"],
    ["attendance", "light", "text-nu-f-my-classes-crumb"],
    ["coaching", "light", "text-nu-f-coaching-crumb"],
    ["home", "light", "text-nu-f-home-crumb"],
    ["lessonPlans", "band", "text-nu-f-lesson-plans"],
    ["training", "band", "text-nu-f-training"],
    ["assessment", "band", "text-nu-f-assessment"],
  ] as const)("%s on %s is %s", (feature, on, cls) => {
    const { container } = render(<FeatureIcon feature={feature} on={on} />);
    const svg = container.querySelector("svg")!;
    expect(classes(svg)).toContain(cls);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});
