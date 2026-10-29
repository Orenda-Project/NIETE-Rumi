import type { ReactNode } from "react";

export type PillTone = "green" | "tint" | "grey" | "navy-tint" | "on-navy";

const TONE: Record<PillTone, string> = {
  green: "bg-cp-green text-cp-navy",
  tint: "bg-cp-green-tint text-cp-green-ink",
  grey: "bg-cp-navy-tint text-cp-ink-2",
  "navy-tint": "bg-cp-navy-tint text-cp-navy",
  "on-navy": "bg-white/10 text-white",
};

/**
 * bd-sex15q.42 — a pill (12/600, radius 999): the window on the band (`green`), a chip on white (`tint`), "not yet"
 * (`grey`). Never a button. Pass `as="p"` with the window's `data-window` when the pill IS the window element.
 */
export function Pill({ children, tone = "tint", className, testId, as: Tag = "span", ...rest }: {
  children: ReactNode; tone?: PillTone; className?: string; testId?: string; as?: "span" | "p";
} & { [k: `data-${string}`]: string | number | undefined }) {
  return (
    <Tag {...rest} data-testid={testId} className={`inline-block rounded-full px-3 py-[5px] text-[12px] font-semibold leading-[1.4] ${TONE[tone]} ${className ?? ""}`}>
      {children}
    </Tag>
  );
}
