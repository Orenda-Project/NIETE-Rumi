import { useCallback } from 'react';
import { ASSESSMENT } from '../assessment/copy';
import { useCopy } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { useKitCopy } from '../ui/useKitCopy';

/** What every notice screen needs to say about an item, in her language: its kind, its class, its title. */
export interface NoticeLike {
  kind: 'lesson' | 'paper';
  title: string;
  grade: number | null;
  subject: string | null;
  questions: number | null;
  chapterNumber?: number | null;
}

/**
 * bd-fmf24g.15 — the words of an item, one place for the strip, the banner and Home.
 *   what       "Lesson plan" / "Paper"
 *   classLine  "Grade 7 · Science"
 *   titleOf    its title as the API gave it; an item only the server knew has none, so a paper is named by its
 *              chapter ("Chap 2") or its question count, and a plan by "Lesson plan" — never an invented title
 */
export function useNoticeWords() {
  const kit = useKitCopy();
  const assess = useCopy(ASSESSMENT);
  const lessons = useCopy(LESSONS);
  const what = useCallback((i: Pick<NoticeLike, 'kind'>) => (i.kind === 'lesson' ? kit.notify.lessonPlan : kit.notify.paper), [kit]);
  const classLine = useCallback(
    (i: Pick<NoticeLike, 'grade' | 'subject'>) => [i.grade != null ? kit.grade(i.grade) : null, i.subject].filter(Boolean).join(' · '),
    [kit],
  );
  const titleOf = useCallback((i: NoticeLike) => {
    if (i.title) return i.title;
    if (i.kind === 'lesson') return lessons.planFallback;
    if (i.chapterNumber != null) return assess.chapterShort(i.chapterNumber);
    return i.questions != null ? kit.notify.questions(i.questions) : kit.notify.paper;
  }, [kit, assess, lessons]);
  return { what, classLine, titleOf };
}
