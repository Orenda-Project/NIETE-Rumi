import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WindowsProvider } from "../../coach/insights/count";
import { RingCount } from "../Count";
import type { RingSize } from "../tokens";

const W = [{ id: "w1", from: "2026-09-28", to: "2026-10-25", grader: "ai_fico", grader_label: null, scoring_changed_on: null }] as never;

/**
 * bd-sex15q.47 (ux-rm 181146) — a sector count reaches three digits ("171 of 505"); at 22 px in the 56 px row ring
 * (44 px inside the stroke) it sits on the arc. From three digits the number steps down: row 17, card 20, hero 40.
 */
const BIG: Record<RingSize, string> = { row: "text-[17px]", card: "text-[20px]", hero: "text-[40px]" };
const SMALL: Record<RingSize, string> = { row: "text-[22px]", card: "text-[24px]", hero: "text-[52px]" };

describe.each(["en", "ur"] as const)("the ring's number fits inside the ring (%s)", (lang) => {
  it.each(["row", "card", "hero"] as RingSize[])("%s: three digits step down, two keep the token size", (size) => {
    const num = (n: number) => {
      const { container, unmount } = render(
        <WindowsProvider windows={W}><RingCount count={{ n, d: 505, window_id: "w1" }} lang={lang} size={size} /></WindowsProvider>,
      );
      const cls = (container.querySelector(".cp-ring__n") as HTMLElement).className;
      unmount();
      return cls;
    };
    expect(num(171)).toContain(BIG[size]);
    expect(num(41)).toContain(SMALL[size]);
  });
});
