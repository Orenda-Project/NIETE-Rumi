import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLessonPlanOpener } from '../../lib/lessonPlanOpen';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { ownChangeAt } from '../lessons/own/change';
import { paperPath } from '../assessment/paths';
import { dcFor } from '../lessons/useOpenLesson';
import { LESSONS_VIEWER, type LessonsAt } from '../lessons/paths';

/** What opening an item needs; a tracked item and a server item both carry it. */
export interface Openable {
  kind: 'lesson' | 'paper' | 'observation';
  title: string;
  grade: number | null;
  subject: string | null;
  paperId?: string | null;
  /** The coach's observation, once the server has it. */
  observationId?: string | null;
  /** bd-33wxxi.4 — the page it opens on when that is not the coach's (the principal app's observation page). */
  openHref?: string | null;
  renderId?: string | null;
  lessonId?: string | null;
  at?: LessonsAt;
}

/**
 * bd-fmf24g.15 — open a finished item: a paper on its page, a grades 6-12 plan in the plan viewer (carrying what
 * Start DC observation prefills). The one way for the banner and for Home's card.
 * bd-4404s7.4 — a coach's observation that has been sent opens on the coach's observation page.
 * bd-snkn32.21 — her own Make my own plan carries `own` (as the Preparing page's open does), so the viewer offers
 * "Change this plan" and the section cards. The status is asked once; unreadable or not hers, it opens as before.
 */
export function useOpenNotice() {
  const navigate = useNavigate();
  const openPlan = useLessonPlanOpener();
  return useCallback((item: Openable) => {
    if (item.kind === 'observation') {
      if (item.observationId) navigate(item.openHref || `/portal/coach/observation/${item.observationId}`);
    } else if (item.kind === 'paper' && item.paperId) {
      navigate(paperPath(item.paperId));
    } else if (item.kind === 'lesson' && item.renderId) {
      const renderId = item.renderId;
      const at = item.at ?? { grade: item.grade ?? 0, subject: item.subject ?? '' };
      const lesson = at.lesson ?? item.lessonId ?? '';
      void lessonPlans.status(renderId).catch(() => null).then((s) => {
        const own = s?.state === 'ready' && s.own && lesson
          ? { own: ownChangeAt({ ...at, lesson, render: renderId }, s.own, item.title) } : {};
        return openPlan({ lane: 'g612', renderId }, item.title, {
          page: LESSONS_VIEWER, state: { dc: dcFor({ id: item.lessonId ?? '', lane: 'g612' }, at), ...own },
        });
      });
    }
  }, [navigate, openPlan]);
}
