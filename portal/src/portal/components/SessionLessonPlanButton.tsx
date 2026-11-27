import { useState } from 'react';
import { useLessonPlanOpen } from '../lib/lessonPlanSwitch';
import type { PlanFileKind } from '../lib/lessonPlanOpen';
import { LessonPlanOpenRow } from './LessonPlanOpenRow';
import LessonPlanSheet from './LessonPlanSheet';

/**
 * bd-kijmb8 (queue #318) — the Lesson plan button for a session's own page (the teacher's report): shown only with
 * portal_lesson_plan_open on AND a plan linked (`lessonPlan.openable`); opens it over the page.
 */
export function SessionLessonPlanButton({ sessionId, lessonPlan }: {
  sessionId: string | undefined | null;
  lessonPlan: { source: 'library' | 'own' | 'none'; openable: boolean; fileKind: PlanFileKind | null; title: string | null } | undefined | null;
}) {
  const on = useLessonPlanOpen();
  const [open, setOpen] = useState(false);
  if (!on || !sessionId || !lessonPlan || !lessonPlan.openable || lessonPlan.source === 'none') return null;
  return (
    <>
      <LessonPlanOpenRow source={lessonPlan.source} title={lessonPlan.title} onOpen={() => setOpen(true)} />
      {open && (
        <LessonPlanSheet recording={false} onClose={() => setOpen(false)}
          view={{ source: { lane: 'session', sessionId, fileKind: lessonPlan.fileKind || 'pdf' }, title: lessonPlan.title || '' }} />
      )}
    </>
  );
}
