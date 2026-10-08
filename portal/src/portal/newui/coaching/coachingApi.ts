import api from '../../services/api';
import type { LibraryPick } from '../../lib/coachingSend';
import type { LessonPlanUsed } from '../home/progressApi';
import { PICKER_WORDS_EN, type PickerWords } from './pickerWords';

/**
 * bd-5rz1v.26 — Check and send's "Recent lesson plans": GET /api/portal/lesson-plans/recent
 * (bd-5rz1v.15), her plans most recently used first, opened in the portal or received on WhatsApp,
 * across both grade bands. Each carries `open` — exactly what Coaching's lesson-plan pick takes.
 *
 * A shortcut, not a requirement: a failure is an empty list, and plans the catalogue no longer
 * has (`found: false`) are left out.
 */
export async function getRecentPlans(limit = 3): Promise<LessonPlanUsed[]> {
  try {
    const { data } = await api.get('/lesson-plans/recent', { params: { limit } });
    const plans: LessonPlanUsed[] = Array.isArray(data?.plans) ? data.plans : [];
    return plans.filter((p) => p && p.found === true && p.open);
  } catch {
    return [];
  }
}

/** What the bot links the lesson to: a grades 1-5 lesson, or a grades 6-12 segment in its language. */
export function pickOf(plan: LessonPlanUsed): LibraryPick {
  if (plan.open.lane === 'k5') return { lessonId: plan.open.lessonId };
  return { segmentId: plan.open.segmentId, lang: plan.open.lang === 'ur' ? 'ur' : 'en' };
}

/** A recent plan's chips: "Grade 4", "Science", "Day 3" (the grade in `words`' language; English by default). */
export function planChips(p: LessonPlanUsed, words: Pick<PickerWords, 'grade'> = PICKER_WORDS_EN): string[] {
  return [
    p.grade != null ? words.grade(p.grade) : null,
    p.subject,
    p.dayLabel,
  ].filter((x): x is string => !!x);
}
