import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Download, Mic, Send, Square, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '../../hooks/useAuth';
import { AudioPlayer } from '../../newui/AudioPlayer';
import { portal } from '../../services/api';
import { sendVoiceAnswer, useVoiceAnswer } from '../../lib/voiceAnswer';
import type { CoachingProgress, SessionDetail } from '../../types/portal';
import TeacherPage from '../TeacherPage';
import { fullName } from '../format';
import { useCopy } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { ProgressSteps, ReportBody, VoiceNote } from '../ui';
import { ShareActions } from '../ui/ShareActions';
import { shareToWhatsApp, useShareAvailable } from '../share/api';
import { CARD, FOCUS } from '../ui/styles';
import { COACHING } from './copy';
import { SectionHeading } from './parts';
import { goTo } from './navigate';
import { useStableSignedUrl } from '../../lib/stableSignedUrl';
import { COACHING_HOME, COACHING_NEW } from './paths';
import { dcSteps, toReportData } from './report';
import { ClassCheck, Reflection, stoppedLine } from './reportLive';
import { useDcReport } from './useDcReport';
import { LessonQuizButton } from '../home/LessonQuizButton';

/**
 * bd-fmf24g.4 — the shared report page (v28 canvas CoachingLesson; the coach-visit report uses the same
 * layout): progress while it is worked on, then the report — top to bottom:
 *
 *   header        the lesson's topic; Download (the report image she got on WhatsApp) once it is ready
 *   progress      ProgressSteps from the pipeline's stage; a small "Done" line once ready
 *   voice note    the Digital Coach's spoken debrief, when the bot sent one
 *   recording     her lesson
 *   reflection    the one question, answered here by text or by voice (bd-eygg2f, ICT feedback row 5: a mic
 *                 where Send is while the box is empty; tap, speak, Stop, listen, Send — the bot transcribes it);
 *                 answered, it folds into "Your answer"
 *   quiz          "Quiz this lesson" once a Digital Coach report is ready (the Home card's switch; home/LessonQuizButton)
 *   report        ReportBody — the report's own scores, photos, journey, next step, the coach's note
 *
 * Polled as today's lesson page polls (5 s for two minutes, then 15 s) until ready or stopped.
 *
 * bd-fmf24g.13.2 — every word in the page's language (useCopy); the crumb, unless a route names one, is
 * Digital Coaching's title, resolved at render so it follows a language switch.
 */

export function ReportPage({ backTo = COACHING_HOME, crumb: crumbProp }: { backTo?: string; crumb?: string }) {
  const C = useCopy(COACHING);
  const { days } = useCopy(LESSONS);
  const crumb = crumbProp ?? C.title;
  const { id = '' } = useParams();
  const { user } = useAuth();
  // The progress and her answer, shared with the one screen (reportLive.tsx).
  const r = useDcReport(id);
  const navigate = useNavigate();
  const { state, missing, sent } = r;
  const [answersOpen, setAnswersOpen] = useState(false);

  const { progress, detail, journey } = state;
  const ready = progress?.stage === 'done' && !!detail;
  const isVisit = !!detail?.observation;
  const reportImage = detail ? (detail.observation?.reportImageUrl || detail.reportUrl || null) : null;
  // bd-fmf24g.30 — the same report, to her WhatsApp as a template (grey until one is configured), or out of this browser.
  const canSend = useShareAvailable(isVisit ? 'observation' : 'dc');
  const answered = (detail?.reflection ?? []).filter((r) => r.question && r.answer);
  // bd-foyqpc — as her WhatsApp report: the narrative's topic (her language) first.
  const title = detail?.reportNarrative?.topic || detail?.topic || detail?.subject || C.dcObservation;

  // bd-oawrlt — ICT feedback row 14: the link is asked for when she taps, signed then — never the one signed at page
  // load, which expires after an hour (R2's "ExpiredRequest" XML page).
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await portal.getCoachingReportFile(id, 'attachment');
      if (url) goTo(url);
    } catch {
      /* nothing to open: she can tap again */
    } finally {
      setDownloading(false);
    }
  };
  const action = ready && reportImage ? (
    <button
      type="button"
      onClick={() => { void download(); }}
      disabled={downloading}
      aria-label={C.download}
      className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-[#33374a]', FOCUS)}
    >
      <Download className="h-5 w-5" aria-hidden="true" />
    </button>
  ) : undefined;

  if (missing) {
    return (
      <TeacherPage feature={isVisit ? 'observations' : 'coaching'} title={C.notFound} crumb={crumb} backTo={backTo} testId="dc-report">
        <span />
      </TeacherPage>
    );
  }

  return (
    <TeacherPage
      feature={isVisit ? 'observations' : 'coaching'}
      title={title}
      crumb={crumb}
      backTo={backTo}
      action={action}
      testId="dc-report"
      dock={ready && reportImage ? (
        <ShareActions
          available={canSend}
          onSend={() => shareToWhatsApp(isVisit ? 'observation' : 'dc', id)}
          open={{ fileUrl: () => portal.getCoachingReportFile(id, 'inline') }}
        />
      ) : undefined}
    >
      {!progress ? <p aria-live="polite" className="mx-1 text-[15px] text-[#6b7280]">{C.loading}</p> : null}

      {progress?.stage === 'stopped' ? (
        <section aria-live="polite" className={cn(CARD, 'px-4 py-5 text-center text-[16px] font-semibold text-[#c8331f]')}>{stoppedLine(progress, C)}</section>
      ) : null}

      {/* bd-aqotzx — ICT IAB row 16: the recording did not sound like a class; opened from her list. */}
      {progress?.stage === 'confirm_class' && id ? (
        <ClassCheck sessionId={id} onYes={r.recheck} onNo={() => navigate(COACHING_NEW)} />
      ) : null}

      {progress && progress.stage !== 'stopped' && progress.stage !== 'confirm_class' && !isVisit ? (
        <ProgressSteps
          heading={C.progress}
          steps={dcSteps(progress.stage, !!sent, C)}
          done={ready}
          doneLabel={C.reportReady}
        />
      ) : null}

      {/* bd-z3cadk — ICT IAB row 23: the same recording sent again; the bot's own message, as on WhatsApp. */}
      {ready && detail?.duplicate ? <DuplicateNote lead={C.duplicateRecordingLead} next={C.duplicateRecordingNext} /> : null}

      {ready && detail?.debriefAudioUrl ? (
        <>
          <SectionHeading>{C.voiceNote}</SectionHeading>
          <VoiceNote from={C.title} avatar="dc" duration="" time={toTime(detail.date)} src={detail.debriefAudioUrl} />
        </>
      ) : null}

      {/* bd-kn3m1a — ICT feedback row 10: a DC report does not show her recording (or, below, her Q&A) again; the
          order is her answer, the audio summary, then the comprehensive report. A coach's visit report keeps it. */}
      {isVisit && detail?.lessonAudioUrl ? (
        <>
          <SectionHeading>{C.yourRecording}</SectionHeading>
          <AudioPlayer src={detail.lessonAudioUrl} label={C.yourRecording} copy={C.audio} />
        </>
      ) : null}

      <Reflection r={r} />

      {ready && !isVisit ? (
        <LessonQuizButton from="coach" className={cn(CARD, 'flex min-h-[56px] w-full items-center gap-2 px-4 text-[15px] font-semibold text-[#33374a]')} />
      ) : null}

      {ready && isVisit && answered.length ? (
        <>
          <button
            type="button"
            aria-expanded={answersOpen}
            onClick={() => setAnswersOpen((o) => !o)}
            className={cn(CARD, 'mt-2 flex min-h-[68px] w-full items-center gap-3 px-3.5 text-start text-[17px] font-semibold', FOCUS)}
          >
            {C.yourAnswer}
            <ChevronDown className={cn('ms-auto h-[22px] w-[22px] text-[#6b7280]', answersOpen && 'rotate-180')} aria-hidden="true" />
          </button>
          {answersOpen ? (
            <section aria-label={C.yourAnswer} className={cn(CARD, 'flex flex-col gap-3 p-4')}>
              {answered.map((r, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <p className="m-0 text-[15px] font-semibold leading-[1.45]">{r.question}</p>
                  <p className="m-0 text-[15px] leading-[1.45] text-[#374151]">{r.answer}</p>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}

      {ready && detail ? (
        <div className="mt-2">
          {isVisit ? null : <SectionHeading>{C.fullReport}</SectionHeading>}
          {/* bd-z3cadk — a report the bot wrote no narrative for (older ones, and their repeats) would show bare score
              bars here; the WhatsApp report image is the full report, so it is shown instead. */}
          {!isVisit && !detail.reportNarrative && reportImage
            ? <img src={reportImage} alt={C.fullReport} className="block w-full rounded-[18px] border border-[#e5e7eb] bg-white" />
            : <ReportBody data={toReportData(detail, { teacher: fullName(user), journey, words: C, days })} />}
        </div>
      ) : null}
    </TeacherPage>
  );
}

/** The time of day a report came, for the voice note's corner (Pakistan time). */
function toTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
}

/** bd-z3cadk — the bot's repeat-recording message (coaching-messages.js duplicateRecording), in her language. */
export function DuplicateNote({ lead, next }: { lead: string; next: string }) {
  return (
    <section aria-live="polite" className={cn(CARD, 'flex flex-col gap-2 px-4 py-4')}>
      <p className="m-0 text-[16px] font-semibold leading-[1.5]">{lead}</p>
      <p className="m-0 text-[15px] leading-[1.5] text-[#4b5563]">{next}</p>
    </section>
  );
}
