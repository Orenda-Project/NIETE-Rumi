import type { ReactNode } from "react";
import { useLang } from "../../teacher/i18n";
import { CountSpan } from "../../coach/insights/count";
import type { FillValue } from "../../coach/insights/format";
import type { Count } from "../../coach/insights/types";
import { rt, type AnyKey } from "../text";

/**
 * bd-sex15q.17 — one activity line that says a Count in its own words ("2 of 7 schools not visited in 4 weeks"): the
 * whole sentence carries the count's `data-num/den/win/grader`, so the other digits in it (the 4 weeks, the floor) sit
 * inside the marked node and the line still reads as one sentence (SPEC v2 §9).
 *
 * fix-r5 s2 items 3 + 5 (B10): with `none`, a count whose base is 0 is a state with nothing to count, so the line is
 * those WORDS and carries no number node ("No debriefs recorded this month", never "0 of 0 debriefs").
 */
export function CountLine({ k, count, vars, className, as = "span", children, none }: {
  k: AnyKey; count: Count; vars?: Record<string, FillValue>; className?: string; as?: "span" | "p" | "div"; children?: ReactNode; none?: AnyKey;
}) {
  const lang = useLang();
  if (none && count.d === 0) {
    const Tag = as;
    return <Tag data-none="" className={className}>{rt(none, lang)}{children}</Tag>;
  }
  return <CountSpan count={count} className={className} as={as}>{rt(k, lang, { n: count.n, d: count.d, ...vars })}{children}</CountSpan>;
}
