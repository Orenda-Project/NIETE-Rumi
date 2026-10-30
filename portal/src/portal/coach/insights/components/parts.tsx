import { Children, isValidElement, type ReactNode } from "react";

/**
 * bd-sex15q.46 (R6) — S1's own copy of player/PairCard's `NO_PART` / `dropPart` (fix-r5 s2 item 17). StepRow is on
 * the coach's first open; importing the two helpers from the player pulled the whole PairCard chunk (~1.1 KB gz) into
 * the coach-entry budget (≤ 250,000 B gz). Same behaviour; the player keeps its own pair for S4.
 */

/** A placeholder node for a template part the payload lacks; `dropPart` removes it and its separator. */
export const NO_PART = <span data-part="none" hidden />;

const SEP = /^\s*(·|،)\s*$/;

/** Remove one token's node (and the " · " / "، " beside it) from what `tx()` rendered; the words stay COPY's. */
export function dropPart(node: ReactNode, part: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const kids = Children.toArray((node.props as { children?: ReactNode }).children);
  const inner = kids.map((k) => (isValidElement(k) ? (k.props as { children?: ReactNode }).children : k));
  const i = inner.findIndex((x) => x === part);
  if (i < 0) return node;
  const drop = new Set([i]);
  if (typeof inner[i + 1] === "string" && SEP.test(inner[i + 1] as string)) drop.add(i + 1);
  else if (typeof inner[i - 1] === "string" && SEP.test(inner[i - 1] as string)) drop.add(i - 1);
  return <>{kids.filter((_, j) => !drop.has(j))}</>;
}
