import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, Headphones, Image as ImageIcon, Lightbulb, MessageCircle, Mic, Star } from 'lucide-react';
import LoadingState from '../LoadingState';
import NeedsAnswerBanner from './NeedsAnswerBanner';
import { portal } from '../../services/api';
import type { ActiveCoachingSession } from '../../services/api';
import type { CoachingProgress, SessionDetail } from '../../types/portal';
import { bandLabel, scoreBandFor, type BandKey } from '../../lib/scoreBands';
import { parseTranscript } from '../../lib/transcript';
import { withoutScore } from '../../lib/coachingCard';

/**
 * bd-5rz1v — one page per lesson, always openable. While it is being analysed
 * it shows how far along it is; when her question is ready she answers it right
 * here; when the report is done it IS the report. Behind portal_self_observation
 * (PortalCoachingDetail keeps today's report page for everyone else).
 *
 *   ① Analysing your class  →  ② Your question  →  ③ Your report
 *
 * Done steps turn into small green ticks, the step in progress moves, the steps
 * still to come are grey and smaller. A banner on top walks her to the next
 * lesson waiting for her answer, oldest first.
 */

const COPY = {
  back: 'Back to Coaching',
  coaching: 'Coaching',
  yourLesson: 'Your lesson',
  analysing: 'Analysing your class',
  analysingSub: 'About 10 minutes. You can close this page.',
  analysisDone: 'Analysis done',
  yourQuestion: 'Your question',
  answerQuestion: 'Answer your question',
  answerSub: 'Your report comes after you answer.',
  answerOnWhatsApp: 'Answer your question on WhatsApp',
  answerOnWhatsAppSub: 'Your Digital Coach sent it to your WhatsApp.',
  questionAnswered: 'Question answered',
  yourReport: 'Your report',
  makingReport: 'Making your report',
  makingSub: 'About 1 minute.',
  reportReady: 'Report ready',
  answerLabel: 'Your answer',
  answerPlaceholder: 'Write your answer here',
  send: 'Send',
  sending: 'Sending…',
  sendFailed: 'Your answer did not send. Please try again.',
  listen: 'Listen to your Digital Coach',
  tryNext: 'Try this next time',
  wentWell: 'What went well',
  reflection: 'Your reflection',
  seeMore: 'See more',
  areas: 'How each part went',
  classRecording: 'Your class recording',
  allTips: 'All tips',
  reportPicture: 'See your report picture',
  said: 'What was said in class',
  showAll: 'Show all',
  showLess: 'Show less',
  stopped: 'We could not analyse this lesson.',
  stoppedSub: 'Please record it again, or send it on WhatsApp.',
  recordAgain: 'Record again',
  notFound: 'We could not find this lesson.',
  moreWaiting: (n: number) => (n === 1 ? '1 more lesson needs your answer' : `${n} more lessons need your answer`),
  next: 'Next',
};

const LINES_SHOWN = 6;

const BAND_CHIP: Record<BandKey, string> = {
  excellent: 'bg-[#e3f4ea] text-[#1b6b43]',
  good: 'bg-[#e4eef7] text-[#22577a]',
  average: 'bg-[#faf0d7] text-[#7a5600]',
  below_average: 'bg-[#fbe7dc] text-[#9a3f16]',
  needs_support: 'bg-[#fbe7dc] text-[#9a3f16]',
};

type StepKind = 'done' | 'work' | 'you' | 'todo';
type Step = { label: string; kind: StepKind; sub?: string };

function stepsFor(progress: CoachingProgress, answered: boolean): Step[] | null {
  const stage = answered && progress.stage === 'reflection' ? 'report' : progress.stage;
  if (stage === 'queued' || stage === 'transcribing' || stage === 'analysing') {
    return [
      { label: COPY.analysing, kind: 'work', sub: COPY.analysingSub },
      { label: COPY.yourQuestion, kind: 'todo' },
      { label: COPY.yourReport, kind: 'todo' },
    ];
  }
  if (stage === 'reflection') {
    const here = progress.source !== 'whatsapp';
    return [
      { label: COPY.analysisDone, kind: 'done' },
      here
        ? { label: COPY.answerQuestion, kind: 'you', sub: COPY.answerSub }
        : { label: COPY.answerOnWhatsApp, kind: 'you', sub: COPY.answerOnWhatsAppSub },
      { label: COPY.yourReport, kind: 'todo' },
    ];
  }
  if (stage === 'report') {
    return [
      { label: COPY.analysisDone, kind: 'done' },
      { label: COPY.questionAnswered, kind: 'done' },
      { label: COPY.makingReport, kind: 'work', sub: COPY.makingSub },
    ];
  }
  return null;
}

const StepIcon = ({ kind }: { kind: StepKind }) => {
  if (kind === 'done') {
    return (
      <span data-testid="step-done" className="flex h-6 w-6 items-center justify-center rounded-full bg-accent">
        <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  if (kind === 'work') {
    return (
      <span data-testid="step-work" className="relative flex h-8 w-8 items-center justify-center" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border-[3px] border-[#e5e7eb] border-t-primary motion-safe:animate-spin" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary motion-safe:animate-pulse" />
      </span>
    );
  }
  if (kind === 'you') {
    return (
      <span data-testid="step-you" className="relative flex h-8 w-8 items-center justify-center" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-[rgba(239,83,80,0.45)] animate-attention-ring motion-reduce:hidden" />
        <span className="relative h-3.5 w-3.5 rounded-full bg-[#e53935]" />
      </span>
    );
  }
  return <span data-testid="step-todo" className="mx-1.5 h-4 w-4 rounded-full border-2 border-[#c4c8cf]" aria-hidden="true" />;
};

const Tracker = ({ steps }: { steps: Step[] }) => (
  <ol data-testid="lesson-tracker" className="flex flex-col gap-3 rounded-2xl bg-white p-4">
    {steps.map((s) => (
      <li key={s.label} className="flex items-center gap-3">
        <span className="flex w-8 shrink-0 justify-center"><StepIcon kind={s.kind} /></span>
        <span className="flex flex-col">
          <span className={s.kind === 'todo' ? 'text-[15px] text-[#9aa0aa]' : s.kind === 'done' ? 'text-[15px] text-[#1b6b43]' : 'text-[18px] font-bold'}>
            {s.label}
          </span>
          {s.sub && (s.kind === 'work' || s.kind === 'you') && <span className="text-sm text-[#5b6170]">{s.sub}</span>}
          {s.kind === 'work' && (
            <span className="mt-1.5 block h-1.5 w-40 overflow-hidden rounded-full bg-[#eef0f4]" aria-hidden="true">
              <span className="block h-full w-2/5 rounded-full bg-primary animate-progress-stripe motion-reduce:animate-none" />
            </span>
          )}
        </span>
      </li>
    ))}
  </ol>
);

const Section = ({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-4">
    <h2 className="flex items-center gap-2 text-[17px] font-bold text-primary">{icon}{title}</h2>
    {children}
  </section>
);

const Toggle = ({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} aria-expanded={open}
    className="flex h-14 w-full items-center justify-between rounded-2xl bg-white px-4 text-[17px] font-bold text-primary">
    <span>{label}</span>
    <span aria-hidden="true" className="text-2xl font-normal">{open ? '−' : '+'}</span>
  </button>
);

function sentLine(iso: string | undefined, seconds?: number | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  const mins = seconds && seconds > 0 ? `${Math.max(1, Math.round(seconds / 60))} min` : null;
  return [day, mins].filter(Boolean).join(' · ');
}

const LessonPage = ({ sessionId }: { sessionId: string }) => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<CoachingProgress | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [waitingOthers, setWaitingOthers] = useState<ActiveCoachingSession[]>([]);
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [openReflection, setOpenReflection] = useState(false);
  const [openMore, setOpenMore] = useState(false);
  const [allLines, setAllLines] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(Date.now());

  // Progress, polled until the report is ready (or the pipeline stopped).
  const check = useCallback(async () => {
    try {
      const p = await portal.getCoachingProgress(sessionId);
      setProgress(p);
      if (p.stage === 'done') {
        const d = await portal.getCoachingSession(sessionId);
        setDetail(d.session);
        return;
      }
      if (p.stage === 'stopped') return;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) { setMissing(true); return; }
    }
    const waited = Date.now() - startedAt.current;
    timer.current = setTimeout(() => { void check(); }, waited < 120_000 ? 5_000 : 15_000);
  }, [sessionId]);

  useEffect(() => {
    startedAt.current = Date.now();
    setProgress(null); setDetail(null); setMissing(false); setAnswered(false); setAnswer('');
    void check();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [check]);

  // The other lessons waiting for her answer, oldest first.
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => portal.getActiveCoachingSessions())
      .then((r) => {
        if (!live) return;
        const others = ((r && r.sessions) || [])
          .filter((s) => s.needsAnswer && s.id !== sessionId)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        setWaitingOthers(others);
      })
      .catch(() => { /* the banner is a shortcut */ });
    return () => { live = false; };
  }, [sessionId]);

  const sendAnswer = async () => {
    const text = answer.trim();
    if (!text) return;
    setSending(true);
    setSendError(false);
    try {
      await portal.submitCoachingReflection(sessionId, text);
      setAnswered(true);
      if (timer.current) clearTimeout(timer.current);
      void check();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const banner = waitingOthers.length > 0 && (
    <NeedsAnswerBanner text={COPY.moreWaiting(waitingOthers.length)} action={COPY.next}
      to={`/portal/coaching/session/${waitingOthers[0].id}`} />
  );

  const header = (
    <div className="mb-3 flex h-12 items-center gap-1">
      <button type="button" onClick={() => navigate('/portal/coaching')} aria-label={COPY.back}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-primary">
        <ChevronLeft className="h-6 w-6" />
      </button>
      <span className="text-lg font-bold text-primary">{COPY.coaching}</span>
    </div>
  );

  if (missing) {
    return <div className="mx-auto max-w-xl">{header}<p className="py-8 text-center text-muted-foreground">{COPY.notFound}</p></div>;
  }
  if (!progress) return <LoadingState type="full" />;

  // ── could not be analysed ──────────────────────────────────────────────────
  if (progress.stage === 'stopped') {
    return (
      <>{banner}<div className="mx-auto max-w-xl">
        {header}
        <div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-5 py-8 text-center">
          <p className="text-[19px] font-bold">{COPY.stopped}</p>
          <p className="text-[15px] text-[#5b6170]">{COPY.stoppedSub}</p>
          <Link to="/portal/coaching/new" className="flex h-14 w-full items-center justify-center rounded-[14px] bg-primary text-lg font-bold text-white">
            {COPY.recordAgain}
          </Link>
        </div>
      </div></>
    );
  }

  const steps = stepsFor(progress, answered);

  // ── on its way: tracker, and her question when it is ready ─────────────────
  if (steps) {
    const askHere = progress.stage === 'reflection' && !answered && progress.source !== 'whatsapp' && progress.reflection;
    return (
      <>{banner}<div className="mx-auto flex max-w-xl flex-col gap-3.5">
        {header}
        <div>
          <h1 className="text-[22px] font-bold">{COPY.yourLesson}</h1>
          <p className="text-[15px] text-[#5b6170]">{sentLine(progress.createdAt)}</p>
        </div>
        <Tracker steps={steps} />
        {askHere && progress.reflection && (
          <div className="flex flex-col gap-3.5 rounded-2xl border-2 border-primary bg-white p-4">
            <p className="text-[20px] font-semibold leading-snug" dir="auto">{progress.reflection.question}</p>
            <label className="flex flex-col gap-1.5">
              <span className="sr-only">{COPY.answerLabel}</span>
              <textarea
                dir="auto"
                aria-label={COPY.answerLabel}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={COPY.answerPlaceholder}
                className="min-h-[160px] resize-none rounded-xl border-2 border-[#d6d9de] p-3.5 text-[17px] outline-none focus:border-accent"
              />
            </label>
            {sendError && <p className="text-[15px] text-[#c62828]">{COPY.sendFailed}</p>}
            <button type="button" onClick={sendAnswer} disabled={!answer.trim() || sending}
              className="h-14 rounded-xl bg-primary text-lg font-bold text-white disabled:bg-[#9aa0aa]">
              {sending ? COPY.sending : COPY.send}
            </button>
          </div>
        )}
        {progress.stage === 'reflection' && progress.source === 'whatsapp' && (
          <p className="flex items-center gap-2 rounded-xl bg-white p-3.5 text-[15px] text-[#3a3f4b]">
            <MessageCircle className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />{COPY.answerOnWhatsAppSub}
          </p>
        )}
      </div></>
    );
  }

  // ── the report ─────────────────────────────────────────────────────────────
  if (!detail) return <LoadingState type="full" />;
  const data = detail.analysisData || ({} as SessionDetail['analysisData']);
  const tips = (data.recommendations || []).filter(Boolean);
  const tryNext = detail.prioritizedAction?.action ? withoutScore(detail.prioritizedAction.action) : tips[0] || null;
  const strengths = (data.strengths || []).filter(Boolean);
  const reflections = (detail.reflection || []).filter((r) => r.question || r.answer);
  const groups = detail.breakdown?.groups || [];
  const lines = parseTranscript(detail.transcript);

  return (
    <>{banner}<div className="mx-auto flex max-w-xl flex-col gap-3.5 pb-6">
      {header}
      <div>
        <h1 className="text-[24px] font-bold leading-tight" dir="auto">{detail.topic || COPY.yourLesson}</h1>
        <p className="text-[15px] text-[#5b6170]">
          {[detail.subject, sentLine(detail.date, detail.duration)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#1b6b43]">
        {[COPY.analysisDone, COPY.questionAnswered, COPY.reportReady].map((t) => (
          <span key={t} className="flex items-center gap-1"><Check className="h-4 w-4" aria-hidden="true" />{t}</span>
        ))}
      </p>

      {detail.debriefAudioUrl && (
        <Section icon={<Headphones className="h-5 w-5" aria-hidden="true" />} title={COPY.listen}>
          <audio controls preload="none" src={detail.debriefAudioUrl} className="w-full" />
        </Section>
      )}

      {tryNext && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-accent bg-[#e3f4ea] p-4">
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-[#1b6b43]"><Lightbulb className="h-5 w-5" aria-hidden="true" />{COPY.tryNext}</h2>
          <p className="text-[17px] leading-snug" dir="auto">{tryNext}</p>
        </section>
      )}

      {strengths.length > 0 && (
        <Section icon={<Star className="h-5 w-5" aria-hidden="true" />} title={COPY.wentWell}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[16px] leading-snug">
            {strengths.slice(0, 3).map((s) => <li key={s} dir="auto">{s}</li>)}
          </ul>
        </Section>
      )}

      {reflections.length > 0 && (
        <>
          <Toggle open={openReflection} label={COPY.reflection} onClick={() => setOpenReflection((v) => !v)} />
          {openReflection && (
            <div className="-mt-2 flex flex-col gap-3 rounded-b-2xl bg-white px-4 pb-4">
              {reflections.map((r, i) => (
                <div key={i} className="flex flex-col gap-1">
                  {r.question && <p className="text-[15px] font-semibold" dir="auto">{r.question}</p>}
                  {r.answer && <p className="text-[15px] text-[#3a3f4b]" dir="auto">{r.answer}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Toggle open={openMore} label={COPY.seeMore} onClick={() => setOpenMore((v) => !v)} />
      {openMore && (
        <div className="-mt-2 flex flex-col gap-4 rounded-b-2xl bg-white px-4 pb-4">
          {groups.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[15px] font-bold text-primary">{COPY.areas}</h3>
              {groups.map((g) => {
                const band = scoreBandFor(g.pct);
                return (
                  <div key={g.key} className="flex items-center justify-between gap-3">
                    <span className="text-[15px]">{g.name}</span>
                    {band && <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${BAND_CHIP[band]}`}>{bandLabel(band)}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {detail.lessonAudioUrl && (
            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-primary"><Mic className="h-4 w-4" aria-hidden="true" />{COPY.classRecording}</h3>
              <audio controls preload="none" src={detail.lessonAudioUrl} className="w-full" />
            </div>
          )}
          {tips.length > 1 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[15px] font-bold text-primary">{COPY.allTips}</h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">{tips.map((t) => <li key={t} dir="auto">{t}</li>)}</ul>
            </div>
          )}
          {detail.reportUrl && (
            <a href={detail.reportUrl} target="_blank" rel="noopener noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-primary text-base font-bold text-primary">
              <ImageIcon className="h-5 w-5" aria-hidden="true" />{COPY.reportPicture}
            </a>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <section data-testid="transcript" className="flex flex-col gap-2.5 rounded-2xl bg-white p-4">
          <h2 className="text-[17px] font-bold text-primary">{COPY.said}</h2>
          {(allLines ? lines : lines.slice(0, LINES_SHOWN)).map((l, i) => (
            <div key={i} data-testid="transcript-line" className="flex flex-col gap-1">
              {(l.who || l.at) && (
                <span className="flex items-center gap-2 text-xs">
                  {l.who && (
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${/teacher/i.test(l.who) ? 'bg-primary text-white' : 'bg-[#e3f4ea] text-[#1b6b43]'}`}>
                      {l.who}
                    </span>
                  )}
                  {l.at && <span className="text-[#9aa0aa]">{l.at}</span>}
                </span>
              )}
              <p className="text-[15px] leading-relaxed" dir="auto">{l.text}</p>
            </div>
          ))}
          {lines.length > LINES_SHOWN && (
            <button type="button" onClick={() => setAllLines((v) => !v)}
              className="h-11 rounded-[10px] border border-primary text-[15px] font-semibold text-primary">
              {allLines ? COPY.showLess : COPY.showAll}
            </button>
          )}
        </section>
      )}
    </div></>
  );
};

export default LessonPage;
