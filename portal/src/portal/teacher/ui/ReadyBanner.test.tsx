import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { ReadyBanner, type BannerRow } from "./ReadyBanner";

/**
 * bd-fmf24g.15 — ReadyBanner (COMPONENTS.md §12): "it is ready", for 10 seconds. A white card above the bottom
 * menu with a big Open button and a countdown bar that shrinks; it PAUSES while her finger, mouse or keyboard
 * focus is on it. Two ready at once are ONE banner. ✕ closes it now. Failed: the same frame, red, with the reason
 * and Try again (role="alert"); ready is role="status".
 */

const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const lp: BannerRow = { id: "lesson:a", feature: "lessons", what: "Lesson plan", title: "Transport of Water", line: "Grade 7 · Science" };
const pa: BannerRow = { id: "paper:b", feature: "assessment", what: "Paper", title: "Plants and food", line: "Grade 4 · Science · 15 questions" };

beforeEach(async () => {
  vi.useFakeTimers();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => { vi.useRealTimers(); });

describe("ReadyBanner: one ready", () => {
  it("'Lesson plan ready', its title and class, a 56px Open, a 56px close; role=status", () => {
    inRouter(<ReadyBanner items={[lp]} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Lesson plan ready");
    expect(banner).toHaveTextContent("Transport of Water");
    expect(banner).toHaveTextContent("Grade 7 · Science");
    const open = within(banner).getByRole("button", { name: /Open/ });
    expect(classes(open)).toEqual(expect.arrayContaining(["h-14", "w-full", "bg-[#33374a]", "text-white"]));
    const close = within(banner).getByRole("button", { name: "Close" });
    expect(classes(close)).toEqual(expect.arrayContaining(["h-14", "w-14"]));
  });

  it("a paper says 'Paper ready'", () => {
    inRouter(<ReadyBanner items={[pa]} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Paper ready");
  });

  it("Open and ✕ report which; neither waits for the timer", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    inRouter(<ReadyBanner items={[lp]} onOpen={onOpen} onClose={onClose} onExpire={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Open/ }));
    expect(onOpen).toHaveBeenCalledWith("lesson:a");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ReadyBanner: the 10 seconds", () => {
  it("stays 10 seconds — not 9 — then expires once; the bar shrinks as it goes", async () => {
    const onExpire = vi.fn();
    inRouter(<ReadyBanner items={[lp]} onOpen={() => {}} onClose={() => {}} onExpire={onExpire} />);
    const bar = screen.getByTestId("banner-bar");
    expect(bar.style.width).toBe("100%");
    await tick(5000);
    expect(parseFloat(bar.style.width)).toBeGreaterThan(40);
    expect(parseFloat(bar.style.width)).toBeLessThan(60);
    await tick(4000);
    expect(onExpire).not.toHaveBeenCalled();
    await tick(1100);
    expect(onExpire).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("pauses while a finger or the mouse is on it, and carries on from where it stopped", async () => {
    const onExpire = vi.fn();
    inRouter(<ReadyBanner items={[lp]} onOpen={() => {}} onClose={() => {}} onExpire={onExpire} />);
    const banner = screen.getByRole("status");
    await tick(6000);
    fireEvent.pointerEnter(banner);
    await tick(60_000);
    expect(onExpire).not.toHaveBeenCalled();
    fireEvent.pointerLeave(banner);
    await tick(3000);
    expect(onExpire).not.toHaveBeenCalled();
    await tick(1500);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("pauses while keyboard or screen-reader focus is inside it", async () => {
    const onExpire = vi.fn();
    inRouter(<ReadyBanner items={[lp]} onOpen={() => {}} onClose={() => {}} onExpire={onExpire} />);
    const open = screen.getByRole("button", { name: /Open/ });
    await tick(2000);
    fireEvent.focus(open);
    await tick(60_000);
    expect(onExpire).not.toHaveBeenCalled();
    fireEvent.blur(open);
    await tick(8500);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("a second item that lands while it shows joins it and the 10 seconds start again", async () => {
    const onExpire = vi.fn();
    const { rerender } = inRouter(<ReadyBanner items={[lp]} onOpen={() => {}} onClose={() => {}} onExpire={onExpire} />);
    await tick(8000);
    rerender(<MemoryRouter><ReadyBanner items={[lp, pa]} onOpen={() => {}} onClose={() => {}} onExpire={onExpire} /></MemoryRouter>);
    await tick(8000);
    expect(onExpire).not.toHaveBeenCalled();
    await tick(2500);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

describe("ReadyBanner: two ready at once is ONE banner", () => {
  it("'2 ready', one row per item, each with its own Open; one bar", () => {
    const onOpen = vi.fn();
    inRouter(<ReadyBanner items={[lp, pa]} onOpen={onOpen} onClose={() => {}} onExpire={() => {}} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("2 ready");
    expect(within(banner).getAllByRole("button", { name: /Open/ })).toHaveLength(2);
    expect(screen.getAllByTestId("banner-bar")).toHaveLength(1);
    fireEvent.click(within(banner).getByRole("button", { name: /Open.*Plants and food/ }));
    expect(onOpen).toHaveBeenCalledWith("paper:b");
  });

  it("more than two: two rows and '+N more ready', which goes to see them all", () => {
    const onSeeAll = vi.fn();
    const third: BannerRow = { ...lp, id: "lesson:c", title: "Third" };
    const fourth: BannerRow = { ...pa, id: "paper:d", title: "Fourth" };
    inRouter(<ReadyBanner items={[lp, pa, third, fourth]} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} onSeeAll={onSeeAll} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("4 ready");
    expect(within(banner).getAllByRole("button", { name: /Open/ })).toHaveLength(2);
    fireEvent.click(within(banner).getByRole("button", { name: /\+2 more ready/ }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });
});

describe("ReadyBanner: failed", () => {
  it("'Couldn't make it', what it was, the real reason, Try again; role=alert, a red bar", () => {
    const onRetry = vi.fn();
    inRouter(<ReadyBanner variant="failed" items={[pa]} reason="Too many questions" onRetry={onRetry} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Couldn't make it");
    expect(banner).toHaveTextContent("Plants and food");
    expect(banner).toHaveTextContent("Too many questions");
    fireEvent.click(within(banner).getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledWith("paper:b");
    expect(screen.getByTestId("banner-bar").getAttribute("data-hue")).toBe("#c8331f");
    expect(screen.queryByRole("button", { name: /^Open/ })).toBeNull();
  });
});

describe("ReadyBanner: Urdu", () => {
  it("its words are Urdu, and the bar is anchored at the start edge so it shrinks toward it in both directions", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    inRouter(<ReadyBanner items={[lp]} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("لیسن پلان تیار ہے");
    expect(within(banner).getByRole("button", { name: /کھولیں/ })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "بند کریں" })).toBeInTheDocument();
    expect(classes(screen.getByTestId("banner-bar").parentElement!)).not.toContain("justify-end");
  });
});
