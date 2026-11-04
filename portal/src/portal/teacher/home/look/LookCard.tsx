import { useEffect } from 'react';
import { AudioLines, BookOpen, ChevronRight, Eye, ListChecks, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { latinDir, useLatinAttrs } from '@/lib/textDir';
import { FOCUS } from '../../ui/styles';
import { useCopy, useLang } from '../../i18n';
import { HOME_CARD } from '../copy';
import { useCoolDown } from '../coolDown';
import { lookCardWords } from './cardWords';
import type { HomeCard, HomeCardKind, TapKind } from '../api';

/**
 * The look's Home card (portal_teacher_home_look): ONE shape for all five rungs, tinted by kind, compact so the Home
 * fits one phone screen (operator, 31 Oct 2026, mockup v8). A medal (a lucide glyph in a 40 px white disc), the eyebrow
 * ("Next for you"), the title (16 px, at most 2 lines in English; never clamped in Urdu, where a clamp shaves Nastaliq
 * ascenders), one sub line, then one row: the green primary taking the room and, when the kind has one, the secondary
 * as a text link beside it. In Urdu the section carries dir="rtl", so the medal sits on the right and the chevron turns.
 *
 * The lesson rung's title is the registry lead-in alone; its topic is its own block, set by its own script: an English
 * topic on an Urdu page is an LTR run (dir="ltr" + data-latin on the truncating element, so the ellipsis cuts its END),
 * an Urdu topic on an English page gets dir="auto" and the Urdu face with its line height. It has no sub line, and it
 * keeps the slim card's cool-down (3 home loads per plan on this device).
 *
 * The words and where every tap goes are cardWords' (the same as NextCard and SlimCard for the same card).
 */
export const LOOK_KINDS: readonly HomeCardKind[] = ['class', 'coach_report', 'lesson', 'observation', 'first_plan'];

/** The green kinds (a plan to make or quiz); the rest are slate. */
const GREEN_KINDS: readonly HomeCardKind[] = ['lesson', 'first_plan'];
/** The slim rungs take the smaller glyph. */
const SMALL_MEDAL: readonly HomeCardKind[] = ['class', 'lesson'];

const MEDAL: Record<HomeCardKind, LucideIcon> = {
  lesson: ListChecks, first_plan: BookOpen, coach_report: AudioLines, observation: Eye, class: Users,
};

/**
 * Tints and text colours, as literal classes (Tailwind reads the source): the tints are HOME_LOOK.tileGreen /
 * tileSlate and the sub line HOME_LOOK.muted (newui/tokens.ts); the eyebrow is BRAND.buttonEdge on green (7.03:1;
 * the button green would be 4.46:1) and BRAND.ink on slate.
 */
const TONE = {
  green: { tint: 'bg-[#e7f5ed]', eyebrow: 'text-[#1e5c3f]', glyph: '#2e7d57' },
  slate: { tint: 'bg-[#e6e9f3]', eyebrow: 'text-[#333748]', glyph: '#333748' },
} as const;

export interface LookCardProps {
  card: HomeCard;
  /** The signed quiz home, for the coach report's "Quiz this"; null draws no secondary there. */
  quizHome: string | null;
  /** Whose device counter for the lesson's cool-down (the phone number, as Ready for you keys its store). */
  userKey?: string | null;
  onGo: (kind: TapKind, href: string) => void;
  className?: string;
  /** Told whether the card is drawn on this load (the lesson's cool-down may leave it out). */
  onDrawn?: (drawn: boolean) => void;
}

export function LookCard({ card, quizHome, userKey, onGo, className, onDrawn }: LookCardProps) {
  const C = useCopy(HOME_CARD);
  const lang = useLang();
  const ltrOf = useLatinAttrs();
  const draw = useCoolDown(card, userKey);
  const drawn = draw && LOOK_KINDS.includes(card.kind);
  useEffect(() => { onDrawn?.(drawn); }, [drawn, onDrawn]);
  if (!drawn) return null;

  const ur = lang === 'ur';
  const kind = card.kind;
  const tone = TONE[GREEN_KINDS.includes(kind) ? 'green' : 'slate'];
  const small = SMALL_MEDAL.includes(kind);
  const Medal = MEDAL[kind];
  const words = lookCardWords(card, quizHome, C, lang);
  const lesson = kind === 'lesson';
  const latinTopic = !!latinDir(card.title);

  return (
    <section
      data-testid="home-look-card"
      data-home-card={kind}
      data-kind={kind}
      dir={ur ? 'rtl' : undefined}
      aria-label={lesson ? C.lesson.title(card.title) : C.eyebrow}
      className={cn('rounded-[20px] p-3 shadow-[0_1px_3px_rgba(16,24,40,0.08)]', tone.tint, className)}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white" aria-hidden="true">
          <Medal size={small ? 22 : 26} color={tone.glyph} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('font-semibold', tone.eyebrow, ur ? 'text-[13px]' : 'text-[11.5px] uppercase tracking-[0.08em]')}>
            {C.eyebrow}
          </p>
          <h2
            data-testid="home-look-title"
            // A Nastaliq ascender rises above the h2's line box: in Urdu the gap above it is in em, so it grows with the font
            className={cn(ur ? 'mt-[0.4em]' : 'mt-0.5', 'font-semibold text-[#333748]', ur ? 'overflow-visible text-[16px]' : 'line-clamp-2 text-[16px] leading-snug')}
          >
            {words.title}
          </h2>
          {lesson ? (
            // The topic is DATA: its own line, cut at its own end, in its own script's face
            <p
              data-testid="home-look-topic"
              {...ltrOf(card.title)}
              dir={latinTopic ? 'ltr' : 'auto'}
              className={cn('truncate text-[14px] font-semibold text-[#333748]', !latinTopic && 'font-urdu leading-[2]')}
            >
              {card.title}
            </p>
          ) : words.sub ? (
            <p data-testid="home-look-sub" className="mt-0.5 truncate text-[13px] text-[#636878]">{words.sub}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          data-primary=""
          onClick={() => onGo(kind, words.primary.href)}
          className={cn(
            'flex flex-1 min-h-[48px] items-center justify-center whitespace-normal rounded-full bg-[#2e7d57] px-3 text-center text-[16px] font-semibold leading-tight text-white shadow-[0_2px_0_#1e5c3f] rtl:py-1.5 rtl:text-[15px]',
            FOCUS,
          )}
        >
          {words.primary.label}
        </button>
        {words.secondary ? (
          <button
            type="button"
            onClick={() => onGo(kind, (words.secondary as NonNullable<typeof words.secondary>).href)}
            className={cn('flex shrink-0 min-h-[44px] items-center justify-center gap-1 px-1.5 text-[15px] font-medium text-[#333748]', FOCUS)}
          >
            {words.secondary.label}
            <ChevronRight className="h-4 w-4 shrink-0 rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
