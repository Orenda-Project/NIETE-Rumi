import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLessonPlanOpener } from '../../lib/lessonPlanOpen';
import { paperPath } from '../assessment/paths';
import { dcFor } from '../lessons/useOpenLesson';
import { LESSONS_VIEWER, type LessonsAt } from '../lessons/paths';

/** What opening an item needs; a tracked item and a server item both carry it. */
export interface Openable {
  kind: 'lesson' | 'paper';
  title: string;
  grade: number | null;
  subject: string | null;
  paperId?: string | null;
  renderId?: string | null;
  lessonId?: string | null;
  at?: LessonsAt;
}

/**
 * bd-fmf24g.15 — open a finished item: a paper on its page, a grades 6-12 plan in the plan viewer (carrying what
 * Start DC observation prefills). The one way for the banner and for Home's card.
 */
export function useOpenNotice() {
  const navigate = useNavigate();
  const openPlan = useLessonPlanOpener();
  return useCallback((item: Openable) => {
    if (item.kind === 'paper' && item.paperId) {
      navigate(paperPath(item.paperId));
    } else if (item.kind === 'lesson' && item.renderId) {
      const at = item.at ?? { grade: item.grade ?? 0, subject: item.subject ?? '' };
      void openPlan({ lane: 'g612', renderId: item.renderId }, item.title, {
        page: LESSONS_VIEWER, state: { dc: dcFor({ id: item.lessonId ?? '', lane: 'g612' }, at) },
      });
    }
  }, [navigate, openPlan]);
}
