import { cn } from '@/lib/utils';
import { FOCUS, radioKeyDown } from './styles';

/**
 * bd-5rz1v.19 — pick a number from big tiles (deep-screens.html `.grid4 .num`): Grade 1–12,
 * a class. Four across, 8px apart; each tile 58px tall, 22px/800. The picked one is SELECTED:
 * filled indigo, white number. A number still to be done has a dashed border.
 * One choice — a radio group; arrow keys move the pick.
 */
export interface NumberGridProps {
  /** The group's name for a screen reader ("Grade"). */
  label: string;
  numbers: readonly number[];
  value: number | null;
  onChange: (n: number) => void;
  /** Numbers drawn with a dashed border. */
  required?: readonly number[];
}

export function NumberGrid({ label, numbers, value, onChange, required = [] }: NumberGridProps) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-2">
      {numbers.map((n, i) => {
        const on = n === value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value === null && i === 0) ? 0 : -1}
            data-radio-key={n}
            onClick={() => onChange(n)}
            onKeyDown={(e) => radioKeyDown(e, numbers, value, onChange)}
            className={cn(
              'flex h-[58px] min-h-[56px] items-center justify-center rounded-2xl border-[1.5px] text-[22px] font-extrabold tabular-nums',
              on
                ? 'border-nu-select bg-nu-select text-white'
                : 'border-nu-surface-line bg-nu-surface-card text-nu-surface-text active:bg-nu-ink-xlight',
              required.includes(n) && 'border-dashed',
              FOCUS,
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
