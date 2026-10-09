import type { LessonsAt } from '../lessons/paths';

/**
 * bd-fmf24g.15 — what the shell follows: a thing she asked for that takes a while (a grades 6–12 lesson plan,
 * about 2 minutes; a paper, about 1), and where it has got to. One shape for both, so the strip, the banner and
 * Home speak of them the same way (COMPONENTS.md §12).
 *
 *   making   asked for, being written
 *   ready    written; the banner tells her once (announced = the banner has finished)
 *   failed   could not be made; the banner tells her once, and the row stays in the strip until she taps it
 *
 * DATA (title, subject) is kept as it came from the API; words are composed at draw time, in her language.
 */
export type NoticeKind = 'lesson' | 'paper';
export type NoticeState = 'making' | 'ready' | 'failed';

export interface NoticeItem {
  /** `${kind}:${ref}` — stable across polls and devices. */
  id: string;
  kind: NoticeKind;
  state: NoticeState;
  /** A plan's or chapter's title, as the API gave it. */
  title: string;
  grade: number | null;
  /** The subject as she knows it ("Science"), a name and not a key. */
  subject: string | null;
  /** Papers: how many questions. */
  questions: number | null;
  startedAt: number;
  readyAt: number | null;
  /** The item's own waiting page (the strip's tap goes there); on it, no strip row and no banner. */
  waitHref: string;
  /** The banner has finished (it ran out, or she closed it). A ready item is gone after it; a failed one stays. */
  announced: boolean;
  /** Paper: the request, the exact body that makes it again, and the paper once it exists. */
  requestId?: string;
  spec?: unknown;
  paperId?: string | null;
  /** Lesson plan: the render, the lesson (segment) it is, the language it was asked in, and where she was. */
  renderId?: string;
  lessonId?: string;
  lang?: string;
  at?: LessonsAt;
  errorCode?: string | null;
}

/** What tracking a new job needs; the rest is the tracker's. */
export interface NewNotice {
  kind: NoticeKind;
  /** The request id (paper) or the render id (lesson plan). */
  ref: string;
  title: string;
  grade: number | null;
  subject: string | null;
  questions: number | null;
  waitHref: string;
  spec?: unknown;
  lessonId?: string;
  lang?: string;
  at?: LessonsAt;
}

export const itemId = (kind: NoticeKind, ref: string) => `${kind}:${ref}`;

/** How long each takes, as the design promises it (lp612.service.js: median 172 s; a paper about a minute). */
export const EXPECTED_MS: Record<NoticeKind, number> = { lesson: 120_000, paper: 60_000 };

/** The first asks come quickly; after 3 minutes a slow one is asked less often. The tab hidden: not at all. */
export const FAST_POLL_MS = 4_000;
export const SLOW_POLL_MS = 15_000;
export const SLOW_AFTER_MS = 3 * 60_000;

/** Elapsed ÷ expected, never past 95%: a late item still lands, so a full ring would be a promise. */
export function progressOf(item: Pick<NoticeItem, 'kind' | 'startedAt'>, now: number): number {
  const p = (now - item.startedAt) / EXPECTED_MS[item.kind];
  return Math.max(0, Math.min(0.95, p));
}

/** Whole minutes left (at least 1), or null once it is past its time: the row then says "Almost done". */
export function minutesLeft(item: Pick<NoticeItem, 'kind' | 'startedAt'>, now: number): number | null {
  const left = EXPECTED_MS[item.kind] - (now - item.startedAt);
  return left <= 0 ? null : Math.max(1, Math.ceil(left / 60_000));
}

/** Oldest first: the next to finish is on top. */
export const oldestFirst = (a: NoticeItem, b: NoticeItem) => a.startedAt - b.startedAt;

/**
 * Is she on this item's own page? There the page itself shows it (the ring, the plan opening by itself, Paper
 * ready), so the strip does not repeat it and the banner does not announce it.
 */
export function isOnOwnPage(item: Pick<NoticeItem, 'waitHref'>, pathname: string, search: string): boolean {
  let own: URL;
  try {
    own = new URL(item.waitHref, 'http://x');
  } catch {
    return false;
  }
  if (own.pathname.replace(/\/+$/, '') !== pathname.replace(/\/+$/, '')) return false;
  // A lesson plan's page is told apart from its neighbours by the render in its address.
  const render = own.searchParams.get('render');
  if (render) return new URLSearchParams(search).get('render') === render;
  return true;
}
