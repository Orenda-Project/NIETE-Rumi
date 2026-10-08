import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, Download, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '../../hooks/useAuth';
import { AudioPlayer } from '../../newui/AudioPlayer';
import { portal } from '../../services/api';
import type { CoachingProgress, SessionDetail } from '../../types/portal';
import TeacherPage from '../TeacherPage';
import { fullName } from '../format';
import { ProgressSteps, ReportBody, VoiceNote } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { COACHING_V2_COPY as C } from './copy';
import { SectionHeading } from './parts';
import { COACHING_HOME } from './paths';
import { dcSteps, loadJourney, toReportData, type JourneyPoint } from './report';

/**
 * bd-fmf24g.4 — the shared report page (v28 canvas CoachingLesson; the coach-visit report uses the same
 * layout): progress while it is worked on, then the report — top to bottom:
 *
 *   header        the lesson's topic; Download (the report image she got on WhatsApp) once it is ready
 *   progress      ProgressSteps from the pipeline's stage; a small "Done" line once ready
 *   voice note    the Digital Coach's spoken debrief, when the bot sent one
 *   recording     her lesson
 *   reflection    the one question, answered here by text (the portal's answer endpoint); answered, it
 *                 folds into "Your answer"
 *   report        ReportBody — the report's own scores, photos, journey, next step, the coach's note
 *
 * Polled as today's lesson page polls (5 s for two minutes, then 15 s) until ready or stopped.
 */

type Loaded = { progress: CoachingProgress | null; detail: SessionDetail | null; journey: JourneyPoint[] };

export function ReportPage({ backTo = COACHING_HOME, crumb = C.title }: { backTo?: string; crumb?: string }) {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState<Loaded>({ progress: null, detail: null, journey: [] });
  const [missing, setMissing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(Date.now());

  const check = useCallback(async () => {
    try {
      const p = await portal.getCoachingProgress(id);
      if (p.stage === 'done') {
        const [d, journey] = await Promise.all([portal.getCoachingSession(id), loadJourney(id)]);
        setState({ progress: p, detail: d.session, journey });
        return;
      }
      setState((s) => ({ ...s, progress: p }));
      if (p.stage === 'stopped') return;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) { setMissing(true); return; }
    }
    const waited = Date.now() - startedAt.current;
    timer.current = setTimeout(() => { void check(); }, waited < 120_000 ? 5_000 : 15_000);
  }, [id]);

  useEffect(() => {
    startedAt.current = Date.now();
    void check();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [check]);

  // Her answer to the one question.
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [sendError, setSendError] = useState(false);
  const sendAnswer = async () => {
    const text = answer.trim();
    if (!text) return;
    setSending(true);
    setSendError(false);
    try {
      const r = await portal.submitCoachingReflection(id, text);
      setSent(r?.acknowledgement || C.answerSent);
      if (timer.current) clearTimeout(timer.current);
      void check();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };
  const [answersOpen, setAnswersOpen] = useState(false);

  const { progress, detail, journey } = state;
  const ready = progress?.stage === 'done' && !!detail;
  const isVisit = !!detail?.observation;
  const reportImage = detail ? (detail.observation?.reportImageUrl || detail.reportUrl || null) : null;
  const asked = progress?.stage === 'reflection' && !sent ? progress.reflection : null;
  const answered = (detail?.reflection ?? []).filter((r) => r.question && r.answer);
  const title = detail?.topic || detail?.subject || C.yourLesson;

  const action = ready && reportImage ? (
    <a
      href={reportImage}
      target="_blank"
      rel="noreferrer"
      download
      aria-label={C.download}
      className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-[#33374a]', FOCUS)}
    >
      <Download className="h-5 w-5" aria-hidden="true" />
    </a>
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
    >
      {!progress ? <p aria-live="polite" className="mx-1 text-[15px] text-[#6b7280]">{C.loading}</p> : null}

      {progress?.stage === 'stopped' ? (
        <section aria-live="polite" className={cn(CARD, 'px-4 py-5 text-center text-[16px] font-semibold text-[#c8331f]')}>{C.stopped}</section>
      ) : null}

      {progress && progress.stage !== 'stopped' && !isVisit ? (
        <ProgressSteps
          heading={C.progress}
          steps={dcSteps(progress.stage, !!sent)}
          done={ready}
          doneLabel={C.reportReady}
        />
      ) : null}

      {ready && detail?.debriefAudioUrl ? (
        <>
          <SectionHeading>{C.voiceNote}</SectionHeading>
          <VoiceNote from={C.title} avatar="dc" duration="" time={toTime(detail.date)} src={detail.debriefAudioUrl} />
        </>
      ) : null}

      {detail?.lessonAudioUrl ? (
        <>
          <SectionHeading>{C.yourRecording}</SectionHeading>
          <AudioPlayer src={detail.lessonAudioUrl} label={C.yourRecording} />
        </>
      ) : null}

      {asked ? (
        <>
          <SectionHeading>{C.stepReflection}</SectionHeading>
          <section aria-label={C.stepReflection} className="flex flex-col gap-3 overflow-hidden rounded-[18px] border border-[#e5e7eb] bg-[#eceef1] p-2.5">
            <div className="max-w-[290px] rounded-[18px] rounded-es-md border border-[#e5e7eb] bg-white px-3.5 pb-2 pt-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
              <div className="mb-1 text-[12px] font-bold text-[#c2410c]">{C.title}</div>
              <p className="m-0 text-[17px] font-medium leading-[1.5]">{asked.question}</p>
            </div>
            <div className="flex items-end gap-2 bg-white p-2.5">
              <textarea
                aria-label={C.yourAnswer}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={2}
                className={cn('min-h-14 flex-1 resize-none rounded-[22px] border-[1.5px] border-[#d1d5db] px-4 py-3 text-[16px]', FOCUS)}
              />
              <button
                type="button"
                aria-label={C.send}
                disabled={sending || !answer.trim()}
                onClick={() => { void sendAnswer(); }}
                className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-white disabled:bg-[#d1d5db] disabled:text-[#6b7280]', FOCUS)}
              >
                <Send className="h-[22px] w-[22px] rtl:-scale-x-100" aria-hidden="true" />
              </button>
            </div>
            {sendError ? <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{C.couldNotSend}</p> : null}
          </section>
        </>
      ) : null}

      {sent && !ready ? (
        <section aria-live="polite" className={cn(CARD, 'px-4 py-3 text-[15px] leading-[1.45]')}>{sent}</section>
      ) : null}

      {ready && answered.length ? (
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
          <ReportBody data={toReportData(detail, { teacher: fullName(user), journey })} />
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
