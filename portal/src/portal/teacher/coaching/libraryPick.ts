import type { NavigateFunction } from 'react-router-dom';
import type { LpLesson } from '../../newui/lessons/lessonPlansApi';
import { holdDraft, peekDraft, type DraftPlan } from './draft';
import { COACHING_NEW } from './paths';

/**
 * bd-fgj73x.5 — Digital Coaching's From the library (operator, 16 Oct; design v11). The Lesson Plans chapters and lessons
 * pages, opened with `pick=dc` for the class she already picked, CHOOSE a plan instead of opening one: a tap on a lesson
 * plan (or Use this lesson plan in its viewer) puts it on her held draft and steps back to the one screen, so the one
 * screen finds everything as she left it, the plan attached, and its Back is the main page again (not the library).
 *
 * How far back: the chapters page is 1 step from the one screen, a chapter's lessons 2, a plan opened with the eye 3.
 * Opened any other way (a reload, no history) it goes to the one screen instead, keeping the draft.
 */

export const DC_PICK = 'dc';

/** The steps from the one screen to each choosing page. */
export const PICK_DEPTH = { chapters: 1, lessons: 2, viewer: 3 } as const;

export type PickTarget = {
  lesson: Pick<LpLesson, 'id' | 'lane' | 'title'>;
  grade: number;
  /** The subject's name ("General Science") and her cross-feature key, for a draft the page lost (a reload). */
  subject: string;
  subjectKey: string | null;
  chips: string[];
};

export function libraryPlan(t: PickTarget): DraftPlan {
  const pick = t.lesson.lane === 'g612' ? { segmentId: t.lesson.id, lang: 'en' as const } : { lessonId: t.lesson.id };
  return { kind: 'library', pick, title: t.lesson.title, chips: t.chips };
}

/** Attach the plan to her draft and go back to the one screen. */
export function attachToDc(navigate: NavigateFunction, t: PickTarget, depth: number, hasHistory: boolean): void {
  const d = peekDraft();
  holdDraft({
    audio: d?.audio ?? null,
    photos: d?.photos ?? [],
    cls: d?.cls ?? { grade: t.grade, subject: t.subject, subjectKey: t.subjectKey },
    plan: libraryPlan(t),
  });
  if (hasHistory) navigate(-depth);
  else navigate(COACHING_NEW, { replace: true, state: { keep: true } });
}
