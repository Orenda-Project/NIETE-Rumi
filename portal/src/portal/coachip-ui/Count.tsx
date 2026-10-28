import type { ReactNode } from "react";
import type { Lang } from "../teacher/i18n";
import { countAttrs, useGrader } from "../coach/insights/count";
import { digits, nOfD } from "../coach/insights/format";
import type { Count } from "../coach/insights/types";
import { Ring } from "./Ring";
import type { RingSize } from "./tokens";

/**
 * bd-sex15q.42 — the number pattern made beautiful (DESIGN_SYSTEM §5), on top of the G10 count contract.
 *
 * The count node keeps every attribute (`data-num`, `data-den`, `data-win`, `data-grader`) and its text is exactly
 * format.ts's `nOfD` ("18 of 46" / "۴۶ میں سے ۱۸"): the big n and the small "of d" are two children of ONE node, in
 * the order the language reads them. Nothing here adds a word: the split is taken from `nOfD` itself.
 */
export function splitNofD(n: number, d: number, lang: Lang): { num: string; rest: string; numFirst: boolean } {
  const full = nOfD(n, d, lang);
  const num = digits(n, lang);
  if (lang === "ur" && full.endsWith(num)) return { num, rest: full.slice(0, full.length - num.length), numFirst: false };
  if (full.startsWith(num)) return { num, rest: full.slice(num.length), numFirst: true };
  return { num: full, rest: "", numFirst: true };
}

const N_SIZE: Record<RingSize, string> = {
  hero: "cp-hero-n text-[52px] leading-none tracking-[-0.02em]",
  card: "text-[24px] leading-none",
  row: "text-[22px] leading-none",
};
/** bd-sex15q.47 (ux-rm 181146): from three digits the number steps down so it stays inside the ring's stroke. */
const N_SIZE_3: Record<RingSize, string> = {
  hero: "cp-hero-n text-[40px] leading-none tracking-[-0.02em]",
  card: "text-[20px] leading-none",
  row: "text-[17px] leading-none",
};
const DEN_SIZE: Record<RingSize, string> = {
  hero: "text-[22px] font-bold leading-tight",
  card: "text-[18px] font-bold leading-tight text-cp-navy",
  row: "text-[17px] font-bold leading-tight text-cp-navy",
};

/**
 * A ring with the big number in its centre, "of d" beside it, and the sentence (children) under "of d". The count node
 * is `display: contents`, so the ring and "of d" are grid cells while the attributes stay on one element. In Urdu the
 * ring stands at the inline end (DESIGN_SYSTEM §5).
 */
export function RingCount({ count, lang, size = "card", children, className, testId }: {
  count: Count; lang: Lang; size?: RingSize; children?: ReactNode; className?: string; testId?: string;
}) {
  const grader = useGrader(count.window_id);
  const { num, rest } = splitNofD(count.n, count.d, lang);
  const ur = lang === "ur";
  const ringCell = ur ? "col-start-2" : "col-start-1";
  const textCell = ur ? "col-start-1" : "col-start-2";
  const ring = (
    <Ring key="ring" n={count.n} d={count.d} size={size} className={`${ringCell} row-span-2 row-start-1 self-start`}>
      <span className={`cp-ring__n font-extrabold ${(String(count.n).length >= 3 ? N_SIZE_3 : N_SIZE)[size]}`}>{num}</span>
    </Ring>
  );
  const den = <span key="den" className={`${textCell} row-start-1 self-end ${DEN_SIZE[size]}`}>{rest}</span>;
  return (
    <div data-testid={testId} className={`grid items-start gap-x-4 gap-y-1 ${ur ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[auto_minmax(0,1fr)]"} ${className ?? ""}`}>
      <span {...countAttrs(count, grader)} className="contents">{ur ? [den, ring] : [ring, den]}</span>
      {children && <div className={`${textCell} row-start-2 min-w-0`}>{children}</div>}
    </div>
  );
}

/** A row's number: 22/800 n and 13/600 "of d" on one baseline (the bar, if any, is a FractionBar beside it). */
export function RowCount({ count, lang, className }: { count: Count; lang: Lang; className?: string }) {
  const grader = useGrader(count.window_id);
  const { num, rest, numFirst } = splitNofD(count.n, count.d, lang);
  const n = <b key="n" className="text-[22px] font-extrabold leading-[1.1] tracking-[-0.01em] text-cp-navy">{num}</b>;
  const r = <span key="r" className="text-[13px] font-semibold text-cp-ink-3">{rest}</span>;
  return (
    <span {...countAttrs(count, grader)} className={`inline-flex items-baseline whitespace-pre ${className ?? ""}`}>
      {numFirst ? [n, r] : [r, n]}
    </span>
  );
}

/**
 * bd-sex15q.42 — a 4 px fraction bar under or beside a row's number (DESIGN_SYSTEM §5) on the grey track. It lives
 * here beside the counts since R6 fix cycle 1: one module, so S5's ring and the pages that draw bars share one chunk on
 * the coach entry path (FIX_R6 §1 budget). It fills from the inline start, so from the right in Urdu. A zero draws the track only. Decorative: the count node beside it carries
 * the number. `tone` (FIX_R6 A5): `notice` (navy, the default: lessons where a weakness showed), `grey` the smaller
 * cause on S2's Why, `green` a strength (something done).
 */
const FILL = { notice: "bg-cp-navy", grey: "bg-cp-ink-3", green: "bg-cp-green" } as const;

export function FractionBar({ n, d, tone = "notice", className }: { n: number; d: number; tone?: keyof typeof FILL; className?: string }) {
  const pct = d > 0 ? Math.min(100, Math.max(0, (n / d) * 100)) : 0;
  return (
    <span aria-hidden="true" data-bar={`${n}/${d}`} data-tone={tone} className={`block h-1 overflow-hidden rounded-full bg-cp-track ${className ?? ""}`}>
      {pct > 0 && <span data-fill="" className={`block h-full rounded-full ${FILL[tone]}`} style={{ width: `${pct}%` }} />}
    </span>
  );
}
