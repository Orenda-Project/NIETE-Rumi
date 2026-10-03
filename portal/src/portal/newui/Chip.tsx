import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS, TAP, radioKeyDown } from './styles';

/**
 * bd-5rz1v.19 — chips (deep-screens.html `.chip`).
 *
 * A Chip is INFORMATION: a flat pill, no border, no shadow, no role — it must never look like
 * something to tap. Its colour is its meaning, never a feature's:
 *   done      green  — done, sent, ready, a good result
 *   waiting   amber  — waiting, writing, a warning ("~2 min", "24h wait")
 *   error     red    — failed
 *   info      grey-indigo — everything else ("Grade 4", "p.14–15", "Oct")
 *   selected  indigo — the chosen one in a set
 *   recording red, led by a dot that pulses — a lesson being recorded (bd-5rz1v.26; the one
 *             place red means something other than an error)
 *
 * FilterChips are the one tappable kind: a radio group of outlined pills, the picked one
 * filled indigo, each inside a 56px target.
 */

export type ChipTone = 'done' | 'waiting' | 'error' | 'info' | 'selected' | 'recording';

const TONE: Record<ChipTone, string> = {
  done: 'bg-nu-chip-done-bg text-nu-chip-done',
  waiting: 'bg-nu-chip-warning-bg text-nu-chip-warning',
  error: 'bg-nu-chip-error-bg text-nu-chip-error',
  info: 'bg-nu-chip-info-bg text-nu-chip-info',
  selected: 'bg-nu-chip-selected-bg text-nu-chip-selected',
  recording: 'bg-nu-record-bg text-nu-record',
};

export interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  icon?: LucideIcon;
  /** On the indigo band of a main page: translucent white. */
  surface?: 'light' | 'band';
}

export function Chip({ children, tone = 'info', icon: Icon, surface = 'light' }: ChipProps) {
  return (
    <span
      data-chip
      dir="auto"
      className={cn(
        'inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full font-extrabold',
        'rtl:font-semibold rtl:leading-[1.9]',
        surface === 'band'
          ? 'bg-nu-frame-translucent px-2.5 py-[3px] text-xs text-nu-frame-chip'
          : cn('px-2 py-px text-[11.5px] rtl:px-[9px] rtl:py-0 rtl:text-xs', TONE[tone]),
      )}
    >
      {tone === 'recording' && surface === 'light' ? (
        <span data-dot aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-nu-record motion-safe:animate-pulse" />
      ) : null}
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export interface FilterOption<K extends string> { key: K; label: string }

export interface FilterChipsProps<K extends string> {
  /** The group's name for a screen reader. */
  label: string;
  options: ReadonlyArray<FilterOption<K>>;
  value: K;
  onChange: (key: K) => void;
}

export function FilterChips<K extends string>({ label, options, value, onChange }: FilterChipsProps<K>) {
  const keys = options.map((o) => o.key);
  return (
    <div role="radiogroup" aria-label={label} className="-my-2.5 flex flex-wrap gap-x-1.5">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-radio-key={o.key}
            onClick={() => onChange(o.key)}
            onKeyDown={(e) => radioKeyDown(e, keys, value, onChange)}
            className={cn('flex items-center rounded-full', TAP, FOCUS)}
          >
            <span data-pill className={pill(on)}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The outlined pill of FilterChips and ToggleChips; the one(s) picked are indigo. */
function pill(on: boolean) {
  return cn(
    'inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-full border-[1.5px] px-3.5 text-[13px] font-extrabold rtl:font-semibold',
    on
      ? 'border-nu-select bg-nu-chip-selected-bg text-nu-chip-selected'
      : 'border-nu-surface-line bg-nu-surface-card text-nu-surface-text active:bg-nu-ink-xlight',
  );
}

export interface ToggleChipsProps<K extends string> {
  /** The group's name for a screen reader. */
  label: string;
  options: ReadonlyArray<FilterOption<K>>;
  value: readonly K[];
  onChange: (keys: K[]) => void;
}

/**
 * bd-5rz1v.13 — ANY number of chips on at once (the Assessment page's question types): a group
 * of checkboxes that look like FilterChips. An "on" chip is selected, so it is indigo, with a
 * check so it reads as "picked" without its colour; off is outlined white. Each is a 56px target.
 */
export function ToggleChips<K extends string>({ label, options, value, onChange }: ToggleChipsProps<K>) {
  const toggle = (k: K) => onChange(value.includes(k) ? value.filter((v) => v !== k) : [...value, k]);
  return (
    <div role="group" aria-label={label} className="-my-2.5 flex flex-wrap gap-x-1.5">
      {options.map((o) => {
        const on = value.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(o.key)}
            className={cn('flex items-center rounded-full', TAP, FOCUS)}
          >
            <span data-pill className={pill(on)}>
              {on ? <Check className="-ms-1 h-4 w-4 shrink-0" strokeWidth={3} aria-hidden="true" /> : null}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
