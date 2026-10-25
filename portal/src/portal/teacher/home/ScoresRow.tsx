import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../ui/styles';
import { useCopy, useLang } from '../i18n';
import { HOME_CARD } from './copy';
import { pickChips, withFraction } from './chips';
import type { HomeCardKind, HomeScores, TapKind } from './api';

/**
 * The score chips (the design rule R6, the build contract): one 36 px row of at most two small pale-grey chips under the card
 * region, the latest own AI-coach score and the latest observation score (both marks out of max), each going to its report. Drawn only where
 * a score EXISTS (report.ts: never a stand-in zero): no number, no chip; no chips, no row. The chip that repeats the
 * card's own rung is left out (the card already opens that report). These are not tiles, so "no numbers on tiles"
 * holds.
 */
export interface ScoresRowProps {
  scores: HomeScores;
  /** The card's rung, when a card is drawn: its own chip is omitted. */
  cardKind?: HomeCardKind | null;
  onGo: (kind: TapKind, href: string) => void;
  className?: string;
}

export function ScoresRow({ scores, cardKind, onGo, className }: ScoresRowProps) {
  const C = useCopy(HOME_CARD);
  const ur = useLang() === 'ur';
  const chips = pickChips(scores, cardKind, C);
  if (!chips.length) return null;
  const dir = ur ? 'rtl' : undefined;

  return (
    <div data-testid="home-scores" className={cn('flex min-h-[36px] flex-wrap items-center gap-2', className)}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          dir={dir}
          data-testid={`home-score-${chip.key}`}
          data-home-chip={chip.key}
          onClick={() => onGo(chip.key, chip.href)}
          className={cn('inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[#eef0f3] px-3 text-[13px] font-medium text-[#374151]', FOCUS)}
        >
          {withFraction(chip.text, chip.frac)}
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
