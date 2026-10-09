import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBidi } from './bidi';
import { CHIP_TONE, type ChipData } from './styles';

/**
 * bd-fmf24g.2.1 — the canvas's chip: INFORMATION, never tappable. A 26px pill, 12px/600, 10px each side; its tone
 * is its meaning (done green, waiting amber, info grey, score indigo, error red). `tick` leads it with a ✓
 * (ListRow's "✓ Used"). `dir="auto"` so "26 of 28" reads that way inside an Urdu page.
 */
export interface StatusChipProps extends ChipData {
  tick?: boolean;
  className?: string;
}

export function StatusChip({ text, tone = 'info', tick = false, className }: StatusChipProps) {
  const bidi = useBidi();
  return (
    <span
      data-chip
      dir="auto"
      className={cn(
        'inline-flex h-[26px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold',
        CHIP_TONE[tone] ?? CHIP_TONE.info,
        className,
      )}
    >
      {tick ? <Check className="h-[13px] w-[13px]" strokeWidth={3} aria-hidden="true" /> : null}
      {bidi(text)}
    </span>
  );
}
