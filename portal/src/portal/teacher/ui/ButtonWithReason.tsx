import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from './styles';

/**
 * bd-fmf24g.34 — ButtonWithReason: a main button that never goes grey without saying why. `reason` is the live,
 * plain-words cause ("Select at least one chapter"); while it is set the button is off and the reason shows ABOVE it
 * (amber, the kit's waiting tone, a polite live region); when the step is valid `reason` is null, the line is gone and
 * the button works. With `to` it is a link, with `onPress` a button. `busy` (sending) is off too, so it needs a reason as
 * well ("Please wait"). The words are the screen's. Used by every New paper step; canvas: AssessCoverage, AssessTypes.
 */
export interface ButtonWithReasonProps {
  label: ReactNode;
  /** Why it is off, or null when it works. */
  reason: ReactNode | null;
  to?: string;
  onPress?: () => void;
  /** An icon after the label. */
  icon?: ReactNode;
  testId?: string;
  className?: string;
}

const BASE = 'flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-[16px] font-semibold';

export function ButtonWithReason({ label, reason, to, onPress, icon, testId, className }: ButtonWithReasonProps) {
  const id = useId();
  const off = reason !== null && reason !== undefined && reason !== false && reason !== '';
  let button: ReactNode;
  if (off) {
    button = (
      <button type="button" disabled aria-disabled="true" aria-describedby={id} data-testid={testId} className={cn(BASE, 'cursor-not-allowed bg-[#e5e7eb] text-[#9ca3af]', FOCUS)}>
        {label}{icon}
      </button>
    );
  } else if (to) {
    button = <Link to={to} data-testid={testId} className={cn(BASE, 'bg-[#33374a] text-white', FOCUS)}>{label}{icon}</Link>;
  } else {
    button = <button type="button" onClick={onPress} data-testid={testId} className={cn(BASE, 'bg-[#33374a] text-white', FOCUS)}>{label}{icon}</button>;
  }
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-2', className)}>
      <div id={id} role="status" aria-live="polite">
        {off ? (
          <p data-testid="button-reason" className="flex min-h-12 items-center gap-2.5 rounded-2xl bg-[#fef3c7] px-3.5 py-1.5 text-[15px] font-semibold text-[#b45309]">
            <Clock className="h-5 w-5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
            <span className="min-w-0 flex-1">{reason}</span>
          </p>
        ) : null}
      </div>
      {button}
    </div>
  );
}
