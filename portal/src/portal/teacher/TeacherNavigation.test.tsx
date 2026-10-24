import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

vi.mock("../lib/useNewUi", () => ({ readConfigShared: vi.fn() }));
import { readConfigShared } from "../lib/useNewUi";
import TeacherNavigation from "./TeacherNavigation";
import { resetHomeLookMemory } from "./home/useHomeData";

/**
 * The phone bar under the Home look (portal_teacher_home_look). OFF: every item's class string is today's, byte for
 * byte. ON: labels may wrap, the current item is a green pill with an ink bold label; the desktop bar is untouched.
 */
const TODAY_ITEM = "flex min-h-[58px] min-w-[64px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl text-[11.5px] font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]";
const TODAY_ON = `${TODAY_ITEM} text-[#48b078]`;
const TODAY_OFF = `${TODAY_ITEM} text-[#6b7280]`;

const config = (look: boolean) => ({ features: { teacherHomeCard: true, teacherHomeLook: look } }) as never;
const at = (path = "/portal/teacher", role?: "teacher" | "coach") =>
  render(<MemoryRouter initialEntries={[path]}><TeacherNavigation role={role} /></MemoryRouter>);
const items = () => Array.from(screen.getByTestId("teacher-nav").querySelectorAll("a"));

beforeEach(async () => {
  vi.clearAllMocks();
  resetHomeLookMemory();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("TeacherNavigation — look OFF is today's bar", () => {
  it("every phone item's class string is today's, exactly", async () => {
    vi.mocked(readConfigShared).mockResolvedValue(config(false));
    at();
    await act(async () => { await Promise.resolve(); });
    const cls = items().map((a) => a.className);
    expect(cls[0]).toBe(TODAY_ON);
    expect(cls.slice(1)).toEqual([TODAY_OFF, TODAY_OFF, TODAY_OFF, TODAY_OFF]);
  });

  it("the bar keeps today's side padding", async () => {
    vi.mocked(readConfigShared).mockResolvedValue(config(false));
    at();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("teacher-nav").className.split(" ")).toContain("px-1");
  });

  it("an unreadable config is today's bar too", async () => {
    vi.mocked(readConfigShared).mockRejectedValue(new Error("down"));
    at();
    await act(async () => { await Promise.resolve(); });
    expect(items().map((a) => a.className)).toEqual([TODAY_ON, TODAY_OFF, TODAY_OFF, TODAY_OFF, TODAY_OFF]);
  });
});

describe("TeacherNavigation — look ON", () => {
  const on = async (path = "/portal/teacher") => {
    vi.mocked(readConfigShared).mockResolvedValue(config(true));
    at(path);
    await waitFor(() => expect(items()[0].className).toContain("min-h-[56px]"));
  };

  it("the bar has no side padding under the look (each item a full fifth), and each label is at most its item's width", async () => {
    await on();
    const bar = screen.getByTestId("teacher-nav");
    expect(bar.className.split(" ")).toContain("px-0");
    expect(bar.className.split(" ")).not.toContain("px-1");
    // A shorter bar under the look (pt 4, bottom 10 + the safe area), so a row stays above it at 320 in Urdu.
    expect(bar.className.split(" ")).toContain("pt-1");
    expect(bar.className.split(" ")).toContain("pb-[calc(10px+env(safe-area-inset-bottom))]");
    expect(bar.className.split(" ")).not.toContain("pt-1.5");
    for (const a of items()) expect(a.lastElementChild?.className.split(" ")).toContain("max-w-full");
  });

  it("labels may wrap: no item is nowrap, each wraps at its spaces, 11px on a 1.15 line, 56px tall", async () => {
    await on();
    for (const a of items()) {
      expect(a.className).not.toContain("whitespace-nowrap");
      expect(a.className).not.toContain("[overflow-wrap:normal]");
      for (const c of ["flex-1", "min-w-0", "whitespace-normal", "[overflow-wrap:anywhere]", "hyphens-auto", "text-[11px]", "leading-[1.15]", "rtl:!leading-[1.5]", "min-h-[56px]"]) {
        expect(a.className.split(" ")).toContain(c);
      }
    }
  });

  it("the Urdu line height sits on the label itself (index.css's Urdu rule reaches every element, so an inherited one never lands)", async () => {
    await on();
    for (const a of items()) expect(a.lastElementChild?.className.split(" ")).toContain("rtl:!leading-[1.5]");
  });

  it("the current item: a green pill, a green glyph, an ink bold label; the others muted", async () => {
    await on();
    const [home, ...rest] = items();
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(home.className).toContain("text-[#333748]");
    expect(home.className).toContain("font-bold");
    const pill = home.querySelector("[data-look-pill]")!;
    for (const c of ["h-7", "w-[52px]", "rounded-full"]) expect(pill.className.split(" ")).toContain(c);
    expect(pill.className).toContain("bg-[#e7f5ed]");
    expect(pill.className).toContain("text-[#2e7d57]");
    for (const a of rest) {
      expect(a.className).toContain("text-[#636878]");
      expect(a.className).not.toContain("font-bold");
      expect(a.querySelector("[data-look-pill]")!.className).not.toContain("bg-[#e7f5ed]");
    }
  });

  it("the glyphs are the look's, 22px", async () => {
    await on();
    const glyphs = items().map((a) => a.querySelector("svg[data-look-glyph]")!);
    expect(glyphs.map((g) => g.getAttribute("data-look-glyph"))).toEqual(["home", "lessons", "coaching", "training", "more"]);
    glyphs.forEach((g) => expect(g.getAttribute("width")).toBe("22"));
    expect(items().map((a) => a.textContent)).toEqual(["Home", "Lesson Plans", "Digital Coaching", "Training", "More"]);
  });

  it("the current item follows the page", async () => {
    await on("/portal/teacher/training");
    const cur = screen.getByTestId("teacher-nav").querySelector('a[aria-current="page"]')!;
    expect(cur.textContent).toBe("Training");
    expect(cur.className).toContain("font-bold");
  });

  it("the desktop bar is untouched", async () => {
    vi.mocked(readConfigShared).mockResolvedValue(config(false));
    const off = at();
    await act(async () => { await Promise.resolve(); });
    const before = Array.from(screen.getByTestId("teacher-top-nav").querySelectorAll("a")).map((a) => a.className);
    off.unmount();
    await on();
    expect(Array.from(screen.getByTestId("teacher-top-nav").querySelectorAll("a")).map((a) => a.className)).toEqual(before);
  });
});

describe("TeacherNavigation — the coach never reads the look", () => {
  it("no /config read for the look, and the coach's bar is today's even with the look on", async () => {
    vi.mocked(readConfigShared).mockResolvedValue(config(true));
    at("/portal/coach", "coach");
    await act(async () => { await Promise.resolve(); });
    expect(readConfigShared).not.toHaveBeenCalled();
    expect(items().map((a) => a.className)).toEqual([TODAY_ON, TODAY_OFF, TODAY_OFF, TODAY_OFF, TODAY_OFF]);
  });
});
