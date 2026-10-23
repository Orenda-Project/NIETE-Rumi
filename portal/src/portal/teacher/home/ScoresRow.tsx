import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../ui/styles';
import { useCopy, useLang } from '../i18n';
import { lessonPath } from '../coaching/paths';
import { OBS_HOME } from '../observations/paths';
import { HOME_CARD } from './copy';
import type { HomeCardKind, HomeScores, TapKind } from './api';

/**
 * The score chips (the design rule R6, the build contract): one 36 px row of at most two small pale-grey chips under the card
 * region, the latest own AI-coach score and the latest observation score (both marks out of max), each going to its report. Drawn only where
 * a score EXISTS (report.ts: never a stand-in zero): no number, no chip; no chips, no row. The chip that repeats the
 * card's own rung is left out (the card already opens that report). These are not tiles, so "no numbers on tiles"
 * holds.
 */
type Chip = { key: 'chip_coach' | 'chip_obs'; text: string; frac: string; href: string };

/**
 * The chip's words with its "{marks}/{max}" as a <bdi dir="ltr"> (the copy's LRI…PDI pair is dropped for the element,
 * which is the same isolate), so "29/38" never reads "38/29" inside Urdu.
 */
function withFraction(text: string, frac: string): ReactNode {
  const bare = text.replace(/[\u2066-\u2069]/g, '');
  const at = bare.lastIndexOf(frac);
  if (at < 0) return bare;
  return <>{bare.slice(0, at)}<bdi dir="ltr">{frac}</bdi>{bare.slice(at + frac.length)}</>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
  const chips: Chip[] = [];
  // The report page's rule for both: marks out of max, and no chip unless both are numbers.
  const c = scores.coach;
  if (c && cardKind !== 'coach_report' && isNum(c.marks) && isNum(c.max)) {
    chips.push({ key: 'chip_coach', text: C.scores.coach(c.marks, c.max), frac: `${c.marks}/${c.max}`, href: lessonPath(c.id) });
  }
  const o = scores.observation;
  if (o && cardKind !== 'observation' && isNum(o.marks) && isNum(o.max)) {
    chips.push({ key: 'chip_obs', text: C.scores.obs(o.marks, o.max), frac: `${o.marks}/${o.max}`, href: OBS_HOME });
  }
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
