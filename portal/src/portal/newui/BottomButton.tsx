import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RecordingBarShownContext } from '../lib/recordingBarShown';
import { FOCUS, TAP } from './styles';

/**
 * bd-5rz1v.19 — the bottom action button (deep-screens.html `.cta`, `.ctas`).
 *
 * ONE look in every feature — a feature colour never changes it:
 *   primary  the button green, standing on a 4px edge of darker green; drops 3px when pressed
 *   outline  white with a 2px grey border (a second, quieter choice)
 *   warn     amber, on its own edge
 *   danger   red, on its own edge (destructive)
 *   disabled grey, no edge, no press
 * A 58px pill (outline 56px), 17.5px/800 label, a 23px icon. The press only ANIMATES under
 * motion-safe; with reduced motion it still moves, instantly.
 *
 * BottomActions holds one (or a stack of) these above the menu bar on a phone — 2px 14px 14px,
 * 10px apart — and inline on a desktop. It keeps an equal space in the page so it never covers
 * the last row. While a lesson records, the recording bar sits above the menu (88px + the safe
 * area, 56px tall); the buttons then stand above IT, 8px clear (bd-5rz1v.14). PortalLayout says
 * when the bar shows (RecordingBarShownContext).
 */

export type BottomButtonTone = 'primary' | 'outline' | 'warn' | 'danger';

const TONE: Record<BottomButtonTone, string> = {
  primary: 'h-[58px] bg-nu-button text-white shadow-nu-button active:translate-y-[3px] active:shadow-nu-button-pressed',
  outline: 'h-14 border-2 border-nu-button-secondary-border bg-nu-button-secondary text-base text-nu-surface-text active:bg-nu-ink-xlight',
  warn: 'h-[58px] bg-nu-button-warning text-white shadow-nu-warning active:translate-y-[3px] active:shadow-nu-warning-pressed',
  danger: 'h-[58px] bg-nu-button-destructive text-white shadow-nu-destructive active:translate-y-[3px] active:shadow-nu-destructive-pressed',
};

const DISABLED = 'h-[58px] bg-nu-button-disabled text-nu-button-disabled-text shadow-none';

export interface BottomButtonProps {
  children: string;
  tone?: BottomButtonTone;
  icon?: LucideIcon;
  /** The icon points somewhere (›, →): turn it round in RTL. */
  iconFlips?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Goes somewhere: a link with the same look. */
  to?: string;
  type?: 'button' | 'submit';
  testId?: string;
}

export function BottomButton({
  children, tone = 'primary', icon: Icon, iconFlips, disabled, onClick, to, type = 'button', testId,
}: BottomButtonProps) {
  const className = cn(
    'flex w-full items-center justify-center gap-2.5 rounded-full text-[17.5px] font-extrabold',
    'motion-safe:transition-transform motion-safe:duration-75 rtl:font-bold',
    TAP,
    FOCUS,
    disabled ? DISABLED : TONE[tone],
  );
  const content = (
    <>
      {Icon ? <Icon className={cn('h-[23px] w-[23px] shrink-0', iconFlips && 'rtl:-scale-x-100')} aria-hidden="true" /> : null}
      <span className="rtl:pt-1 rtl:leading-[2]">{children}</span>
    </>
  );
  if (to && !disabled) {
    return <Link to={to} data-testid={testId} className={className}>{content}</Link>;
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={className}>
      {content}
    </button>
  );
}

export function BottomActions({ children }: { children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const aboveRecordingBar = useContext(RecordingBarShownContext);
  const [height, setHeight] = useState(0);

  // The panel is fixed on a phone, so the page reserves its height — measured, because one
  // button and three stacked buttons differ. (No ResizeObserver in old WebViews or jsdom: the
  // first measurement still holds.)
  useEffect(() => {
    const el = panel.current;
    if (!el) return undefined;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div data-testid="newui-bottom-actions-spacer" aria-hidden="true" className="md:hidden" style={{ height }} />
      <div
        ref={panel}
        data-testid="newui-bottom-actions"
        className={cn(
          'fixed inset-x-0 z-40 flex flex-col gap-2.5 bg-nu-surface px-[14px] pb-[14px] pt-0.5',
          aboveRecordingBar ? 'bottom-[calc(152px+env(safe-area-inset-bottom))]' : 'bottom-[calc(80px+env(safe-area-inset-bottom))]',
          'md:static md:z-auto md:bg-transparent md:px-0 md:pb-0 md:pt-3',
        )}
      >
        {children}
      </div>
    </>
  );
}
