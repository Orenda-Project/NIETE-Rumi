import { cn } from '@/lib/utils';
import { FOCUS, PRESS, radioKeyDown } from './styles';

/**
 * bd-5rz1v.25 — answering ONE question per screen (deep-screens.html, Training 6: `.ans`, `.dots`).
 *
 * AnswerChoices: a big button per answer — a 32px letter tile, then the answer (data, shown as
 * the server sends it). 58px or more, 16px corners, a 2px edge, 15px/700. The picked answer is
 * SELECTED, so it is indigo: an indigo edge on the indigo tint, its letter tile filled indigo.
 *   mode="single"  one answer — a radio group (arrow keys move the pick)
 *   mode="multi"   "pick all" — checkboxes
 * `images`: answers that ARE pictures (one in the bank today) — the picture under its letter.
 * `value` holds the picked answers' 0-based positions; the caller turns them into the server's
 * 1-based keys.
 * `verdict` (bd-klecr.6): once her answer is checked, her picked answers turn green (correct) or
 * red (wrong) — DONE and ERROR, per the colour rule — and carry data-verdict. Only her own picks:
 * the right answer is never shown. Pass `disabled` with it; a checked answer is locked.
 *
 * QuestionDots: where she is, one bar per question, indigo up to the current one. It is
 * information (a progressbar), never a button — Back and Next move between questions.
 */

const LETTERS = 'ABCDEFGHIJ';

export interface AnswerChoicesProps {
  /** The group's name for a screen reader. */
  label: string;
  options: readonly string[];
  images?: ReadonlyArray<string | null> | null;
  mode?: 'single' | 'multi';
  value: readonly number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
  verdict?: 'correct' | 'wrong';
}

export function AnswerChoices({ label, options, images, mode = 'single', value, onChange, disabled, verdict }: AnswerChoicesProps) {
  const pics = (images || []).filter((x): x is string => Boolean(x));
  const count = pics.length ? pics.length : options.length;
  const keys = Array.from({ length: count }, (_, i) => i);
  const multi = mode === 'multi';
  const current = value.length ? value[0] : null;

  const choose = (i: number) => {
    if (disabled) return;
    if (!multi) { onChange([i]); return; }
    onChange(value.includes(i) ? value.filter((v) => v !== i) : [...value, i].sort((a, b) => a - b));
  };

  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-label={label} className="flex flex-col gap-2">
      {keys.map((i) => {
        const on = value.includes(i);
        const pic = pics[i];
        const mark = on ? verdict : undefined;
        return (
          <button
            key={i}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            disabled={disabled}
            tabIndex={multi || on || (current === null && i === 0) ? 0 : -1}
            data-radio-key={i}
            data-verdict={mark}
            onClick={() => choose(i)}
            onKeyDown={multi ? undefined : (e) => radioKeyDown(e, keys, current, (k) => choose(k))}
            className={cn(
              'flex min-h-[58px] w-full items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-start text-[15px] font-bold text-nu-surface-text',
              'rtl:font-semibold rtl:leading-[1.9]',
              mark === 'correct'
                ? 'border-nu-done bg-nu-done-bg'
                : mark === 'wrong'
                  ? 'border-nu-chip-error bg-nu-chip-error-bg'
                  : on ? 'border-nu-select bg-nu-select-tint' : cn('border-nu-surface-line bg-nu-surface-card', PRESS),
              disabled && !mark && 'opacity-55',
              FOCUS,
            )}
          >
            <span
              data-letter
              aria-hidden="true"
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[15px] font-extrabold',
                mark === 'correct' ? 'bg-nu-done text-white'
                  : mark === 'wrong' ? 'bg-nu-chip-error text-white'
                    : on ? 'bg-nu-select text-white' : 'bg-nu-ink-light text-nu-ink',
              )}
            >
              {LETTERS[i] ?? String(i + 1)}
            </span>
            {pic ? (
              <img src={pic} alt={LETTERS[i] ?? String(i + 1)} loading="lazy" className="max-h-40 min-w-0 flex-1 rounded-xl bg-nu-surface object-contain" />
            ) : (
              <span className="min-w-0 flex-1 whitespace-pre-line">{options[i]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function QuestionDots({ label, total, current }: { label: string; total: number; current: number }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      className="flex gap-[5px]"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          data-dot
          data-on={i <= current ? 'true' : 'false'}
          aria-hidden="true"
          className={cn('h-1.5 flex-1 rounded-[4px]', i <= current ? 'bg-nu-ink' : 'bg-nu-surface-handle')}
        />
      ))}
    </div>
  );
}
