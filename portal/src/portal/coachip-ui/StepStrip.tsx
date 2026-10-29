import type { ReactNode } from "react";

export type StepState = "done" | "current" | "todo";

/**
 * bd-sex15q.42 — the five-segment lesson strip (DESIGN_SYSTEM §7, A's form): one slim segment per plan step in one row,
 * its label under it; done = green, current = outlined green, not done = grey. Never red. The strip reads in the
 * lesson's order, so it stays LTR in Urdu (ChapterStrip's rule) unless `dir` says otherwise.
 */
export function StepStrip({ steps, testId = "cp-step-strip", dir = "ltr", className }: {
  steps: readonly { label: ReactNode; state: StepState; key?: string }[]; testId?: string; dir?: "ltr" | "rtl"; className?: string;
}) {
  return (
    <ol data-testid={testId} dir={dir} className={`grid gap-1.5 ${className ?? ""}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, steps.length)}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={s.key ?? i} data-state={s.state} className="flex min-w-0 flex-col gap-1.5">
          <span
            aria-hidden="true"
            className={s.state === "done"
              ? "block h-1.5 rounded-[3px] bg-cp-green"
              : s.state === "current"
                ? "-mt-px block h-2 rounded-[3px] border-[1.5px] border-cp-green bg-white"
                : "block h-1.5 rounded-[3px] bg-cp-track"}
          />
          <span className={`truncate text-[12px] leading-[1.3] ${s.state === "done" ? "text-cp-green-ink" : "text-cp-ink-2"} ${s.state === "current" ? "font-semibold" : ""}`}>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
