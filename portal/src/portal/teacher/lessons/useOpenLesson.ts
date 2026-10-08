import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useLessonPlanOpener } from '../../lib/lessonPlanOpen';
import { lessonPlans, type LpLesson } from '../../newui/lessons/lessonPlansApi';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import { LESSONS_VIEWER, lessonsUrl, type DcPrefill, type LessonsAt } from './paths';

/**
 * bd-fmf24g.3 — Open, the one way for every grade, onto the v2 pages. The deciding is the shared
 * client's (lessonPlansApi.open: ready / being written / held back) and the opening the shared opener's
 * (lib/lessonPlanOpen); this only says WHERE: the v2 viewer (carrying the Start DC prefill) or the v2
 * Preparing page.
 */

/** Start DC observation's prefill for a plan opened from these pages. */
export function dcFor(lesson: Pick<LpLesson, 'id' | 'lane'>, at: LessonsAt): DcPrefill {
  const g612 = lesson.lane === 'g612';
  return { grade: at.grade, subjectKey: at.key ?? null, plan: `${g612 ? 'g612' : 'k5'}:${lesson.id}`, lang: g612 ? 'en' : null };
}

export function useOpenLesson() {
  const C = useCopy(LESSONS);
  const openPlan = useLessonPlanOpener();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const open = useCallback(async (lesson: LpLesson, at: LessonsAt, opts: { crumb?: string; replace?: boolean } = {}) => {
    setBusy(true);
    try {
      const r = await lessonPlans.open(lesson);
      if (r.state === 'ready') {
        const how = await openPlan(r.source, lesson.title, {
          crumb: opts.crumb, replace: opts.replace, page: LESSONS_VIEWER, state: { dc: dcFor(lesson, at) },
        });
        if (how === 'not_ready') toast({ title: C.notReady });
      } else if (r.state === 'preparing') {
        navigate(lessonsUrl('preparing', { ...at, lesson: lesson.id, render: r.renderId }), opts.replace ? { replace: true } : undefined);
      } else {
        toast({ title: C.notAvailable, variant: 'destructive' });
      }
    } catch {
      toast({ title: C.couldNotOpen, variant: 'destructive' });
    } finally {
      if (live.current) setBusy(false);
    }
  }, [navigate, openPlan, toast, C]);

  return { open, busy };
}
