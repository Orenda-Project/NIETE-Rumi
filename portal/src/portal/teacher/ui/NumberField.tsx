import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { digitsOnly } from './digits';
import { FOCUS } from './styles';

/**
 * bd-fmf24g.34 — NumberField: an open number box, digits only (the teacher types the number; no − / + stepper). The
 * numeric keypad (inputMode), Urdu digits turned into Western ones, all selected on focus so the first key REPLACES a
 * pre-written 0. Value is a string: "" is empty, which a page range needs and a count box shows as 0 itself.
 * `big` (Pages: 64px, 26px digits, a visible label above) · `row` (a per-type count in front of its name: 72px wide,
 * 56px tall). `error` draws the red edge; the message itself is the page's, tied by `describedBy`. Canvas: AssessCoverage,
 * AssessTypes.
 */
export interface NumberFieldProps {
  value: string;
  onChange: (digits: string) => void;
  /** Visible label above (big). Without one, give `ariaLabel`. */
  label?: ReactNode;
  ariaLabel?: string;
  error?: boolean;
  describedBy?: string;
  size?: 'big' | 'row';
  maxLength?: number;
  /** row: digits greyed while the box holds its pre-written 0. */
  dim?: boolean;
  testId?: string;
  className?: string;
}

export function NumberField({ value, onChange, label, ariaLabel, error, describedBy, size = 'big', maxLength = 4, dim, testId, className }: NumberFieldProps) {
  const id = useId();
  const big = size === 'big';
  const input = (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      dir="ltr"
      value={value}
      maxLength={maxLength}
      aria-label={label ? undefined : ariaLabel}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      data-testid={testId}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(digitsOnly(e.target.value).slice(0, maxLength))}
      className={cn(
        'rounded-[14px] border-[1.5px] bg-white text-center font-bold tabular-nums text-[#1d2025]',
        big ? 'h-16 w-full px-3 text-[26px]' : 'h-14 w-[72px] shrink-0 px-0 text-[22px]',
        error ? 'border-[#c8331f] bg-[#fff8f7]' : dim ? 'border-[#d1d5db] text-[#9ca3af]' : 'border-[#33374a]',
        FOCUS,
        className,
      )}
    />
  );
  if (!label) return input;
  return (
    <div className="flex flex-1 flex-col gap-1.5 rounded-2xl border border-[#e5e7eb] bg-white p-2.5">
      <label htmlFor={id} className="ps-1 text-[13px] font-semibold text-[#6b7280]">{label}</label>
      {input}
    </div>
  );
}
