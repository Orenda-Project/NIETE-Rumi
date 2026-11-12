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

/**
 * One rung of the scale the review form actually has. `label` is the rung's name, spoken (never drawn): "Developing".
 * bd-ra8xu.40 — `text` is what the choice draws instead of its id ("N/A" for "NA"); in a `stacked` scale the label and
 * `description` (the rubric's words for the rung) are drawn too, so each level says what it means.
 */
export interface RatingOption {
  id: string;
  label?: string;
  text?: string;
  description?: string;
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
  /**
   * bd-ra8xu.40 — one full-width row per rung (its text, its label and description drawn) instead of equal squares:
   * for a rubric whose levels are described in words (FICO17 v6), as the WhatsApp review form lists them.
   */
  stacked?: boolean;
  copy?: Partial<Pick<TeacherUiCopy, 'rating' | 'notApplicable' | 'digitalCoach'>>;
  className?: string;
}

export function RatingScale({ value, onChange, dcValue = null, options, name, copy, className, stacked = false }: RatingScaleProps) {
  const words = { ...useKitCopy(), ...copy };
  const items: readonly RatingOption[] = options ?? KEYS.map((k) => ({ id: String(k) }));
  const ids = items.map((o) => o.id);
  const at = value === null ? null : String(value);
  const onKey = (e: KeyboardEvent<HTMLElement>) => radioKeyDown(e, ids, at, (id) => onChange(options ? id : (id === 'na' ? 'na' : (Number(id) as RatingValue))));
  return (
    <div role="radiogroup" aria-label={name ?? words.rating} onKeyDown={onKey}
      style={stacked ? undefined : { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className={cn(stacked ? 'flex flex-col gap-2' : cn(GRID, 'gap-2'), className)}>
      {items.map((o, i) => {
        const k = o.id;
        const on = at === k;
        const dc = dcValue !== null && String(dcValue) === k;
        const text = o.text ?? (k === 'na' ? words.notApplicable : k);
        const spoken = [text, o.label, dc ? words.digitalCoach : ''].filter(Boolean).join(', ');
        if (stacked) {
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={spoken}
              data-radio-key={k}
              tabIndex={on || (at === null && i === 0) ? 0 : -1}
              onClick={() => onChange(k)}
              className={cn(
                'flex min-h-[56px] w-full items-start gap-3 rounded-[14px] border px-3 py-2.5 text-start',
                on ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white text-[#1d2025]',
                dc && 'shadow-[inset_0_0_0_2px_#48b078]',
                FOCUS,
              )}
            >
              <b aria-hidden="true" className="min-w-[2.25rem] shrink-0 text-[17px] leading-[1.35]">{text}</b>
              <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-0.5">
                {o.label ? <span className="text-[16px] font-semibold leading-[1.35]" dir="auto">{o.label}</span> : null}
                {o.description ? <span className={cn('text-[13px] leading-[1.4]', on ? 'text-white/80' : 'text-[#6b7280]')} dir="auto">{o.description}</span> : null}
              </span>
            </button>
          );
        }
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
