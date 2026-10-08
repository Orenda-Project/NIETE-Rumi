import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useKitCopy } from './useKitCopy';
import { FOCUS } from './styles';

/**
 * bd-fmf24g.2.2 — Tray: the teacher canvas's bottom sheet (GradeSubjectSelector's trays, GradeSubjectPicker's
 * sheet, DateRangeBar's presets). The page dims (rgba(17,24,39,.45)) and a tap on the dim closes it; the sheet is
 * #f3f4f6 with 22px top corners, a 44×5 grab handle, the title 22px/600 and a 56px round white close. A centred
 * card on a desktop. It scrolls inside itself (88% of the screen at most), so a sticky heading inside sticks.
 *
 * Behaviour is the new UI's Sheet (newui/Sheet.tsx), kept the same so every sheet in the portal acts alike:
 * role="dialog" + data-state="open" is what BackButtonHandler looks for, so ANDROID BACK closes it (it sends
 * Escape); Escape, the close and the dim close it; focus moves in, Tab wraps inside, and focus returns to where it
 * was; the page under it does not scroll; it rises and fades only when motion is allowed.
 */
export interface TrayProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  testId?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Tray({ open, title, onClose, children, closeLabel: closeLabelProp, testId }: TrayProps) {
  const kit = useKitCopy();
  const closeLabel = closeLabelProp ?? kit.close;
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus();
    };
  }, [open]);

  if (!open) return null;

  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      data-testid="tray-scrim"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(17,24,39,0.45)] motion-safe:animate-in motion-safe:fade-in-0 md:items-center"
    >
      <div
        ref={panel}
        role="dialog"
        data-state="open"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
        className={cn(
          'flex max-h-[88vh] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-[#f3f4f6] px-3.5 pb-[calc(18px+env(safe-area-inset-bottom))] pt-2 text-[#1d2025] outline-none',
          'motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300',
          'md:max-w-md md:rounded-[22px] md:pb-4',
        )}
      >
        <span data-testid="tray-handle" aria-hidden="true" className="h-[5px] w-11 shrink-0 self-center rounded-full bg-[#c7cad6]" />
        <div className="flex shrink-0 items-center gap-2">
          <h2 id={titleId} className="m-0 mx-1 min-w-0 flex-1 text-[22px] font-semibold leading-tight">
            <bdi>{title}</bdi>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a]', FOCUS)}
          >
            <X className="h-5 w-5" strokeWidth={2.6} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
