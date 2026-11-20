import type { ReactNode } from "react";
import { Target } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * bd-o15qnr.28.1 (queue #204, v7) — the pieces v7's week page, Home's Monday "Your week" and My progress share, drawn as
 * #188's c8 boards draw them, in the reports' look (CoachReportPage's dark top card; that file is not changed):
 *
 *   DarkTop       the reports' dark top card: an eyebrow and the NIETE mark, one big count ("5/12") and its words, the
 *                 twelve segments, an optional foot line
 *   Segments      one segment per observation of the target: green the complete ones (never red)
 *   KeyFocusCard  the Key Focus Area, option B (the operator, 20 Nov 15:04, "B."): a tinted card (#f1edfd), a 6px purple
 *                 start edge, the target icon and the KEY FOCUS AREA label; its name; "4 of 10", a bar with the goal mark,
 *                 "Goal 6 of 10" (c8-week-focus-options option A: one count and a goal mark, no sentences)
 *   GoalBar       the focus's bar: filled to its share, the goal mark at FOCUS_DONE_AT / FOCUS_WINDOW
 *   CountBar      a behaviour's bar: green from 60% (the same 6 of 10 rule), amber below; never red
 *   RespectLine   Respect held on its own green line: the must-pass check, not one of the 8 (the debrief report's
 *                 one-line look and its words, copyV7 respectNote)
 *
 * Counts in the words, never a % (the operator: "Just the debrief scores like 2/8, 5/8"); a bar shows the share.
 */

/** Share of `of`, 0–100, for a bar's width only (never printed). */
export const shareOf = (done: number, of: number): number => (of > 0 ? Math.round((Math.min(done, of) / of) * 100) : 0);
/** Green from 6 of 10 (bot coach-week.js FOCUS_DONE_AT / FOCUS_WINDOW), amber below. */
export const atGoal = (done: number, of: number): boolean => of > 0 && done * 10 >= of * 6;

export function Segments({ done, of, dark = true, label }: { done: number; of: number; dark?: boolean; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex gap-[3px]">
      {Array.from({ length: Math.max(0, of) }, (_, i) => (
        <i key={i} data-segment={i < done ? "on" : "off"}
          className={cn("h-2 flex-1 rounded-full", i < done ? "bg-[#47ba7d]" : dark ? "bg-white/20" : "bg-[#e5e7eb]")} />
      ))}
    </div>
  );
}

export function DarkTop({ eyebrow, done, of, words, foot, testId, ariaLabel }: {
  eyebrow: string; done: number; of: number; words: string; foot?: ReactNode; testId: string; ariaLabel: string;
}) {
  return (
    <section aria-label={ariaLabel} data-testid={testId} className="flex flex-col gap-3 rounded-[22px] bg-[#33374a] px-[18px] pb-4 pt-[18px] text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[.08em] text-[#a9e3c4] rtl:normal-case rtl:tracking-normal rtl:text-[13px]">{eyebrow}</span>
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#47ba7d] text-[15px] font-black text-white">N</span>
      </div>
      <div className="flex items-baseline gap-2.5">
        <b dir="ltr" data-testid={`${testId}-count`} className="text-[48px] font-extrabold leading-none tracking-[-.02em]">{`${done}/${of}`}</b>
        <span className="text-[15px] font-semibold text-[#c6e9d5]">{words}</span>
      </div>
      <Segments done={done} of={of} label={`${done}/${of}`} />
      {foot ? <div className="border-t border-white/15 pt-2.5 text-[14px] leading-[1.45] text-[#e2e5ea]">{foot}</div> : null}
    </section>
  );
}

export function GoalBar({ done, of, goal, window }: { done: number; of: number; goal: number; window: number }) {
  const fill = shareOf(done, of);
  const mark = shareOf(goal, window);
  return (
    <div data-testid="goal-bar" data-fill={fill} data-goal={mark} aria-hidden="true" className="relative h-2.5 min-w-[56px] flex-1 rounded-full bg-[#e5e7eb]">
      <i className="absolute inset-y-0 start-0 rounded-full bg-[#6e52e0]" style={{ width: `${fill}%` }} />
      <b className="absolute -bottom-1 -top-1 w-0.5 bg-[#1d2025]" style={{ insetInlineStart: `${mark}%` }} />
    </div>
  );
}

/** The focus's count row: "4 of 10", its bar, "Goal 6 of 10". */
export function FocusCount({ count, goalText, done, of, goal, window }: {
  count: string; goalText: string; done: number; of: number; goal: number; window: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[22px] font-normal leading-none"><bdi>{count}</bdi></span>
      <GoalBar done={done} of={of} goal={goal} window={window} />
      <span className="shrink-0 text-[13px] font-bold text-[#6b7280]"><bdi>{goalText}</bdi></span>
    </div>
  );
}

export function KeyFocusIcon() {
  return <Target aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} />;
}

export function KeyFocusCard({ label, name, children, testId }: { label: string; name: string; children?: ReactNode; testId: string }) {
  return (
    <section aria-label={label} data-testid={testId} data-variant="option-b"
      className="flex flex-col gap-2 rounded-[16px] border-0 border-s-[6px] border-solid border-[#6e52e0] bg-[#f1edfd] px-3.5 py-3">
      <h3 className="m-0 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[.06em] text-[#6e52e0] rtl:normal-case rtl:tracking-normal">
        <KeyFocusIcon />{label}
      </h3>
      <p className="m-0 text-[22px] font-light leading-[1.25] text-[#1d2025]">{name}</p>
      {children}
    </section>
  );
}

export function CountBar({ done, of }: { done: number; of: number }) {
  const good = atGoal(done, of);
  return (
    <span aria-hidden="true" className="h-2 w-[70px] shrink-0 overflow-hidden rounded-full bg-[#e5e7eb]">
      <i data-fill={shareOf(done, of)} className={cn("block h-full", good ? "bg-[#47ba7d]" : "bg-[#f59e0b]")} style={{ width: `${shareOf(done, of)}%` }} />
    </span>
  );
}

/** The report's tick (CoachReportPage draws the same; not imported, so Home does not pull the report page in). */
function Tick({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="shrink-0">
      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RespectLine({ label, note, testId }: { label: string; note: string; testId: string }) {
  return (
    <p data-testid={testId} className="m-0 flex items-center gap-2 rounded-[14px] bg-[#eaf6ef] px-3.5 py-2.5 text-[14px] font-semibold text-[#2f7a52]">
      <Tick size={16} /><span className="min-w-0 flex-1">{label}<span className="font-medium"> · {note}</span></span>
    </p>
  );
}
