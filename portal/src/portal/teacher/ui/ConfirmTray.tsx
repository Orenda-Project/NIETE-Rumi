import type { LucideIcon } from 'lucide-react';
import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import { StatusChip } from './StatusChip';
import { Tray } from './Tray';
import { FOCUS, OUTLINE_WIDE, PRIMARY_WIDE, type ChipData } from './styles';

/**
 * bd-fmf24g.41 — ConfirmTray: the kit's one "are you sure?" sheet. A recording's Finish / Stop asks here first (the
 * teacher's Digital Coaching, the new UI's record page, the coach v2 visit).
 *
 * It is the `Tray` (Android Back, Escape, the dim and the round close all close it), with the title, then what she
 * needs to decide (an optional line, the facts as chips, an amber warning), then TWO buttons stacked in one column,
 * 12px apart: the main one (indigo) over the second one (white outline). Both are the kit's full-width 56px buttons
 * (`PRIMARY_WIDE`, `OUTLINE_WIDE`). They are never side by side and never `flex-1` (a 0 flex basis squashed them to
 * their text: the teacher's "Finish lesson" sheet drew 26px buttons). The second one closes unless given its own
 * `onCancel`. Every word is the screen's.
 */
export interface ConfirmTrayProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** One plain line under the title ("You recorded 12 minutes."). */
  line?: string;
  /** Facts as status chips ("38 min"; "Short lesson" in the waiting tone). */
  chips?: ChipData[];
  /** An amber note, the screen's sentence ("That is short. …"). */
  warning?: string;
  confirmLabel: string;
  onConfirm: () => void;
  confirmIcon?: LucideIcon;
  cancelLabel: string;
  /** The second button; closes the tray when left out. */
  onCancel?: () => void;
  closeLabel?: string;
  testId?: string;
}

export function ConfirmTray({
  open, title, onClose, line, chips, warning, confirmLabel, onConfirm, confirmIcon: Icon, cancelLabel, onCancel, closeLabel, testId,
}: ConfirmTrayProps) {
  const bidi = useBidi();
  const hasChips = Boolean(chips && chips.length);
  return (
    <Tray open={open} title={title} onClose={onClose} closeLabel={closeLabel} testId={testId}>
      {line || hasChips || warning ? (
        <div className="flex flex-col gap-2.5 px-1">
          {line ? <p dir="auto" className="m-0 text-[16px] leading-snug text-[#1d2025]">{bidi(line)}</p> : null}
          {hasChips ? (
            <div className="flex flex-wrap gap-1.5">
              {/* The info grey is the tray's own grey: on it, an info chip is white. */}
              {(chips as ChipData[]).map((c) => (
                <StatusChip key={`${c.tone ?? 'info'}-${c.text}`} text={c.text} tone={c.tone} className={(c.tone ?? 'info') === 'info' ? 'bg-white' : undefined} />
              ))}
            </div>
          ) : null}
          {warning ? (
            <p role="note" className="m-0 flex gap-2.5 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] font-medium leading-snug text-[#b45309]">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <span dir="auto" className="min-w-0 flex-1">{bidi(warning)}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      <div data-testid="confirm-tray-actions" className="flex shrink-0 flex-col gap-3 pb-1">
        <button type="button" onClick={onConfirm} className={cn(PRIMARY_WIDE, FOCUS)}>
          {Icon ? <Icon className="h-5 w-5 shrink-0" aria-hidden="true" /> : null}
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel ?? onClose} className={cn(OUTLINE_WIDE, 'px-4', FOCUS)}>
          {cancelLabel}
        </button>
      </div>
    </Tray>
  );
}
