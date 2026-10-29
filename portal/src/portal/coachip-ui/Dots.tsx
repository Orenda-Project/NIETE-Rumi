export type DotState = "done" | "partial" | "none";

/**
 * bd-sex15q.42 — the three recordings after a step (DESIGN_SYSTEM §7): 14 px circles, green when the recording showed
 * the step, half green when it partly did, an empty grey ring when not yet. Decorative: the row's words say it.
 */
export function Dots({ states, testId = "cp-dots", className }: { states: readonly DotState[]; testId?: string; className?: string }) {
  return (
    <span data-testid={testId} aria-hidden="true" className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      {states.map((s, i) => (
        <i
          key={i}
          data-state={s}
          className={`block h-3.5 w-3.5 rounded-full border-[1.5px] ${s === "done" ? "border-cp-green bg-cp-green" : s === "partial" ? "border-cp-green bg-[linear-gradient(90deg,var(--cp-green)_50%,#fff_50%)] rtl:bg-[linear-gradient(270deg,var(--cp-green)_50%,#fff_50%)]" : "border-cp-track bg-white"}`}
        />
      ))}
    </span>
  );
}
