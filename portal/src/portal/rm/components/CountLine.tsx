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
 */
export function CountLine({ k, count, vars, className, as = "span", children }: {
  k: AnyKey; count: Count; vars?: Record<string, FillValue>; className?: string; as?: "span" | "p" | "div"; children?: ReactNode;
}) {
  const lang = useLang();
  return <CountSpan count={count} className={className} as={as}>{rt(k, lang, { n: count.n, d: count.d, ...vars })}{children}</CountSpan>;
}
