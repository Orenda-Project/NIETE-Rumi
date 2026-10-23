import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, KeyRound } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import LessonPlanViewer from '../../components/LessonPlanViewer';
import { useRecordingSession } from '../../lib/recordingSession';
import { lessonPlanFileUrl, lessonPlanShareId, useLessonPlanOpener, type LessonPlanView } from '../../lib/lessonPlanOpen';
import { FeatureArt } from '../icons';
import { teacherPath } from '../routes';
import { CHEVRON, FOCUS } from '../ui/styles';
import { ShareActions } from '../ui/ShareActions';
import { shareToWhatsApp, useShareAvailable } from '../share/api';
import { LESSONS } from './copy';
import { useCopy } from '../i18n';
import TeacherPage from '../TeacherPage';
import { LESSONS_VIEWER, dcHref, type DcPrefill } from './paths';
import { ThingToTryStrip } from './ThingToTryStrip';
import { attachToDc, PICK_DEPTH, type PickTarget } from '../coaching/libraryPick';
import { useLessonsLeader } from './audience';

/**
 * bd-fmf24g.3 — a lesson plan, open (v28 canvas LessonViewer): the plan under its title, and above it
 *
 *   Start DC observation  option A, the light action card with the Digital Coaching art → Digital
 *                         Coaching with her grade, subject and THIS plan prefilled (paths.dcHref)
 *   Answer key            grades 1–5, in this same viewer
 *   Thing to try          grades 1–5, v10 coaching test groups C and D only (ThingToTryStrip; nothing for anyone else).
 *                         Its plan step is outlined in the viewer, and the tap that opens it takes her there (bd-v0toag.8)
 *   ShareActions          the dock: Send on WhatsApp (a template; grey "Not available yet" until one is configured) and
 *                         Open in another app (the plan's presigned PDF link, opened the way her browser allows)
 *
 * While a lesson records, neither Start DC observation (one is running) nor Open in another app
 * (another app in front silences the microphone, bd-5rz1v.10); the frame's recording bar shows
 * instead. The viewer itself is the portal's one viewer (components/LessonPlanViewer). The page is
 * opened with the plan in its history entry (lib/lessonPlanOpen, `page`), so Back closes it; opened
 * any other way (a reload with no entry) it goes to Lesson Plans.
 *
 * bd-fgj73x.5 — opened from Digital Coaching (she is already in a DC observation), no Start DC observation card:
 *   `pick`    with the eye, from From the library: the dock is Use this lesson plan, which attaches it and steps back
 *             to her DC screen (coaching/libraryPick)
 *   `fromDc`  her attached plan, opened to read: Back is her DC screen
 *
 * bd-4joiqz — read by a LEADER (lessons/audience.ts): the plan, its answer key and Open in another app. None of the
 * teacher's own — no Start DC observation (her coaching), no Thing to try (her coaching test group), no Send on
 * WhatsApp (a template to her own number).
 */

type ViewerState = { lessonPlan?: LessonPlanView; dc?: DcPrefill; pick?: PickTarget; fromDc?: boolean } | null;

export function ViewerPage() {
  const C = useCopy(LESSONS);
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const openPlan = useLessonPlanOpener();
  const recording = !!useRecordingSession()?.active;
  const canSend = useShareAvailable('lesson');
  const state = location.state as ViewerState;
  const view = state?.lessonPlan ?? null;
  const dc = state?.dc ?? null;
  // The strip's plan step and her taps on it, for the plan they were read for only: another plan opened from here
  // (the answer key) gets no highlight.
  const [step, setStep] = useState<{ key: string; index: number | null; jump: number }>({ key: '', index: null, jump: 0 });
  const pick = state?.pick ?? null;
  const inDc = !!pick || !!state?.fromDc;
  const leader = useLessonsLeader();
  // Hers only: Start DC observation (also not while a lesson records, or inside a DC observation).
  const teacherActions = !recording && !inDc && !leader;

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

  const act = cn('flex min-h-[56px] items-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[15px] font-semibold text-[#33374a]', FOCUS);

  return (
    <TeacherPage
      crumb={view.crumb}
      title={view.title}
      onBack={close}
      dock={pick ? (
        <button
          type="button"
          onClick={() => attachToDc(navigate, pick, PICK_DEPTH.viewer, location.key !== 'default')}
          className={cn('flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-[#33374a] bg-[#33374a] text-[16px] font-semibold text-white', FOCUS)}
        >
          <Check className="h-5 w-5" aria-hidden="true" />
          {C.usePlan}
        </button>
      ) : (
        <ShareActions
          available={canSend}
          onSend={leader ? undefined : () => shareToWhatsApp('lesson', lessonPlanShareId(source))}
          // While a lesson records, another app in front would silence the microphone (bd-5rz1v.10): no Open then.
          open={recording ? undefined : { fileUrl: () => lessonPlanFileUrl(source) }}
        />
      )}
    >
      {teacherActions ? (
        <Link
          to={dcHref(teacherPath('coaching'), dc)}
          className={cn('flex min-h-[68px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] px-3.5 text-[16px] font-semibold text-[#1d2025]', FOCUS)}
        >
          <FeatureArt feature="coaching" size={40} />
          <span className="flex-1">{C.startDc}</span>
          <ChevronRight className={cn('h-[22px] w-[22px]', CHEVRON)} strokeWidth={2.4} aria-hidden="true" />
        </Link>
      ) : null}
      {answerKey && !leader ? (
        <ThingToTryStrip
          lessonId={answerKey.lessonId}
          onStep={(index) => setStep({ key, index, jump: 0 })}
          onShowStep={() => setStep((s) => ({ ...s, jump: s.jump + 1 }))}
        />
      ) : null}
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
      </div>
      <LessonPlanViewer
        key={key}
        view={view}
        recording={recording}
        highlight={step.key === key && step.index ? { step: step.index, jump: step.jump } : undefined}
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
