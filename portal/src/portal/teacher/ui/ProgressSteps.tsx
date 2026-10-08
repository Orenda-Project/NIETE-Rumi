import { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TEACHER_UI_COPY, type TeacherUiCopy } from './copy';
import { FOCUS } from './styles';

/**
 * bd-fmf24g.2.3 — ProgressSteps (COMPONENTS.md §6): where a report is up to. A white card: the heading + "n of N",
 * then one row per step — a 28px dot (done green with a tick; current white with a 2.5px indigo ring and a dot;
 * later a grey ring with its number), a line down to the next (green under done steps), the label (16px; 700
 * current, 600 done, 500 grey later), a muted sub-line, and on the current step a waiting chip (its `nowText`, else
 * "Now"). Finished (`done`): one 56px green "Done · {doneLabel}" line; a tap shows the steps again (`open` sets it
 * from outside; a tap still toggles until `open` changes).
 *
 * The steps are the page's, from the real stages (DC: coaching_sessions.status; coach visit: review → debrief →
 * delivery). Labels and sub-lines are the page's words.
 */

export interface ProgressStep {
  label: string;
  sub?: string;
  state: 'done' | 'current' | 'later';
  nowText?: string;
}

export interface ProgressStepsProps {
  heading?: string;
  steps: readonly ProgressStep[];
  done?: boolean;
  doneLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  copy?: Partial<Pick<TeacherUiCopy, 'progress' | 'done' | 'now' | 'stepsCount'>>;
  className?: string;
}

export function ProgressSteps({ heading, steps, done = false, doneLabel = '', open, onOpenChange, copy, className }: ProgressStepsProps) {
  const words = { ...TEACHER_UI_COPY, ...copy };
  const title = heading || words.progress;
  const [toggled, setToggled] = useState<{ value: boolean; forProp: boolean | undefined } | null>(null);
  useEffect(() => { setToggled(null); }, [open]);
  const isOpen = toggled && toggled.forProp === open ? toggled.value : !!open;
  const showSteps = !done || isOpen;
  const doneCount = steps.filter((s) => s.state === 'done').length;
  const last = steps.length - 1;

  return (
    <div className={cn('flex w-full flex-col gap-2 text-[#1d2025]', className)}>
      {done ? (
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => { setToggled({ value: !isOpen, forProp: open }); onOpenChange?.(!isOpen); }}
          className={cn('flex w-full min-h-[56px] items-center gap-2.5 rounded-2xl bg-[#eaf6ef] pe-3 ps-3.5 text-start text-[#2f7a52]', FOCUS)}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2f7a52] text-white">
            <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="text-[16px] font-bold">{words.done}</span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{doneLabel}</span>
          <ChevronDown className={cn('h-5 w-5 shrink-0', isOpen && 'rotate-180')} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}

      {showSteps ? (
        <section aria-label={title} className="rounded-2xl border border-[#e5e7eb] bg-white px-4 pb-1 pt-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="m-0 flex-1 text-[18px] font-semibold leading-[1.2]">{title}</h3>
            <span className="inline-flex h-[26px] items-center whitespace-nowrap rounded-full bg-[#e8e9f0] px-2.5 text-[12px] font-semibold text-[#33374a]">
              {words.stepsCount(doneCount, steps.length)}
            </span>
          </div>
          <ol className="m-0 list-none p-0">
            {steps.map((s, i) => {
              const state = s.state === 'done' || s.state === 'current' ? s.state : 'later';
              return (
                <li key={`${s.label}-${i}`} aria-current={state === 'current' ? 'step' : undefined} className="flex gap-3">
                  <span className="flex w-7 shrink-0 flex-col items-center">
                    <span
                      data-testid="step-dot"
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                        state === 'done' && 'bg-[#2f7a52] text-white',
                        state === 'current' && 'border-[2.5px] border-[#33374a] bg-white',
                        state === 'later' && 'border-[1.5px] border-[#d1d5db] bg-white text-[12px] font-bold text-[#9ca3af]',
                      )}
                    >
                      {state === 'done' ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : null}
                      {state === 'current' ? <span className="h-2.5 w-2.5 rounded-full bg-[#33374a]" /> : null}
                      {state === 'later' ? i + 1 : null}
                    </span>
                    {i < last ? (
                      <span data-testid="step-line" className={cn('my-[3px] min-h-[14px] w-0.5 flex-1 rounded-[2px]', state === 'done' ? 'bg-[#2f7a52]' : 'bg-[#e5e7eb]')} />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 pb-4 pt-[3px]">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'text-[16px] leading-[1.3]',
                          state === 'later' && 'font-medium text-[#6b7280]',
                          state === 'current' && 'font-bold text-[#1d2025]',
                          state === 'done' && 'font-semibold text-[#1d2025]',
                        )}
                      >
                        {s.label}
                      </span>
                      {state === 'current' ? (
                        <span className="inline-flex h-6 items-center rounded-full bg-[#fef3c7] px-[9px] text-[12px] font-bold text-[#b45309]">{s.nowText || words.now}</span>
                      ) : null}
                    </span>
                    {s.sub ? <span className="text-[13px] leading-[1.4] text-[#6b7280]">{s.sub}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
