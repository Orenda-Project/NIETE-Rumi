import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { FeatureArt } from '../icons/FeatureArt';
import type { AnyFeature } from '../icons/features';
import { StatusChip } from './StatusChip';
import { FOCUS } from './styles';
import type { ChipData } from './styles';

/**
 * bd-4404s7.1 — FeatureTile: the big Home tile. The feature's D2 art (80px) above its label, on a white card; an optional
 * status chip under the label ("2 waiting", "5 this week"). It was written out inside the teacher Home; it is the kit's
 * now, so the coach's Home and every other tile row draw the same one (change one, change all).
 *
 * The art plays its small movement (`motion`, default on) on the page's ONE shared timer, so all tiles move together
 * (put them inside a `FeatureMotionProvider`; without one nothing moves). The chip uses the status tones (waiting amber,
 * done green, info grey): never a feature or grade colour. `wide` is the 132px tile that spans both columns (My Classes).
 * Put the tiles in a two-column `[display:grid]` (not `grid`: see styles.ts). Canvas: FeatureTile board.
 */
export interface FeatureTileProps {
  feature: AnyFeature;
  /** The screen's word for the feature. */
  label: string;
  to: string;
  chip?: ChipData | null;
  wide?: boolean;
  motion?: boolean;
  /** The Home look's three-per-row tile: 104px, 44px art, 14px words (see tileShell). */
  compact?: boolean;
  className?: string;
}

/**
 * The tile's shell, art size and word style, shared with the Quizzes tile (home/QuizTile.tsx) so the two never drift.
 * Default: 176px (132px wide), 80px art, 18px words. `compact`: the Home look's three-per-row tile (operator, 30 Oct
 * 2026, mockup v6 option B): 104px, 44px art, 14px words that may wrap at their spaces.
 */
export function tileShell({ wide = false, compact = false }: { wide?: boolean; compact?: boolean }): string {
  return cn(
    'flex flex-col items-center justify-center rounded-[20px] border border-[#e5e7eb] bg-white text-center shadow-[0_1px_3px_rgba(16,24,40,0.08)]',
    'transition-colors hover:bg-[#f9fafb] motion-reduce:transition-none',
    FOCUS,
    compact ? 'gap-1.5 px-1.5 py-2.5' : 'gap-3.5 px-2.5 py-[18px]',
    wide ? (compact ? 'col-span-2 min-h-[104px]' : 'col-span-2 min-h-[132px]') : compact ? 'min-h-[104px]' : 'min-h-[176px]',
  );
}
export const tileArtSize = (compact = false): number => (compact ? 44 : 80);
export const tileWords = (compact = false): string =>
  cn('font-semibold leading-tight', compact ? 'text-[14px]' : 'text-[18px]');

export function FeatureTile({ feature, label, to, chip, wide = false, motion = true, compact = false, className }: FeatureTileProps) {
  return (
    <Link to={to} className={cn(tileShell({ wide, compact }), className)}>
      <FeatureArt feature={feature} size={tileArtSize(compact)} motion={motion} />
      <span className={tileWords(compact)}>{label}</span>
      {chip && chip.text ? <StatusChip text={chip.text} tone={chip.tone ?? 'info'} /> : null}
    </Link>
  );
}
