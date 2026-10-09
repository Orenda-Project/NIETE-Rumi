import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FeatureGlyph, FEATURE_HUE } from '../icons';

/**
 * bd-fmf24g.15 — the round feature icon of a notice (the banner's, Home's "Ready for you"): the feature's glyph in
 * its colour on its tint, with a green tick badge at the end-bottom corner (a red "!" when `failed`).
 * Decorative: the row or banner it sits in names the item.
 */
const RED = '#c8331f';

export function NoticeIcon({ feature, size, failed = false }: { feature: 'lessons' | 'assessment' | 'observations'; size: 'lg' | 'md' | 'sm'; failed?: boolean }) {
  const hue = failed ? { fg: RED, bg: '#fee4e2' } : FEATURE_HUE[feature];
  const big = size === 'lg';
  const box = size === 'lg' ? 'h-14 w-14' : size === 'md' ? 'h-[52px] w-[52px]' : 'h-12 w-12';
  return (
    <span aria-hidden="true" className={cn('relative flex shrink-0 items-center justify-center rounded-full', box)} style={{ background: hue.bg, color: hue.fg }}>
      <FeatureGlyph name={feature} size={big ? 28 : size === 'md' ? 26 : 24} />
      <i
        className={cn('absolute -bottom-[3px] -end-[3px] flex items-center justify-center rounded-full border-white text-white', big ? 'h-6 w-6 border-[2.5px]' : size === 'md' ? 'h-5 w-5 border-2' : 'h-5 w-5 border-2')}
        style={{ background: failed ? RED : '#2f7a52' }}
      >
        {failed ? <span className="text-[13px] font-extrabold leading-none">!</span> : <Check className="h-[13px] w-[13px]" strokeWidth={3.6} />}
      </i>
    </span>
  );
}
