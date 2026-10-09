import { cn } from '@/lib/utils';
import { FOCUS, radioKeyDown } from './styles';
import type { KeyboardEvent } from 'react';

/**
 * bd-4404s7.1 — ChoiceChips: a row of pill choices that narrow or sort a list (the coach's Sort: Least visited · Most visited ·
 * Days since visit; Edit teacher's teaching levels). A small label first, then the chips, wrapping onto a second line rather
 * than hiding. Each chip is a 56px target around a 44px pill; the picked one is indigo. One choice by default (a radiogroup);
 * `multiple` makes them toggles (aria-pressed) and the value a list. Canvas: Coach_People (Sort), Coach_EditTeacher (levels).
 */
export interface ChipOption {
  key: string;
  label: string;
}

interface ChipsBase {
  /** The group's name, also the small first word ("Sort"). */
  label: string;
  options: readonly ChipOption[];
  /** Hide the visible first word (the name still reaches a screen reader). */
  hideLabel?: boolean;
  className?: string;
}
type SingleChips = ChipsBase & { multiple?: false; value: string | null; onChange: (key: string) => void };
type MultiChips = ChipsBase & { multiple: true; value: readonly string[]; onChange: (keys: string[]) => void };
export type ChoiceChipsProps = SingleChips | MultiChips;

const PILL = 'inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-3.5 text-[14px] font-semibold';
const pill = (on: boolean) => cn(PILL, on ? 'border-[#33374a] bg-[#33374a] text-white' : 'border-[#e5e7eb] bg-white text-[#4b5563]');
const TARGET = cn('flex min-h-[56px] items-center', FOCUS);

export function ChoiceChips(props: ChoiceChipsProps) {
  const { label, options, hideLabel = false, className } = props;
  const keys = options.map((o) => o.key);
  const head = hideLabel ? null : <span className="shrink-0 text-[13px] font-semibold text-[#6b7280]">{label}</span>;
  if (props.multiple === true) {
    const { value, onChange } = props as MultiChips;
    return (
      <div role="group" aria-label={label} className={cn('flex flex-wrap items-center gap-x-2', className)}>
        {head}
        {options.map((o) => {
          const on = value.includes(o.key);
          return (
            <button key={o.key} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((k) => k !== o.key) : [...value, o.key])} className={TARGET}>
              <span className={pill(on)}>{o.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
  const { value, onChange } = props as SingleChips;
  const onKey = (e: KeyboardEvent<HTMLElement>) => radioKeyDown(e, keys, value && keys.includes(value) ? value : null, onChange);
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn('flex flex-wrap items-center gap-x-2', className)}>
      {head}
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} aria-label={o.label} data-radio-key={o.key} tabIndex={on || (value === null && o.key === keys[0]) ? 0 : -1} onClick={() => onChange(o.key)} className={TARGET}>
            <span className={pill(on)}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
