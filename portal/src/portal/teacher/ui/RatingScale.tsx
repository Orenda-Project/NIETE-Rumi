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

/** With `options` a value is the option's id (the live scale's own: "0", "1", "2", "na"). */
export type RatingKey = RatingValue | (string & {});

/** One rung of the scale the review form actually has. `label` is the rung's name, spoken (never drawn): "Developing". */
export interface RatingOption {
  id: string;
  label?: string;
}

export interface RatingScaleProps {
  value: RatingKey | null;
  /** Method syntax on purpose: a handler written for the default `RatingValue` stays assignable. */
  onChange(value: RatingKey): void;
  dcValue?: RatingKey | null;
  /**
   * The scale the bot's review form gives (bd-4404s7.5): the framework owns the rungs (FICO today: 0 Not observed, 1 Developing,
   * 2 Proficient, N/A), so the row follows it instead of a fixed 1 to 4. Leave out for 1 2 3 4 N/A. `na` is drawn as N/A.
   */
  options?: readonly RatingOption[];
  /** The group's name for a screen reader (default "Rating"). */
  name?: string;
  copy?: Partial<Pick<TeacherUiCopy, 'rating' | 'notApplicable' | 'digitalCoach'>>;
  className?: string;
}

export function RatingScale({ value, onChange, dcValue = null, options, name, copy, className }: RatingScaleProps) {
  const words = { ...useKitCopy(), ...copy };
  const items: readonly RatingOption[] = options ?? KEYS.map((k) => ({ id: String(k) }));
  const ids = items.map((o) => o.id);
  const at = value === null ? null : String(value);
  const onKey = (e: KeyboardEvent<HTMLElement>) => radioKeyDown(e, ids, at, (id) => onChange(options ? id : (id === 'na' ? 'na' : (Number(id) as RatingValue))));
  return (
    <div role="radiogroup" aria-label={name ?? words.rating} onKeyDown={onKey} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} className={cn(GRID, 'gap-2', className)}>
      {items.map((o, i) => {
        const k = o.id;
        const on = at === k;
        const dc = dcValue !== null && String(dcValue) === k;
        const text = k === 'na' ? words.notApplicable : k;
        const spoken = [text, o.label, dc ? words.digitalCoach : ''].filter(Boolean).join(', ');
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={spoken}
            data-radio-key={k}
            tabIndex={on || (at === null && i === 0) ? 0 : -1}
            onClick={() => onChange(options ? k : (k === 'na' ? 'na' : (Number(k) as RatingValue)))}
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
