import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS, radioKeyDown } from './styles';

/**
 * bd-5rz1v.19 — big option rows with a tick box (deep-screens.html `.toggles .tog`).
 *
 * The row that is on is SELECTED, so it is indigo: an indigo outline on the indigo tint, its
 * box filled indigo with a white check. Off: white, a 2px grey outline, an empty box.
 * 64px rows, 16px/800 labels; `compact` rows are 56px (the date-range sheet).
 *
 *   mode="single"  one choice — a radio group (arrow keys move it)
 *   mode="multi"   any number — checkboxes
 */

export interface ToggleOption<K extends string> {
  key: K;
  label: string;
  /** Something at the end of the row, usually a Chip ("1–5"). */
  aside?: ReactNode;
}

interface Common<K extends string> {
  /** The group's name for a screen reader. */
  label: string;
  options: ReadonlyArray<ToggleOption<K>>;
  compact?: boolean;
}
interface Single<K extends string> extends Common<K> { mode?: 'single'; value: K | null; onChange: (key: K) => void }
interface Multi<K extends string> extends Common<K> { mode: 'multi'; value: readonly K[]; onChange: (keys: K[]) => void }
export type ToggleListProps<K extends string> = Single<K> | Multi<K>;

export function ToggleList<K extends string>(props: ToggleListProps<K>) {
  const { label, options, compact } = props;
  const keys = options.map((o) => o.key);
  const multi = props.mode === 'multi';
  const isOn = (k: K) => (props.mode === 'multi' ? props.value.includes(k) : props.value === k);
  const toggle = (k: K) => {
    if (props.mode === 'multi') {
      props.onChange(props.value.includes(k) ? props.value.filter((v) => v !== k) : [...props.value, k]);
    } else {
      props.onChange(k);
    }
  };
  const singleValue = props.mode === 'multi' ? null : props.value;

  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-label={label} className="grid gap-2.5">
      {options.map((o) => {
        const on = isOn(o.key);
        return (
          <button
            key={o.key}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            tabIndex={multi || on || (singleValue === null && o.key === keys[0]) ? 0 : -1}
            data-radio-key={o.key}
            onClick={() => toggle(o.key)}
            onKeyDown={multi ? undefined : (e) => radioKeyDown(e, keys, singleValue, (k) => toggle(k))}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl border-2 px-3.5 py-2.5 text-start text-base font-extrabold text-nu-surface-text',
              'rtl:font-bold rtl:leading-[1.9]',
              compact ? 'min-h-[56px]' : 'min-h-[64px]',
              on ? 'border-nu-select bg-nu-select-tint' : 'border-nu-surface-line bg-nu-surface-card active:bg-nu-ink-xlight',
              FOCUS,
            )}
          >
            <span
              data-box
              aria-hidden="true"
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2',
                on ? 'border-nu-select bg-nu-select text-white' : 'border-nu-surface-box',
              )}
            >
              {on ? <Check className="h-[18px] w-[18px]" strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0 flex-1">{o.label}</span>
            {o.aside ? <span className="ms-auto shrink-0">{o.aside}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
