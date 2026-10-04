import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import tailwindConfig from "../../../../tailwind.config";
import SendLessonButton from "./SendLessonButton";

// bd-5rz1v.9 — the deep-green "Send a lesson" button read as a banner: a centred
// picture, a title and a caption, with nothing that says "tap me". The operator
// chose (3 Oct) the row in coaching-mockups.html ("Chosen"):
//
//   ( chalkboard )  Send a lesson to your Digital Coach        ( → )
//                   Record it in class, or send one you ...
//
// a raised edge that sinks when pressed, a soft light sweep across it every 4s
// and a ring pulsing out of the arrow every 2s. Both stop for reduced motion.
// The ripple behind the chalkboard goes: it read as "live", not "tap".

const TITLE = "Send a lesson to your Digital Coach";
const SUB = "Record it in class, or send one you already have.";

function renderButton(onClick = vi.fn()) {
  render(<SendLessonButton title={TITLE} sub={SUB} onClick={onClick} testId="send-a-lesson" />);
  return { btn: screen.getByTestId("send-a-lesson"), onClick };
}

const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

describe("SendLessonButton — reads as a button", () => {
  it("is one row at every width: chalkboard at the start, the words, then a white arrow circle at the end", () => {
    const { btn } = renderButton();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "button");
    const cls = classesOf(btn);
    expect(cls).toContain("flex");
    expect(cls).toContain("items-center");
    // never stacked on phones, no centred banner text
    expect(cls.some((c) => /(^|:)flex-col$/.test(c))).toBe(false);
    expect(cls.some((c) => /(^|:)text-center$/.test(c))).toBe(false);
    expect(cls).toContain("text-start");

    const arrow = within(btn).getByTestId("send-lesson-arrow");
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(classesOf(arrow)).toEqual(expect.arrayContaining(["h-[42px]", "w-[42px]", "rounded-full", "bg-white", "shrink-0"]));
    expect(arrow.querySelector("svg")).not.toBeNull();

    const board = btn.querySelector("svg[viewBox='0 0 64 64']") as SVGElement;
    expect(board).not.toBeNull();
    expect(board.getAttribute("width")).toBe("36");
    const title = within(btn).getByText(TITLE);
    const sub = within(btn).getByText(SUB);
    expect(classesOf(sub)).toContain("text-[#d9f0e3]");
    // picture → words → arrow, in reading order
    expect(board.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(sub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sub.compareDocumentPosition(arrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the arrow points the reading direction: it flips in RTL, and the padding is logical so the row mirrors", () => {
    const { btn } = renderButton();
    const svg = within(btn).getByTestId("send-lesson-arrow").querySelector("svg")!;
    expect(classesOf(svg)).toContain("rtl:rotate-180");
    const cls = classesOf(btn);
    expect(cls.some((c) => /^(sm:)?p[lr]-/.test(c))).toBe(false);
    expect(cls.some((c) => /^(sm:)?p[se]-/.test(c) || /^(sm:)?px-/.test(c))).toBe(true);
  });

  it("has a raised edge that sinks when pressed, goes darker on hover, and shows a focus ring", () => {
    const { btn } = renderButton();
    const cls = classesOf(btn);
    expect(cls).toContain("bg-[#2e7d57]");
    expect(cls).toContain("shadow-[0_5px_0_#1d5a3d,0_10px_20px_rgba(46,125,87,0.28)]");
    expect(cls).toContain("active:translate-y-1");
    expect(cls.some((c) => c.startsWith("active:shadow-[0_1px_0_#1d5a3d"))).toBe(true);
    expect(cls).toContain("hover:bg-[#2a7350]");
    expect(cls).toEqual(expect.arrayContaining([
      "focus-visible:outline", "focus-visible:outline-[3px]", "focus-visible:outline-offset-[3px]", "focus-visible:outline-[#ffd54f]",
    ]));
  });

  it("has no ripple behind the chalkboard any more", () => {
    const { btn } = renderButton();
    expect(btn.querySelector("[class*='animate-rec-wave']")).toBeNull();
  });

  it("a light sweep crosses it and a ring pulses out of the arrow; both stop for reduced motion", () => {
    const { btn } = renderButton();
    expect(classesOf(btn)).toEqual(expect.arrayContaining(["relative", "overflow-hidden"]));

    const sheen = within(btn).getByTestId("send-lesson-sheen");
    expect(classesOf(sheen)).toEqual(expect.arrayContaining(["animate-send-sheen", "motion-reduce:hidden", "pointer-events-none", "absolute"]));
    expect(sheen.closest("[aria-hidden='true']")).not.toBeNull();

    const arrow = within(btn).getByTestId("send-lesson-arrow");
    expect(classesOf(arrow)).toEqual(expect.arrayContaining(["animate-send-halo", "motion-reduce:animate-none"]));

    // every animation on the button is stopped for reduced motion
    const animated = [btn, ...Array.from(btn.querySelectorAll("*"))].filter((el) => classesOf(el).some((c) => c.startsWith("animate-")));
    expect(animated.length).toBe(2);
    for (const el of animated) {
      expect(classesOf(el).some((c) => c === "motion-reduce:animate-none" || c === "motion-reduce:hidden")).toBe(true);
    }
  });

  it("every animation it uses is defined in tailwind.config.ts, and moves only transform, opacity or box-shadow", () => {
    const { btn } = renderButton();
    const theme = tailwindConfig.theme.extend as {
      animation: Record<string, string>;
      keyframes: Record<string, Record<string, Record<string, string>>>;
    };
    const names = [btn, ...Array.from(btn.querySelectorAll("*"))]
      .flatMap((el) => classesOf(el))
      .filter((c) => c.startsWith("animate-"))
      .map((c) => c.slice("animate-".length));
    expect(names.sort()).toEqual(["send-halo", "send-sheen"]);
    expect(theme.animation["send-sheen"]).toMatch(/^send-sheen 4s .*infinite$/);
    expect(theme.animation["send-halo"]).toMatch(/^send-halo 2s .*infinite$/);
    for (const name of names) {
      const frames = theme.keyframes[name];
      expect(frames).toBeTruthy();
      const props = Object.values(frames).flatMap((f) => Object.keys(f));
      for (const p of props) expect(["transform", "opacity", "boxShadow"]).toContain(p);
    }
  });

  it("calls onClick when tapped", () => {
    const { btn, onClick } = renderButton();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
