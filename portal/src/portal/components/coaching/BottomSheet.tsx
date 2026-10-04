import { useEffect, useRef, type ReactNode } from 'react';

/**
 * bd-5rz1v — a sheet that rises from the bottom of the screen, over a dimmed
 * page. Used for one decision at a time ("Finish recording?", "Add your lesson
 * plan"). Escape or a tap on the dimmed page closes it, when `onClose` is given.
 *
 * data-state="open" (bd-5rz1v.8) is the Radix convention the app's Back key
 * looks for (lib/back-button.cjs OVERLAY_SELECTOR): Back closes the sheet first,
 * by the same Escape, instead of leaving the page under it.
 */
const BottomSheet = ({ label, onClose, children }: { label: string; onClose?: () => void; children: ReactNode }) => {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    if (!onClose) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(29,33,41,0.55)] sm:items-center" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        data-state="open"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3.5 rounded-t-[20px] bg-white px-5 pb-7 pt-6 outline-none sm:rounded-[20px]"
      >
        {children}
      </div>
    </div>
  );
};

export default BottomSheet;
