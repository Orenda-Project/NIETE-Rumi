import type { LpLesson } from '../../../newui/lessons/lessonPlansApi';

/**
 * bd-snkn32.14 — "Add the next lesson's pages" (grades 6–12 only). Two shapes: cover both lessons in one period (the
 * class is behind), or a double period. The next lesson is the one right after hers in the chapter's own list — none on
 * the chapter's last lesson, so the choice is not shown there. The bot checks it again (same chapter, adjacent).
 */

export const EXTENDS = ['one_period', 'double'] as const;
export type Extend = (typeof EXTENDS)[number];

type L = Pick<LpLesson, 'id' | 'lane' | 'kind'>;

export function nextLesson<T extends L>(lessons: readonly T[], segId: string | null): T | null {
  if (!segId) return null;
  const i = lessons.findIndex((l) => l.id === segId);
  if (i < 0) return null;
  const [me, next] = [lessons[i], lessons[i + 1]];
  const g612 = (l: L | undefined) => !!l && l.lane === 'g612' && l.kind === 'lesson';
  return g612(me) && g612(next) ? next : null;
}
