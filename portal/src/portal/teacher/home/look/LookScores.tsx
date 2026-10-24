import { AudioLines, Award, ChevronRight, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../../ui/styles';
import { useCopy, useLang } from '../../i18n';
import { HOME_CARD } from '../copy';
import { pickChips, withFraction } from '../chips';
import type { HomeCardKind, HomeScores, TapKind } from '../api';

/** LookHome asks the same rule whether the strip draws (it climbs into the band on a no-card day). */
export { pickChips } from '../chips';

/**
 * The look's "Your progress" strip: today's score chips (same rule, same taps, same reports; chips.ts) in a white
 * strip, each chip a 44 px pale-slate pill with its glyph on a white disc. No ring and no border on a chip: the kit's
 * keyboard FOCUS is its only outline. With one chip the label shares its row; with two the label is not drawn and
 * each chip takes half the row, wrapping to two full rows when they do not fit. Never cut. No chips, no strip.
 */
export interface LookScoresProps {
  scores: HomeScores;
  /** The card's rung, when a card is drawn: its own chip is omitted. */
  cardKind?: HomeCardKind | null;
  onGo: (kind: TapKind, href: string) => void;
  className?: string;
}

const GLYPH = { chip_coach: AudioLines, chip_obs: Eye } as const;

export function LookScores({ scores, cardKind, onGo, className }: LookScoresProps) {
  const C = useCopy(HOME_CARD);
  const ur = useLang() === 'ur';
  const chips = pickChips(scores, cardKind, C);
  if (!chips.length) return null;
  const two = chips.length > 1;

  return (
    <section
      data-testid="home-scores"
      aria-label={C.look.progress}
      dir={ur ? 'rtl' : undefined}
      className={cn('flex flex-wrap items-center gap-1.5 rounded-2xl border border-[#e5e7eb] bg-white p-1.5', !two && 'ps-3', className)}
    >
      {!two && (
        <p
          data-testid="home-look-progress"
          className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-[#636878]', ur ? 'text-[13px]' : 'text-[12.5px]')}
        >
          <Award className="h-4 w-4 shrink-0 text-[#2e7d57]" strokeWidth={2.2} aria-hidden="true" />
          <span className="min-w-0 truncate">{C.look.progress}</span>
        </p>
      )}
      {chips.map((chip) => {
        const Glyph = GLYPH[chip.key];
        return (
          <button
            key={chip.key}
            type="button"
            data-testid={`home-score-${chip.key}`}
            data-home-chip={chip.key}
            onClick={() => onGo(chip.key, chip.href)}
            className={cn(
              'inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[#e6e9f3] pe-1 ps-2 text-[13px] font-semibold text-[#333748]',
              two && 'flex-1 basis-[calc(50%-3px)]',
              FOCUS,
            )}
          >
            <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-white" aria-hidden="true">
              <Glyph className="h-4 w-4 text-[#333748]" strokeWidth={2.2} />
            </span>
            <span>{withFraction(chip.text, chip.frac)}</span>
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 rtl:rotate-180', two && 'ms-auto')} strokeWidth={2.4} aria-hidden="true" />
          </button>
        );
      })}
    </section>
  );
}
