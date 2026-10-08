import { useCallback, useEffect } from 'react';
import { ChevronRight, ExternalLink, KeyRound } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import LessonPlanViewer from '../../components/LessonPlanViewer';
import { useRecordingSession } from '../../lib/recordingSession';
import { openLessonPlanOutside, useLessonPlanOpener, type LessonPlanView } from '../../lib/lessonPlanOpen';
import { FeatureArt } from '../icons';
import { teacherPath } from '../routes';
import { CHEVRON, FOCUS } from '../ui/styles';
import { LESSONS_V2_COPY as C } from './copy';
import TeacherPage from '../TeacherPage';
import { LESSONS_VIEWER, dcHref, type DcPrefill } from './paths';

/**
 * bd-fmf24g.3 — a lesson plan, open (v28 canvas LessonViewer): the plan under its title, and above it
 *
 *   Start DC observation  option A, the light action card with the Digital Coaching art → Digital
 *                         Coaching with her grade, subject and THIS plan prefilled (paths.dcHref)
 *   Answer key            grades 1–5, in this same viewer
 *   Open in another app   today's presigned link
 *
 * While a lesson records, neither Start DC observation (one is running) nor Open in another app
 * (another app in front silences the microphone, bd-5rz1v.10); the frame's recording bar shows
 * instead. The viewer itself is the portal's one viewer (components/LessonPlanViewer). The page is
 * opened with the plan in its history entry (lib/lessonPlanOpen, `page`), so Back closes it; opened
 * any other way (a reload with no entry) it goes to Lesson Plans.
 */

type ViewerState = { lessonPlan?: LessonPlanView; dc?: DcPrefill } | null;

export function ViewerPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const openPlan = useLessonPlanOpener();
  const recording = !!useRecordingSession()?.active;
  const state = location.state as ViewerState;
  const view = state?.lessonPlan ?? null;
  const dc = state?.dc ?? null;

  const close = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate(teacherPath('lessons'), { replace: true });
  }, [location.key, navigate]);

  // A plan opens at its top, wherever the page before was scrolled to.
  const key = view ? JSON.stringify(view.source) : '';
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [key]);

  if (!view) return <Navigate to={teacherPath('lessons')} replace />;

  const source = view.source;
  const answerKey = source.lane === 'k5' && source.assetKind === 'lesson'
    ? { lane: 'k5' as const, lessonId: source.lessonId, assetKind: 'answer_key' as const }
    : null;

  const outside = async () => {
    try {
      if ((await openLessonPlanOutside(source)) === 'not_ready') toast({ title: C.notReady });
    } catch {
      toast({ title: C.couldNotOpen, variant: 'destructive' });
    }
  };

  const act = cn('flex min-h-[56px] items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[15px] font-semibold text-[#33374a]', FOCUS);

  return (
    <TeacherPage crumb={view.crumb} title={view.title} onBack={close}>
      {recording ? null : (
        <Link
          to={dcHref(teacherPath('coaching'), dc)}
          className={cn('flex min-h-[68px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] px-3.5 text-[16px] font-semibold text-[#1d2025]', FOCUS)}
        >
          <FeatureArt feature="coaching" size={40} />
          <span className="flex-1">{C.startDc}</span>
          <ChevronRight className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
        </Link>
      )}
      <div className="flex flex-wrap gap-2">
        {answerKey ? (
          <button
            type="button"
            className={act}
            onClick={() => {
              void openPlan(answerKey, view.title, { crumb: C.crumb(view.crumb, C.answerKey), page: LESSONS_VIEWER, state: { dc } });
            }}
          >
            <KeyRound className="h-5 w-5" aria-hidden="true" />
            {C.answerKey}
          </button>
        ) : null}
        {recording ? null : (
          <button type="button" className={cn(act, 'ms-auto w-14 justify-center px-0')} aria-label={C.openOutside} onClick={() => { void outside(); }}>
            <ExternalLink className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      <LessonPlanViewer
        key={key}
        view={view}
        recording={recording}
        chrome="none"
        onClose={close}
        onNotReady={() => {
          toast({ title: C.notReady });
          close();
        }}
      />
    </TeacherPage>
  );
}
