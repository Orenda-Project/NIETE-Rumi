import { cn } from '@/lib/utils';
import { FeatureArt } from '../icons/FeatureArt';
import type { AnyFeature } from '../icons/features';
import { FOCUS } from '../ui/styles';
import { useCopy, useLang } from '../i18n';
import { dayLabel } from '../format';
import { HOME_CARD } from './copy';
import { fullCardWords, type CardAction as Action } from './look/cardWords';
import type { HomeCard, HomeCardKind, TapKind } from './api';

/**
 * Shape A, the full Home card (the design rule R3, the build contract): for the rare-and-new
 * rungs, a fresh coach report, an observation, a first plan. The first thing under the band, climbing into it as the
 * tiles do (`first:-mt-10`). White, radius 20, padding 16: the eyebrow row (art in a pale disc + "Next for you"), the
 * title (18 px, 17 px in Urdu, at most 2 lines, never a score), one sub line (13 px), two 48 px buttons side by side
 * (primary navy, secondary outlined). In Urdu every line carries dir="rtl" itself, so a line that starts with a Latin
 * topic does not flip to LTR; the data inside it is isolated by the copy.
 *
 * Where a tap goes: the portal's own route for the rung (coaching report by id, Observations, Lesson Plans), built
 * from the router's paths (look/cardWords.ts, shared with the look's card); "Quiz this" goes to the signed quiz home,
 * and is not drawn without one.
 */
export type FullKind = Extract<HomeCardKind, 'coach_report' | 'observation' | 'first_plan'>;
export const FULL_KINDS: readonly HomeCardKind[] = ['coach_report', 'observation', 'first_plan'];

const ART: Record<FullKind, AnyFeature> = { coach_report: 'coaching', observation: 'observations', first_plan: 'lessons' };

export interface NextCardProps {
  card: HomeCard;
  /** The signed quiz home, for the coach report's "Quiz this"; null draws no second button there. */
  quizHome: string | null;
  onGo: (kind: TapKind, href: string) => void;
  className?: string;
}

export function NextCard({ card, quizHome, onGo, className }: NextCardProps) {
  const C = useCopy(HOME_CARD);
  const lang = useLang();
  const ur = lang === 'ur';
  if (!FULL_KINDS.includes(card.kind)) return null;
  const kind = card.kind as FullKind;
  const day = dayLabel(card.at, lang);

  const words = fullCardWords(kind, card, quizHome, C, day);
  const dir = ur ? 'rtl' : undefined;

  return (
    <section
      data-testid="home-next-card"
      data-kind={kind}
      data-home-card={kind}
      aria-label={C.eyebrow}
      className={cn('relative rounded-[20px] border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.08)] first:-mt-10', className)}
    >
      <div className="flex min-h-[28px] items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fdeee2]" aria-hidden="true">
          <FeatureArt feature={ART[kind]} size={26} />
        </span>
        <p dir={dir} className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6b7280]">{C.eyebrow}</p>
      </div>
      <h2 dir={dir} data-testid="home-next-title" className="mt-2 line-clamp-2 text-[18px] font-semibold leading-snug text-[#111827] rtl:text-[17px]">
        {words.title}
      </h2>
      {words.sub ? (
        <p dir={dir} data-testid="home-next-sub" className="mt-1 truncate text-[13px] text-[#4b5563]">{words.sub}</p>
      ) : null}
      {/* dir on the row too, so in Urdu the primary sits on the right, where the line starts; [display:grid], not .grid,
          which index.css turns back to LTR under [dir=rtl] (the tile grid does the same) */}
      <div dir={dir} className={cn('mt-3 [display:grid] gap-3', words.secondary ? 'grid-cols-2' : 'grid-cols-1')}>
        <button
          type="button"
          dir={dir}
          data-primary=""
          onClick={() => onGo(kind, words.primary.href)}
          className={cn('flex min-h-[48px] items-center justify-center rounded-2xl bg-[#333748] px-3 text-center text-[16px] font-semibold leading-tight text-white', FOCUS)}
        >
          {words.primary.label}
        </button>
        {words.secondary ? (
          <button
            type="button"
            dir={dir}
            onClick={() => onGo(kind, (words.secondary as Action).href)}
            className={cn('flex min-h-[48px] items-center justify-center rounded-2xl border border-[#d1d5db] bg-white px-3 text-center text-[16px] font-semibold leading-tight text-[#111827]', FOCUS)}
          >
            {words.secondary.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}
