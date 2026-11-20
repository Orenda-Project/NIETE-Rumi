import type { KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
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
  /** A neutral lucide icon drawn before the words (hidden from a screen reader: the words say it). The survey bar's 👍/👎. */
  icon?: LucideIcon;
  /**
   * bd-o15qnr.28 — `look="radio"` only: drawn as a pill after the rows (N/A, Couldn't tell), still a choice of the same
   * group. Its `text` is drawn, then its `label` when there is one ("N/A · No question asked").
   */
  aside?: boolean;
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
  /** While her answer saves: the choices she did not pick cannot be tapped (the picked one stays shown). */
  disabled?: boolean;
  /**
   * bd-o15qnr.28 (v7; #188's canvas, m9-ff-v6) — `radio`: one full-width 56px row per rung, a radio dot at the start, the
   * rung's name (`label`, else `text`) and its words; the picked row tinted with a filled dot; the Digital Coach's row edged
   * purple with a soft halo and `dcTag` at its end. Options marked `aside` follow as pills, each in a 56px target, in the
   * same group (arrow keys run on into them). Spoken: the name, then `copy.digitalCoach` on the Digital Coach's.
   * Leave out for today's squares or `stacked` rows.
   */
  look?: 'radio';
  /** The word drawn at the end of the Digital Coach's row in the `radio` look ("Rumi"); hidden from a screen reader. */
  dcTag?: string;
  className?: string;
}

export function RatingScale({ value, onChange, dcValue = null, options, name, copy, className, stacked = false, disabled = false, look, dcTag }: RatingScaleProps) {
  const words = { ...useKitCopy(), ...copy };
  const items: readonly RatingOption[] = options ?? KEYS.map((k) => ({ id: String(k) }));
  const at = value === null ? null : String(value);
  if (look === 'radio') {
    return <RadioRows items={items} at={at} onChange={onChange} dcValue={dcValue} name={name ?? words.rating} dcWord={words.digitalCoach}
      naWord={words.notApplicable} dcTag={dcTag} disabled={disabled} className={className} />;
  }
  const ids = items.map((o) => o.id);
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
        const Icon = o.icon;
        const off = disabled && !on;
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
              disabled={off}
              onClick={() => onChange(k)}
              className={cn(
                'flex min-h-[56px] w-full items-start gap-3 rounded-[14px] border px-3 py-2.5 text-start disabled:opacity-50',
                on ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white text-[#1d2025]',
                dc && 'shadow-[inset_0_0_0_2px_#48b078]',
                FOCUS,
              )}
            >
              {Icon ? <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /> : null}
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
            disabled={off}
            onClick={() => onChange(options ? k : (k === 'na' ? 'na' : (Number(k) as RatingValue)))}
            className={cn(
              'flex min-h-[56px] items-center justify-center gap-2 rounded-[14px] border font-bold disabled:opacity-50',
              Icon && 'px-2',
              k === 'na' ? 'text-[14px]' : 'text-[18px]',
              on ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white text-[#374151]',
              dc && 'shadow-[inset_0_0_0_2px_#48b078]',
              FOCUS,
            )}
          >
            {Icon ? <Icon className="h-5 w-5 shrink-0" aria-hidden="true" /> : null}
            <span aria-hidden="true">{text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** bd-o15qnr.28 — the `radio` look (see `look`). */
function RadioRows({ items, at, onChange, dcValue, name, dcWord, naWord, dcTag, disabled, className }: {
  items: readonly RatingOption[]; at: string | null; onChange: (value: RatingKey) => void; dcValue: RatingKey | null;
  name: string; dcWord: string; naWord: string; dcTag?: string; disabled: boolean; className?: string;
}) {
  const rows = items.filter((o) => !o.aside);
  const asides = items.filter((o) => o.aside);
  const ids = [...rows, ...asides].map((o) => o.id);
  const onKey = (e: KeyboardEvent<HTMLElement>) => radioKeyDown(e, ids, at, (id) => onChange(id));
  const isDc = (k: string) => dcValue !== null && String(dcValue) === k;
  const face = (o: RatingOption) => o.text ?? (o.id === 'na' ? naWord : o.id);
  const tab = (k: string) => (at === k || (at === null && k === ids[0]) ? 0 : -1);
  return (
    <div role="radiogroup" aria-label={name} onKeyDown={onKey} data-look="radio" className={cn('flex flex-col gap-1.5', className)}>
      {rows.map((o) => {
        const k = o.id;
        const on = at === k;
        const dc = isDc(k);
        const title = o.label ?? face(o);
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={[title, dc ? dcWord : ''].filter(Boolean).join(', ')}
            data-radio-key={k}
            tabIndex={tab(k)}
            disabled={disabled && !on}
            onClick={() => onChange(k)}
            className={cn(
              'flex min-h-[56px] w-full items-center gap-3 rounded-xl border-[1.5px] px-3 py-2 text-start disabled:opacity-50',
              on ? 'border-[#33374a] bg-[#f4f5f8]' : 'border-[#e5e7eb] bg-white',
              dc && 'border-[#6e52e0] shadow-[0_0_0_3px_#e9e3ff]',
              FOCUS,
            )}
          >
            <span aria-hidden="true" data-dot={on ? 'on' : 'off'}
              className={cn('h-[18px] w-[18px] shrink-0 rounded-full', on ? 'border-[6px] border-[#33374a]' : 'border-2 border-[#9ca3af]')} />
            <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold leading-[1.35] text-[#1d2025]" dir="auto">{title}</span>
              {o.description ? <span className="text-[13px] leading-[1.4] text-[#6b7280]" dir="auto">{o.description}</span> : null}
            </span>
            {dc && dcTag ? <span aria-hidden="true" className="shrink-0 text-[12px] font-bold text-[#6e52e0]">{dcTag}</span> : null}
          </button>
        );
      })}
      {asides.length ? (
        <div className="flex flex-wrap gap-x-2">
          {asides.map((o) => {
            const k = o.id;
            const on = at === k;
            const dc = isDc(k);
            const text = [face(o), o.label].filter(Boolean).join(' · ');
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={[face(o), o.label, dc ? dcWord : ''].filter(Boolean).join(', ')}
                data-radio-key={k}
                data-testid="level-aside"
                tabIndex={tab(k)}
                disabled={disabled && !on}
                onClick={() => onChange(k)}
                className={cn('flex min-h-[56px] items-center disabled:opacity-50', FOCUS)}
              >
                <span aria-hidden="true" dir="auto"
                  className={cn('inline-flex min-h-[36px] items-center rounded-full px-3.5 text-[13px] font-bold',
                    on ? 'bg-[#33374a] text-white' : 'bg-[#f3f4f6] text-[#374151]',
                    dc && 'shadow-[0_0_0_2px_#6e52e0]')}>
                  {text}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
