import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FeatureArt } from '../icons/FeatureArt';
import { FOCUS } from '../ui/styles';
import { useCopy, useLang } from '../i18n';
import { lessonPath } from '../coaching/paths';
import { LESSONS_HOME } from '../lessons/paths';
import { HOME_CARD } from './copy';
import type { HomeCard, HomeCardKind, TapKind } from './api';

/**
 * Shape B, the slim Home card (the design rule R3, the build contract): for the two quiz rungs, a class
 * send few have played and an un-quizzed lesson. A grid child spanning both columns after tile row 1, so Lesson Plans
 * and Digital Coaching stay whole above the fold. 56 px: the art in a pale amber disc, one 15 px line (ellipsis at its
 * end), the second verb as a 13 px text link under it, the first as a 44 px navy pill at the row's end. Both go to
 * the signed quiz home (the server's `href`), except "Open the plan": a coaching session's report, else Lesson Plans.
 *
 * Cool-down (lesson rung only, the design rule R3.4): a plan's slim card is drawn on at most COOL_DOWN_SHOWS home loads on
 * this device. localStorage `teacher-home-card:v1:<userKey>` holds `{ [lessonId]: shows }`, only the current plan
 * (a newer plan starts at 0). Every read and write is in try/catch; a blocked store means "always draw". The class
 * rung keeps the bot's 72-hour rule and no counter.
 */
export const SLIM_KINDS: readonly HomeCardKind[] = ['class', 'lesson'];
export const COOL_DOWN_SHOWS = 3;

export const coolDownKey = (userKey: string) => `teacher-home-card:v1:${userKey}`;

/** How many times this plan's card was drawn here; null when the store cannot be read (draw it). */
function readShows(userKey: string, lessonId: string): number | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(coolDownKey(userKey)) || '{}');
    const n = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[lessonId] : 0;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  } catch {
    return null;
  }
}

function writeShows(userKey: string, lessonId: string, shows: number): void {
  try {
    localStorage.setItem(coolDownKey(userKey), JSON.stringify({ [lessonId]: shows }));
  } catch { /* a blocked store only means the card is drawn again next time */ }
}

export interface SlimCardProps {
  card: HomeCard;
  /** Whose device counter (her phone number, as Ready for you keys its store). */
  userKey?: string | null;
  onGo: (kind: TapKind, href: string) => void;
  className?: string;
}

export function SlimCard({ card, userKey, onGo, className }: SlimCardProps) {
  const C = useCopy(HOME_CARD);
  const ur = useLang() === 'ur';
  const counted = card.kind === 'lesson' && !!userKey && !!card.id;
  // Decided once per home load (this mount): drawn while the plan has been shown fewer than 3 times.
  const [shows] = useState<number | null>(() => (counted ? readShows(userKey as string, card.id as string) : null));
  const draw = SLIM_KINDS.includes(card.kind) && (shows == null || shows < COOL_DOWN_SHOWS);
  const wrote = useRef(false);

  useEffect(() => {
    if (!counted || !draw || shows == null || wrote.current) return;
    wrote.current = true;
    writeShows(userKey as string, card.id as string, shows + 1);
  }, [counted, draw, shows, userKey, card.id]);

  if (!draw) return null;
  const isClass = card.kind === 'class';
  const line = isClass ? C.class.title(card.played ?? 0) : C.class.sub(card.title);
  const primary = isClass ? C.class.primary : C.lesson.primary;
  const secondary = isClass
    ? { label: C.class.secondary, href: card.href }
    : { label: C.lesson.secondary, href: card.from === 'coach' && card.id ? lessonPath(card.id) : LESSONS_HOME };
  const dir = ur ? 'rtl' : undefined;

  return (
    <div
      data-testid="home-slim-card"
      data-kind={card.kind}
      data-home-card={card.kind}
      role="group"
      aria-label={isClass ? line : C.lesson.title(card.title)}
      className={cn('col-span-2 flex min-h-[56px] items-center gap-3 rounded-[20px] border border-[#e5e7eb] bg-white py-1.5 pe-1.5 ps-2.5 shadow-[0_1px_3px_rgba(16,24,40,0.08)]', className)}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fdf3d0]" aria-hidden="true">
        <FeatureArt feature="assessment" size={24} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <p dir={dir} data-testid="home-slim-line" className="w-full truncate text-[15px] font-semibold leading-tight text-[#111827]">{line}</p>
        <button
          type="button"
          dir={dir}
          onClick={() => onGo(card.kind, secondary.href)}
          className={cn('inline-flex items-center gap-0.5 text-[13px] font-medium text-[#4b5563] underline-offset-2 hover:underline', FOCUS)}
        >
          {secondary.label}
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        dir={dir}
        data-primary=""
        onClick={() => onGo(card.kind, card.href)}
        className={cn('min-h-[44px] shrink-0 rounded-full bg-[#333748] px-4 text-[15px] font-semibold text-white', FOCUS)}
      >
        {primary}
      </button>
    </div>
  );
}
