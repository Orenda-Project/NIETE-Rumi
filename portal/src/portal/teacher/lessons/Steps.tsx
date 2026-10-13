import { cn } from '@/lib/utils';
import { useCopy } from '../i18n';
import { LESSONS } from './copy';

/**
 * bd-fgj73x — where she is in a new lesson plan (1 Grade and subject, 2 Chapter, 3 Lesson): the same bar as
 * Assessment's New paper (assessment/ui StepFrame), so every feature's flow reads the same way.
 */
export const LESSON_STEPS = 3;

export function Steps({ n }: { n: 1 | 2 | 3 }) {
  const C = useCopy(LESSONS);
  return (
    <div
      role="progressbar"
      aria-label={C.stepOf(n, LESSON_STEPS)}
      aria-valuemin={1}
      aria-valuemax={LESSON_STEPS}
      aria-valuenow={n}
      className="flex gap-1.5 px-1"
    >
      {Array.from({ length: LESSON_STEPS }, (_, i) => (
        <i key={i} className={cn('h-[5px] flex-1 rounded-full', i < n ? 'bg-[#33374a]' : 'bg-[#e5e7eb]')} />
      ))}
    </div>
  );
}
