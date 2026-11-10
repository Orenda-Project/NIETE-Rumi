import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FOCUS, GRID } from './styles';

/**
 * bd-rlxkkt.6 — ChoicePair: two big squares side by side in ONE box with no heading, for a choice between two ways of
 * doing one thing. RecordUploadPair (Start recording / Upload recording) is drawn with these same squares and box; the
 * coach's Coach Training module screen uses it plain (PDF / Video). A plain square is white with its art on a grey disc
 * over the word; `to` makes a square a link, `onPress` a button. 176px squares, or 88px with the art beside the word
 * (`compact`).
 *
 * bd-rlxkkt.12 — `off` + `note`: a square that is not there yet (Coach Training Module 10's Video, "Coming soon"). It keeps
 * its place so the pair still reads as two, greyed, a real disabled button with the note under the word, and its name is
 * "<label>, <note>".
 */
export interface ChoiceItem {
  key: string;
  label: string;
  /** The icon, drawn on the grey disc. */
  art: ReactNode;
  to?: string;
  onPress?: () => void;
  testId?: string;
  /** Not there yet: drawn greyed and disabled, with `note` under the word. */
  off?: boolean;
  note?: string;
}

export interface ChoicePairProps {
  items: readonly [ChoiceItem, ChoiceItem];
  compact?: boolean;
  className?: string;
}

const SQUARE = 'flex min-h-[176px] flex-col items-center justify-center gap-3 rounded-[20px] px-2.5 py-4 text-center text-[16px] font-semibold leading-[1.2]';
const COMPACT = 'flex min-h-[88px] flex-row items-center justify-center gap-2.5 rounded-2xl px-3 py-2.5 text-start text-[16px] font-semibold leading-[1.2]';

/** The white square's look (RecordUploadPair's Upload recording). */
export const PLAIN_SQUARE = 'border border-[#e5e7eb] bg-white text-[#1d2025] shadow-[0_1px_3px_rgba(16,24,40,0.08)]';

/** The grey disc under a plain square's art, at the square's size. */
export const discClass = (compact: boolean) =>
  cn('flex shrink-0 items-center justify-center rounded-full bg-[#e8e9f0] text-[#33374a]', compact ? 'h-11 w-11' : 'h-[84px] w-[84px]');

/** A square that is not there yet: the plain square, greyed. */
const OFF_SQUARE = 'border border-dashed border-[#d1d5db] bg-[#f3f4f6] text-[#6b7280] cursor-not-allowed';

export function PairSquare({ to, onPress, className, children, name, compact, testId, off }: {
  to?: string; onPress?: () => void; className: string; children: ReactNode; name: string; compact?: boolean; testId?: string; off?: boolean;
}) {
  const shape = compact ? COMPACT : SQUARE;
  if (off) return <button type="button" disabled aria-label={name} data-testid={testId} className={cn(shape, OFF_SQUARE, FOCUS)}>{children}</button>;
  return to
    ? <Link to={to} aria-label={name} data-testid={testId} className={cn(shape, className, FOCUS)}>{children}</Link>
    : <button type="button" onClick={onPress} aria-label={name} data-testid={testId} className={cn(shape, className, FOCUS)}>{children}</button>;
}

/** The box both squares sit in. */
export function PairBox({ compact, className, children }: { compact?: boolean; className?: string; children: ReactNode }) {
  return (
    <section className={cn('flex flex-col gap-3 border border-[#e5e7eb] bg-[#f9fafb] shadow-[0_1px_3px_rgba(16,24,40,0.06)]', compact ? 'rounded-[20px] p-2.5' : 'rounded-3xl p-3.5', className)}>
      {children}
    </section>
  );
}

export function ChoicePair({ items, compact = false, className }: ChoicePairProps) {
  return (
    <PairBox compact={compact} className={className}>
      <div className={cn(GRID, 'grid-cols-2 gap-3')}>
        {items.map((it) => (
          <PairSquare key={it.key} to={it.off ? undefined : it.to} onPress={it.off ? undefined : it.onPress} off={it.off}
            name={it.off && it.note ? `${it.label}, ${it.note}` : it.label} compact={compact} testId={it.testId} className={PLAIN_SQUARE}>
            <span aria-hidden="true" className={cn(discClass(compact), it.off && 'opacity-60')}>{it.art}</span>
            {it.off && it.note ? (
              <span aria-hidden="true" className="flex flex-col items-center gap-1">
                <span>{it.label}</span>
                <span className="text-[13px] font-medium text-[#6b7280]">{it.note}</span>
              </span>
            ) : <span aria-hidden="true">{it.label}</span>}
          </PairSquare>
        ))}
      </div>
    </PairBox>
  );
}
