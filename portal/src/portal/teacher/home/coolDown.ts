import { useEffect, useRef, useState } from 'react';
import type { HomeCard } from './api';

/**
 * The lesson card's cool-down (the design rule R3.4), shared by the slim card and the look's card: a plan's card is
 * drawn on at most COOL_DOWN_SHOWS home loads on this device. localStorage `teacher-home-card:v1:<userKey>` holds
 * `{ [lessonId]: shows }`, only the current plan (a newer plan starts at 0). Every read and write is in try/catch; a
 * blocked store means "always draw". Every other kind (the class rung keeps the bot's 72-hour rule) has no counter.
 */
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

/**
 * Whether the cool-down lets this card be drawn on this home load; a drawn lesson card counts one show. Decided once
 * per home load (this mount): drawn while the plan has been shown fewer than 3 times.
 */
export function useCoolDown(card: HomeCard, userKey?: string | null): boolean {
  const counted = card.kind === 'lesson' && !!userKey && !!card.id;
  const [shows] = useState<number | null>(() => (counted ? readShows(userKey as string, card.id as string) : null));
  const draw = shows == null || shows < COOL_DOWN_SHOWS;
  const wrote = useRef(false);

  useEffect(() => {
    if (!counted || !draw || shows == null || wrote.current) return;
    wrote.current = true;
    writeShows(userKey as string, card.id as string, shows + 1);
  }, [counted, draw, shows, userKey, card.id]);

  return draw;
}
