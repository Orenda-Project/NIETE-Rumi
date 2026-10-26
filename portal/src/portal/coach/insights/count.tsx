/**
 * bd-sex15q.15 — the DOM count contract (SPEC v2 §9, CONVERGENCE G10). Every number a COACHIP screen shows goes
 * through this file:
 *
 *   <Num count>       a Count: `data-num`, `data-den`, `data-win` (the Window id) and `data-grader`; the text says
 *                     n and d ("17 of 49" / "۴۹ میں سے ۱۷").
 *   <CountSpan count> the same attributes around a sentence that says n and d in its own words.
 *   <StatSpan stat>   a derived statistic: `data-stat` + `data-base` (+ `data-win`), never `data-num`.
 *   <WindowMark>      the element a `data-win` resolves to (`data-window="<id>"`): the card's meta line, or the app
 *                     bar on a one-W screen.
 *   <DateText>, <CodeText>, <LibraryText>
 *                     digits that are not counts (a date, a code, the library's own words), marked so the golden can
 *                     tell them from a bare number.
 *
 * `domContract(root)` is what each page's golden asserts: every count node carries all four attributes and its
 * window resolves, every stat its base, and no digit is shown outside a marked node.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Lang } from "../../teacher/i18n";
import { dateLong, dateShort, isolate, nOfD } from "./format";
import type { Count, Stat, Window } from "./types";

const WindowsCtx = createContext<readonly Window[]>([]);

/** The payload's `windows` list, so a Count can name its grader. */
export function WindowsProvider({ windows, children }: { windows: readonly Window[] | null | undefined; children: ReactNode }) {
  return <WindowsCtx.Provider value={windows ?? []}>{children}</WindowsCtx.Provider>;
}

function useGrader(windowId: string): string {
  const w = useContext(WindowsCtx).find((x) => x.id === windowId);
  return w?.grader ?? "";
}

export function countAttrs(count: Count, grader: string) {
  return { "data-num": count.n, "data-den": count.d, "data-win": count.window_id, "data-grader": grader };
}

/** "17 of 49" with the contract's attributes. */
export function Num({ count, lang, className }: { count: Count; lang: Lang; className?: string }) {
  const grader = useGrader(count.window_id);
  return (
    <span {...countAttrs(count, grader)} className={className}>
      {nOfD(count.n, count.d, lang)}
    </span>
  );
}

/** A sentence that says n and d in its own words (COPY wrote it), carrying the count's attributes. */
export function CountSpan({ count, children, className, as: Tag = "span" }: { count: Count; children: ReactNode; className?: string; as?: "span" | "p" | "div" }) {
  const grader = useGrader(count.window_id);
  return <Tag {...countAttrs(count, grader)} className={className}>{children}</Tag>;
}

/** S7's "children tested" against the floor of 5: d is the floor (API R15). */
export function TestedSpan({ tested, children, className }: { tested: { n: number; floor: number; window_id: string }; children: ReactNode; className?: string }) {
  return <CountSpan count={{ n: tested.n, d: tested.floor, window_id: tested.window_id }} className={className}>{children}</CountSpan>;
}

/** A derived statistic: its base said once, carried as `data-base`. */
export function StatSpan({ stat, children, className, as: Tag = "span" }: { stat: Stat; children: ReactNode; className?: string; as?: "span" | "p" }) {
  return (
    <Tag data-stat={stat.kind} data-base={stat.base} data-win={stat.window_id} className={className}>
      {children}
    </Tag>
  );
}

/** The element a card's `data-win` resolves to. */
export function WindowMark({ window, children, className, as: Tag = "p" }: { window: Window; children: ReactNode; className?: string; as?: "p" | "span" | "div" }) {
  return <Tag data-window={window.id} className={className}>{children}</Tag>;
}

/** A date written by §F; its digits are a date, not a count. */
export function DateText({ iso, lang, short = false }: { iso: string; lang: Lang; short?: boolean }) {
  return <span data-date={iso}>{short ? dateShort(iso, lang) : dateLong(iso, lang)}</span>;
}

/** A teacher code, a school name or a library id: an LTR atom, isolated inside Urdu. */
export function CodeText({ children, lang }: { children: string; lang: Lang }) {
  return <span data-code="" dir={lang === "ur" ? "ltr" : undefined} className="[unicode-bidi:isolate]">{isolate(children, lang)}</span>;
}

/** The library's own words (a step, a script): verbatim, numbers and all. */
export function LibraryText({ children, className, as: Tag = "span" }: { children: ReactNode; className?: string; as?: "span" | "p" | "div" }) {
  return <Tag data-text="library" className={className}>{children}</Tag>;
}

/* ── the golden's check ──────────────────────────────────────────────────── */

const MARKED = "[data-num],[data-stat],[data-date],[data-code],[data-text],[data-window],[data-clock],[data-nonum]";

export type ContractReport = {
  nums: number;
  numsWithDenWin: number;
  unresolvedWins: string[];
  stats: number;
  statsWithBase: number;
  bareDigits: string[];
};

/** What every page golden asserts: nums === numsWithDenWin, no unresolved window, no bare digit. */
export function domContract(root: ParentNode): ContractReport {
  const nums = Array.from(root.querySelectorAll<HTMLElement>("[data-num]"));
  const windows = new Set(Array.from(root.querySelectorAll<HTMLElement>("[data-window]")).map((e) => e.dataset.window));
  const ok = nums.filter((e) => e.dataset.den !== undefined && e.dataset.win && e.dataset.grader !== undefined
    && (e.textContent || "").length > 0);
  const unresolved = [...nums, ...Array.from(root.querySelectorAll<HTMLElement>("[data-stat]"))]
    .map((e) => e.dataset.win || "")
    .filter((id) => !windows.has(id));
  const stats = Array.from(root.querySelectorAll<HTMLElement>("[data-stat]"));
  const bare: string[] = [];
  const walker = (root as Node).ownerDocument
    ? (root as Node).ownerDocument!.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */)
    : null;
  if (walker) {
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent || "";
      if (!/[0-9۰-۹]/.test(text)) continue;
      const host = n.parentElement;
      if (host && host.closest(MARKED)) continue;
      if (host && host.closest("script,style,svg,audio")) continue;
      bare.push(text.trim());
    }
  }
  return {
    nums: nums.length,
    numsWithDenWin: ok.length,
    unresolvedWins: Array.from(new Set(unresolved)),
    stats: stats.length,
    statsWithBase: stats.filter((e) => e.dataset.base !== undefined).length,
    bareDigits: bare,
  };
}
