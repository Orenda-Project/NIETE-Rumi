import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KIT_COPY } from './copy';
import { FOCUS, TAP_SQUARE } from './styles';

/**
 * bd-5rz1v.19 — a sheet that rises from the bottom over a dimmed page (deep-screens.html
 * `.scrim`, `.sheet`): the light page colour, 22px top corners, a grab handle, a 20px/800 title
 * and a 56px close at the end of the title row. A centred card on a desktop.
 *
 * ANDROID BACK: role="dialog" + data-state="open" is the convention BackButtonHandler looks for
 * (lib/back-button.cjs OVERLAY_SELECTOR, the same as coaching/BottomSheet and Radix). Back
 * closes the sheet first — it sends Escape from whatever has focus, and Escape closes this.
 *
 * Also: Escape, a tap on the dimmed page, or the close button close it; focus moves in when it
 * opens, stays inside while it is open (Tab wraps) and returns to where it was. The page under
 * it does not scroll. It rises only when motion is allowed.
 */
export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  testId?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, title, onClose, children, closeLabel = KIT_COPY.close, testId }: SheetProps) {
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
      data-testid="newui-sheet-scrim"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-nu-surface-scrim motion-safe:animate-in motion-safe:fade-in-0 md:items-center"
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
          'flex max-h-[88vh] w-full flex-col gap-2.5 overflow-y-auto rounded-t-[22px] bg-nu-surface px-3 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2.5 outline-none',
          'motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300',
          'md:max-w-md md:rounded-[22px] md:pb-4',
        )}
      >
        <span data-testid="newui-sheet-handle" aria-hidden="true" className="h-1 w-10 shrink-0 self-center rounded bg-nu-surface-handle md:hidden" />
        <div className="-my-1 flex items-center justify-between gap-2 ps-1">
          <h2 id={titleId} className="min-w-0 truncate text-xl font-extrabold text-nu-surface-text rtl:font-bold rtl:leading-[2]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className={cn('-me-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-nu-surface-muted active:bg-nu-ink-xlight', TAP_SQUARE, FOCUS)}
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
