import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WindowsProvider, domContract } from "../../coach/insights/count";
import { nOfD } from "../../coach/insights/format";
import { RingCount, RowCount, splitNofD } from "../Count";

const W = [{ id: "w1", from: "2026-09-28", to: "2026-10-25", grader: "ai_fico", grader_label: null, scoring_changed_on: null }] as never;
const count = { n: 18, d: 46, window_id: "w1" };

/** bd-sex15q.42 — the number pattern keeps G10: one count node, all four attrs, text exactly nOfD, in both languages. */
describe.each(["en", "ur"] as const)("the number pattern (%s)", (lang) => {
  it("splitNofD rebuilds nOfD exactly", () => {
    for (const [n, d] of [[0, 1], [18, 46], [171, 505]]) {
      const s = splitNofD(n, d, lang);
      expect(s.numFirst ? s.num + s.rest : s.rest + s.num).toBe(nOfD(n, d, lang));
    }
  });

  it("RingCount: the count node carries the attrs and reads nOfD; the sentence sits outside it; the window resolves", () => {
    const { container } = render(
      <WindowsProvider windows={W}>
        <div><p data-window="w1">window</p>
          <RingCount count={count} lang={lang} size="hero"><p data-testid="s">sentence</p></RingCount></div>
      </WindowsProvider>,
    );
    const node = container.querySelector("[data-num]") as HTMLElement;
    expect([node.dataset.num, node.dataset.den, node.dataset.win, node.dataset.grader]).toEqual(["18", "46", "w1", "ai_fico"]);
    expect(node.textContent).toBe(nOfD(18, 46, lang));
    expect(node.contains(container.querySelector('[data-testid="s"]'))).toBe(false);
    expect(node.querySelector("[data-ring='hero']")).not.toBeNull();
    const c = domContract(container);
    expect({ ok: c.numsWithDenWin, unresolved: c.unresolvedWins, bare: c.bareDigits }).toEqual({ ok: 1, unresolved: [], bare: [] });
  });

  it("RingCount puts the ring at the inline start in English and the inline end in Urdu", () => {
    const { container } = render(<WindowsProvider windows={W}><RingCount count={count} lang={lang} /></WindowsProvider>);
    const ring = container.querySelector("[data-ring]") as HTMLElement;
    expect(ring.className).toContain(lang === "ur" ? "col-start-2" : "col-start-1");
  });

  it("RowCount: a big n in <b> and the small rest, one node reading nOfD", () => {
    const { container } = render(<WindowsProvider windows={W}><RowCount count={count} lang={lang} /></WindowsProvider>);
    const node = container.querySelector("[data-num]") as HTMLElement;
    expect(node.textContent).toBe(nOfD(18, 46, lang));
    expect(node.querySelector("b")?.textContent).toBe(lang === "ur" ? "۱۸" : "18");
    expect(node.dataset.win).toBe("w1");
  });
});
