import { cn } from '@/lib/utils';
import type { TeacherUiCopy } from './copy';
import { useBidi } from './bidi';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — StepBar: where she is in a short flow (New visit 1–3, the Feedback Form's four parts). One 6px segment per
 * step, filled up to and including the current one, then a small label at the end ("Step 3 of 3"; a screen can say "Part 2 of
 * 4"). The labelled variant (`labels`) puts a word under each segment (a report's stages). Information only: nothing here is
 * tappable. Fills from the start edge, so Urdu runs right to left. Canvas: Coach_NewVisit*, Coach_FeedbackForm.
 */
export interface StepBarProps {
  total: number;
  /** 1-based: the step she is on. */
  current: number;
  /** Replaces the default "Step n of m". */
  label?: string;
  /** One word per step, shown under its segment. */
  labels?: readonly string[];
  copy?: Partial<Pick<TeacherUiCopy, 'stepOf'>>;
  className?: string;
}

export function StepBar({ total, current, label, labels, copy, className }: StepBarProps) {
  const words = { ...useKitCopy(), ...copy };
  const bidi = useBidi();
  const text = label ?? words.stepOf(current, total);
  const n = Math.max(1, total);
  return (
    <div role="img" aria-label={text} className={cn('flex flex-col gap-1.5 px-1', className)}>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: n }, (_, i) => (
          <i
            key={i}
            data-step={i < current ? 'on' : 'off'}
            className={cn('h-1.5 flex-1 rounded-full', i < current ? 'bg-[#33374a]' : 'bg-[#e5e7eb]')}
          />
        ))}
        {labels ? null : <em className="ms-1.5 whitespace-nowrap text-[13px] font-semibold not-italic text-[#6b7280]">{bidi(text)}</em>}
      </div>
      {labels ? (
        <div className="flex items-start gap-1.5">
          {labels.slice(0, n).map((l, i) => (
            <span key={i} className={cn('flex-1 text-[12px] font-semibold leading-tight', i < current ? 'text-[#33374a]' : 'text-[#6b7280]')}>{l}</span>
          ))}
        </div>
      ) : null}
      {labels ? <span className="text-[13px] font-semibold text-[#6b7280]">{bidi(text)}</span> : null}
    </div>
  );
}
