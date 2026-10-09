import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import type { TeacherUiCopy } from './copy';
import { FOCUS, GRID, radioKeyDown } from './styles';
import { useKitCopy } from './useKitCopy';

/**
 * bd-4404s7.1 — RatingScale: the coach's rating of one indicator, 1 to 4 or N/A (only a coach rates). Five equal 56px
 * choices in a radiogroup; the picked one is indigo. `dcValue` marks what the Digital Coach gave with a 2px green ring inside
 * the choice (and says "Digital Coach" to a screen reader), so she sees where she agrees or differs: colour is never the only
 * signal. Arrow keys move the pick. `name` is the indicator ("Positive learning environment"). Canvas: Coach_FeedbackForm.
 */
export type RatingValue = 1 | 2 | 3 | 4 | 'na';
const KEYS: readonly RatingValue[] = [1, 2, 3, 4, 'na'];

export interface RatingScaleProps {
  value: RatingValue | null;
  onChange: (value: RatingValue) => void;
  dcValue?: RatingValue | null;
  /** The group's name for a screen reader (default "Rating"). */
  name?: string;
  copy?: Partial<Pick<TeacherUiCopy, 'rating' | 'notApplicable' | 'digitalCoach'>>;
  className?: string;
}

export function RatingScale({ value, onChange, dcValue = null, name, copy, className }: RatingScaleProps) {
  const words = { ...useKitCopy(), ...copy };
  const onKey = (e: KeyboardEvent<HTMLElement>) => radioKeyDown(e, KEYS, value, onChange);
  return (
    <div role="radiogroup" aria-label={name ?? words.rating} onKeyDown={onKey} className={cn(GRID, 'grid-cols-5 gap-2', className)}>
      {KEYS.map((k) => {
        const on = value === k;
        const dc = dcValue === k;
        const text = k === 'na' ? words.notApplicable : String(k);
        return (
          <button
            key={String(k)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={dc ? `${text}, ${words.digitalCoach}` : text}
            data-radio-key={String(k)}
            tabIndex={on || (value === null && k === 1) ? 0 : -1}
            onClick={() => onChange(k)}
            className={cn(
              'flex min-h-[56px] items-center justify-center rounded-[14px] border font-bold',
              k === 'na' ? 'text-[14px]' : 'text-[18px]',
              on ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white text-[#374151]',
              dc && 'shadow-[inset_0_0_0_2px_#48b078]',
              FOCUS,
            )}
          >
            <span aria-hidden="true">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
