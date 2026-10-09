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
  className?: string;
}

export function FeatureTile({ feature, label, to, chip, wide = false, motion = true, className }: FeatureTileProps) {
  return (
    <Link
      to={to}
      className={cn(
        'flex flex-col items-center justify-center gap-3.5 rounded-[20px] border border-[#e5e7eb] bg-white px-2.5 py-[18px] text-center shadow-[0_1px_3px_rgba(16,24,40,0.08)]',
        'transition-colors hover:bg-[#f9fafb] motion-reduce:transition-none',
        FOCUS,
        wide ? 'col-span-2 min-h-[132px]' : 'min-h-[176px]',
        className,
      )}
    >
      <FeatureArt feature={feature} size={80} motion={motion} />
      <span className="text-[18px] font-semibold leading-tight">{label}</span>
      {chip && chip.text ? <StatusChip text={chip.text} tone={chip.tone ?? 'info'} /> : null}
    </Link>
  );
}
