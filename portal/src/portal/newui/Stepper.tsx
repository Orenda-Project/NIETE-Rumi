import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KIT_COPY } from './copy';
import { FOCUS, TAP_SQUARE } from './styles';

/**
 * bd-5rz1v.13 — pick a number with two big buttons, never by typing (deep-screens.html
 * `.stepper`, Assessment: "type a number → − 15 +").
 *
 *   ( − )          15          ( + )
 *
 * Two 56px squares with 16px corners (the mockup's `.tbtn`: white, a 1.5px grey border) and the
 * number between them, 34px/800. The BOUNDS are the caller's — for questions, the server's
 * maxQuestions — and a button at its bound is disabled, so the number cannot leave them. A
 * value handed in outside the bounds is shown clamped and steps from there.
 *
 * The number is announced when it changes. In Urdu the row mirrors: minus sits at the start.
 */
export interface StepperProps {
  /** The group's name for a screen reader ("Questions"). */
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  decreaseLabel?: string;
  increaseLabel?: string;
  testId?: string;
}

const BUTTON = cn(
  'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card text-nu-surface-text',
  'active:bg-nu-ink-xlight disabled:bg-nu-surface disabled:text-nu-button-disabled-text',
  TAP_SQUARE,
  FOCUS,
);

export function Stepper({
  label, value, min, max, onChange, decreaseLabel = KIT_COPY.stepper.decrease, increaseLabel = KIT_COPY.stepper.increase, testId,
}: StepperProps) {
  const low = Math.min(min, max);
  const shown = Math.max(low, Math.min(max, Math.round(Number(value) || low)));
  const step = (by: number) => {
    const next = Math.max(low, Math.min(max, shown + by));
    if (next !== shown) onChange(next);
  };
  return (
    <div role="group" aria-label={label} data-testid={testId} className="flex items-center justify-between gap-2.5">
      <button type="button" aria-label={decreaseLabel} disabled={shown <= low} onClick={() => step(-1)} className={BUTTON}>
        <Minus className="h-6 w-6" aria-hidden="true" />
      </button>
      <output aria-live="polite" className="min-w-0 flex-1 text-center">
        <b className="text-[34px] font-extrabold tabular-nums text-nu-surface-text">{shown}</b>
      </output>
      <button type="button" aria-label={increaseLabel} disabled={shown >= max} onClick={() => step(1)} className={BUTTON}>
        <Plus className="h-6 w-6" aria-hidden="true" />
      </button>
    </div>
  );
}
