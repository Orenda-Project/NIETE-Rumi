import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import PortalLayout from '../../components/PortalLayout';
import { useLessonPlanOpener } from '../../lib/lessonPlanOpen';
import { lessonPlans, type LpLesson } from '../../newui/lessons/lessonPlansApi';
import { teacherPath } from '../routes';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import { LESSONS_HOME, LESSONS_VIEWER } from './paths';
import { PageSkeleton } from '../../components/Skeleton';

/**
 * bd-fmf24g.3 — reopen a lesson plan by its KEY (`?plan=k5:<lesson_id>` | `g612:<segment_id>&lang=`),
 * the way Recent and All lesson plans link to one (the kit's HistoryRow is a link). It decides once,
 * then replaces itself:
 *
 *   grades 1–5    written: the viewer
 *   grades 6–12   asked for in the language she had it in (lessonPlansApi.open) — written: the
 *                 viewer; being written: Preparing; held back: said, and back to Lesson Plans
 *
 * Start DC observation from that viewer gets her grade and this plan (the subject key is not known
 * here; Digital Coaching reads the subject from the plan).
 */

export function OpenPlanPage() {
  const C = useCopy(LESSONS);
  const { search } = useLocation();
  const navigate = useNavigate();
  const openPlan = useLessonPlanOpener();
  const { toast } = useToast();
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const q = new URLSearchParams(search);
    const m = /^(k5|g612):(.+)$/.exec(q.get('plan') || '');
    const home = () => navigate(teacherPath('lessons'), { replace: true });
    if (!m) { home(); return; }
    const [, lane, ref] = m;
    const title = q.get('title') || C.planFallback;
    const g = Number(q.get('grade'));
    const grade = Number.isInteger(g) && g >= 1 && g <= 12 ? g : null;
    const lang = lane === 'g612' ? (q.get('lang') === 'ur' ? 'ur' : 'en') : null;
    const dc = { grade, subjectKey: null, plan: `${lane}:${ref}`, lang };
    const toViewer = (source: Parameters<typeof openPlan>[0]) =>
      openPlan(source, title, { replace: true, page: LESSONS_VIEWER, state: { dc } });

    if (lane === 'k5') {
      void toViewer({ lane: 'k5', lessonId: ref, assetKind: 'lesson' });
      return;
    }
    const lesson: LpLesson = { id: ref, kind: 'lesson', number: null, part: null, title, pages: null, sent: false, answerKey: false, lane: 'g612' };
    lessonPlans.open(lesson, lang ?? undefined).then((r) => {
      if (r.state === 'ready') { void toViewer(r.source); return; }
      if (r.state === 'preparing' && grade != null) {
        const p = new URLSearchParams({ grade: String(grade), subject: '-', lesson: ref, render: r.renderId, title });
        navigate(`${LESSONS_HOME}/preparing?${p.toString()}`, { replace: true });
        return;
      }
      toast({ title: r.state === 'preparing' ? C.notReady : C.notAvailable });
      home();
    }, () => {
      toast({ title: C.couldNotOpen, variant: 'destructive' });
      home();
    });
  }, [search, navigate, openPlan, toast, C]);

  return (
    <PortalLayout ownHeading>
      {/* bd-fxk3t8 — the plan's place held by placeholders while it opens, instead of a spinner. */}
      <div role="status" aria-label={C.title} aria-busy="true" className="px-4 pt-6 md:px-8">
        <PageSkeleton kind="list" />
      </div>
    </PortalLayout>
  );
}
