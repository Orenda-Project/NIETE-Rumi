import type { ReactNode } from "react";

/**
 * bd-sex15q.42 — THE one elevated surface on a screen (DESIGN_SYSTEM §3): white, radius 20, one level of shadow. S1's
 * overlapping card, S2's step card, S8's weaknesses block, the laptop hero. Everything else is flat on the ground,
 * divided by hairlines (Section, Row). `overlap` rides it 24 px up over the band above it (phone only).
 */
export function Surface({ children, testId, className, overlap = false, as: Tag = "section", ...rest }: {
  children: ReactNode; testId?: string; className?: string; overlap?: boolean; as?: "section" | "div" | "article";
} & { [k: `data-${string}`]: string | number | undefined }) {
  return (
    <Tag
      {...rest}
      data-testid={testId}
      data-surface=""
      className={`flex flex-col gap-3 rounded-[20px] bg-cp-surface p-5 shadow-[0_2px_8px_rgba(51,55,72,0.08)] lg:p-7 ${overlap ? "cp-overlap" : ""} ${className ?? ""}`}
    >
      {children}
    </Tag>
  );
}
