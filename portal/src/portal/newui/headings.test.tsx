import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MainHeading } from "./MainHeading";
import { InnerBar } from "./InnerBar";
import { FeatureIcon } from "./FeatureIcon";

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
