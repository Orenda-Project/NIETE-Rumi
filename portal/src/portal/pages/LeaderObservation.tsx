import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Check, ChevronLeft, Loader2, MessageCircle } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import { leader } from '../services/api';
import type { CoachFeedback, CoachObservationView } from '../services/api';
import { firstName, isWaiting, trackerIndex, trackerItems } from '../lib/coachObserve';

/**
 * bd-5rz1v.6 — one observation a coach started in the portal, step by step, in
 * the order WhatsApp /observe walks her through it:
 *
 *   ① Lesson analysed → ② Check the draft report → ③ Talk with the teacher →
 *   ④ Your feedback → ⑤ Send the teacher her report
 *
 * The step that is hers is red and named; done steps are green ticks; the ones
 * still to come are grey. Everything happens here — nothing is sent to the
 * coach's WhatsApp. The teacher gets her report on her WhatsApp, and only when
 * the coach sends it.
 */

const COPY = {
  title: 'Observation',
  back: 'Back to Observations',
  notFound: 'We could not find this observation.',
  observedOn: (d: string) => `Observed ${d}`,
  analysing: (name: string) => `Your Digital Coach is listening to ${name}’s lesson. About 10 minutes — you can close this page.`,
  draftReady: 'The draft report is ready. Check it, and change anything you saw differently.',
  checkDraft: 'Check the draft report',
  changeDraft: 'Change the draft report',
  talkNow: (name: string) => `Now talk with ${name}. Your Digital Coach wrote a guide for it.`,
  talkWith: (name: string) => `Talk with ${name}`,
  problems: {
    too_short: 'That recording was too short to give you feedback. Record a few minutes of the two of you talking.',
    failed: 'We could not listen to that recording. Try again, or record it again.',
    feedback_failed: 'We heard your talk, but could not write your feedback. Try again.',
    duplicate: 'That recording was already used for another observation. Record this talk again.',
  } as Record<string, string>,
  tryAgain: 'Try again',
  listening: 'Listening to your talk… About 3 minutes. You can close this page.',
  yourFeedback: 'Your feedback',
  wentWell: 'What you did well',
  tryNext: 'Try next time',
  askYourself: 'Ask yourself',
  concern: 'One thing to look at',
  nextReport: (name: string) => `Next: send ${name} the report`,
  makingReport: (name: string) => `Making ${name}’s report… About 1 minute.`,
  sendTitle: (name: string) => `Send ${name} the report`,
  exactly: (name: string) => `This is exactly what ${name} will get, on WhatsApp.`,
  to: 'To:',
  sendTo: (name: string) => `Send to ${name}`,
  notNow: 'Not now',
  sendFailed: (name: string) => `The report did not reach ${name}. Try again.`,
  sending: 'Sending…',
  waiting: (name: string) => `Waiting for ${name}. We sent ${name} a message — the report opens when they tap it. We remind them once if they don’t.`,
  sent: (name: string) => `Sent to ${name}`,
  sentSub: 'It is on their WhatsApp now.',
  stopped: 'This observation was stopped.',
  stoppedDuplicate: 'This recording was already analysed for another observation, so it was stopped.',
  failedAction: 'Something went wrong. Please try again.',
};

const POLL_MS = 8_000;

function formatDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const Warning = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-2.5 rounded-xl bg-[#fff6e0] px-3.5 py-3 text-[15px] leading-snug text-[#7a5600]">
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

const Primary = ({ children, onClick, to, disabled }: { children: ReactNode; onClick?: () => void; to?: string; disabled?: boolean }) => (to
  ? <Link to={to} className="flex h-[58px] w-full items-center justify-center rounded-[14px] bg-primary text-lg font-bold text-white">{children}</Link>
  : (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex h-[58px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-lg font-bold text-white disabled:opacity-60">
      {children}
    </button>
  ));

const Working = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-white p-4 text-[15px] leading-snug text-[#3a3f4b]">
    <Loader2 className="h-6 w-6 shrink-0 text-primary motion-safe:animate-spin" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

export const FeedbackCard = ({ fb }: { fb: CoachFeedback }) => (
  <div className="flex flex-col gap-3" data-testid="coach-feedback">
    {fb.harmful && fb.concern ? (
      <div className="flex flex-col gap-2 rounded-2xl bg-white p-4">
        <span className="text-[16px] font-bold text-primary">{COPY.concern}</span>
        <p className="text-[15px] leading-relaxed" dir="auto">{fb.concern.what_happened}</p>
        <p className="text-[15px] leading-relaxed text-[#3a3f4b]" dir="auto">{fb.concern.why_it_matters}</p>
        <p className="text-[15px] leading-relaxed font-semibold" dir="auto">{fb.concern.instead}</p>
      </div>
    ) : (
      <>
        {fb.praise_line && (
          <div className="rounded-2xl bg-[#fff8e1] p-4 text-[16px] font-semibold leading-relaxed text-[#5a4300]" dir="auto">🌟 {fb.praise_line}</div>
        )}
        {fb.wins.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl bg-white p-4">
            <span className="text-[15px] font-bold text-[#1b6b43]">{COPY.wentWell}</span>
            {fb.wins.map((w) => (
              <div key={w.behaviour} className="flex gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent"><Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden="true" /></span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold" dir="auto">{w.behaviour}</span>
                  <span className="text-[14px] italic text-[#5b6170]" dir="auto">“{w.evidence}”</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </>
    )}
    {fb.try && (
      <div className="flex flex-col gap-1.5 rounded-2xl bg-white p-4">
        <span className="text-[15px] font-bold text-primary" dir="auto">{COPY.tryNext}: {fb.try.move}</span>
        <span className="text-[14px] leading-relaxed text-[#3a3f4b]" dir="auto">{fb.try.evidence}</span>
        {fb.try.instead && <span className="text-[14px] leading-relaxed" dir="auto">{fb.try.instead}</span>}
        {fb.reflection_question && (
          <span className="mt-1 text-[14px] text-[#5b6170]" dir="auto">{COPY.askYourself}: {fb.reflection_question}</span>
        )}
      </div>
    )}
  </div>
);

const LeaderObservation = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<CoachObservationView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const v = await leader.getObservation(id);
      setView(v);
      setMissing(false);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) setMissing(true);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Re-read while the next step is the worker's, not hers.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (view && isWaiting(view)) timer.current = setTimeout(() => { void load(); }, POLL_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [view, load]);

  const act = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await call();
      await load();
    } catch {
      setActionError(COPY.failedAction);
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <PortalLayout>
        <div className="mx-auto max-w-md py-10 text-center text-muted-foreground">{COPY.notFound}</div>
      </PortalLayout>
    );
  }
  if (!view) return <PortalLayout><LoadingState type="full" /></PortalLayout>;

  const name = (view.teacher && view.teacher.name) || view.report.teacherName || 'the teacher';
  const first = firstName(name);
  const items = trackerItems(first);
  const at = trackerIndex(view.step);
  const fb = view.talk.feedback;
  const pastFeedback = at > 3 && fb;

  return (
    <PortalLayout>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-8">
        <div className="flex h-12 items-center gap-1">
          <button type="button" onClick={() => navigate('/portal/leader/observations')} aria-label={COPY.back}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-primary">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-bold text-primary">{COPY.title}</h1>
        </div>

        <div>
          <div className="text-[22px] font-bold" dir="auto">{name}</div>
          <div className="text-[14px] text-[#5b6170]">
            {[COPY.observedOn(formatDay(view.createdAt)), view.lesson.topic].filter(Boolean).join(' · ')}
          </div>
        </div>

        {view.step !== 'stopped' && (
          <ol data-testid="observe-tracker" className="flex flex-col gap-3 rounded-2xl bg-white p-4">
            {items.map((it, i) => {
              const done = i < at;
              const now = i === at;
              return (
                <li key={it.key} className="flex items-center gap-3" data-state={done ? 'done' : now ? 'now' : 'todo'}>
                  <span className="flex w-8 justify-center">
                    {done ? (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent"><Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden="true" /></span>
                    ) : now ? (
                      <span className="relative flex h-8 w-8 items-center justify-center" aria-hidden="true">
                        <span className="absolute inset-0 rounded-full bg-[rgba(239,83,80,0.45)] animate-attention-ring motion-reduce:hidden" />
                        <span className="relative h-3.5 w-3.5 rounded-full bg-[#e53935]" />
                      </span>
                    ) : <span className="h-4 w-4 rounded-full border-2 border-[#c4c8cf]" aria-hidden="true" />}
                  </span>
                  <span className={done ? 'text-[15px] text-[#1b6b43]' : now ? 'text-[17px] font-bold' : 'text-[15px] text-[#9aa0aa]'} dir="auto">{it.label}</span>
                </li>
              );
            })}
          </ol>
        )}

        {actionError && <Warning>{actionError}</Warning>}

        {view.step === 'analysing' && <Working>{COPY.analysing(first)}</Working>}

        {view.step === 'draft' && (
          <>
            <p className="text-[16px] leading-relaxed text-[#3a3f4b]">{COPY.draftReady}</p>
            <Primary to={`/portal/leader/observe/${view.id}/draft`}>{COPY.checkDraft}</Primary>
          </>
        )}

        {view.step === 'talk' && (
          <>
            {view.problem && COPY.problems[view.problem] && <Warning>{COPY.problems[view.problem]}</Warning>}
            {!view.problem && <p className="text-[16px] leading-relaxed text-[#3a3f4b]" dir="auto">{COPY.talkNow(first)}</p>}
            {(view.problem === 'failed' || view.problem === 'feedback_failed') && (
              <button type="button" disabled={busy} onClick={() => act(() => leader.retryTalk(view.id))}
                className="flex h-[52px] w-full items-center justify-center rounded-[14px] border-2 border-primary bg-white text-[17px] font-bold text-primary disabled:opacity-60">
                {COPY.tryAgain}
              </button>
            )}
            <Primary to={`/portal/leader/observe/${view.id}/talk`}>{COPY.talkWith(first)}</Primary>
            <Link to={`/portal/leader/observe/${view.id}/draft`} className="text-center text-[15px] font-semibold text-primary underline">{COPY.changeDraft}</Link>
          </>
        )}

        {view.step === 'listening' && <Working>{COPY.listening}</Working>}

        {view.step === 'feedback' && fb && (
          <>
            <h2 className="text-[20px] font-bold">{COPY.yourFeedback}</h2>
            <FeedbackCard fb={fb} />
            <Primary disabled={busy} onClick={() => act(() => leader.previewReport(view.id))}>
              {busy && <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />}{COPY.nextReport(first)}
            </Primary>
          </>
        )}

        {view.step === 'report' && view.preparing && <Working>{COPY.makingReport(first)}</Working>}

        {view.step === 'report' && !view.preparing && (
          <>
            <h2 className="text-[20px] font-bold" dir="auto">{COPY.sendTitle(first)}</h2>
            {view.problem === 'send_failed' ? (
              <>
                <Warning>{COPY.sendFailed(first)}</Warning>
                <Primary disabled={busy} onClick={() => act(() => leader.previewReport(view.id))}>{COPY.tryAgain}</Primary>
              </>
            ) : (
              <>
                <p className="text-[14px] text-[#5b6170]" dir="auto">{COPY.exactly(first)}</p>
                <div className="flex flex-col gap-2 rounded-2xl bg-white p-2.5" data-testid="report-preview">
                  {view.report.imageUrl && (
                    <img src={view.report.imageUrl} alt={`${first}’s report`} className="w-full rounded-lg" />
                  )}
                  {view.report.caption && <p className="whitespace-pre-line px-1 text-[14px] leading-relaxed" dir="auto">{view.report.caption}</p>}
                  {view.report.companionText && <p className="whitespace-pre-line px-1 text-[14px] leading-relaxed" dir="auto">{view.report.companionText}</p>}
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-white p-3 text-[15px]" dir="auto">
                  <span className="font-bold">{COPY.to}</span>
                  <span>{[view.report.teacherName || name, view.report.teacherPhone ? `+${view.report.teacherPhone}` : null].filter(Boolean).join(' · ')}</span>
                </div>
                <Primary disabled={busy} onClick={() => act(() => leader.sendReport(view.id))}>{COPY.sendTo(first)}</Primary>
                <Link to="/portal/leader/observations"
                  className="flex h-12 items-center justify-center rounded-xl border border-[#d6d9de] bg-white text-[16px] font-semibold text-[#5b6170]">{COPY.notNow}</Link>
              </>
            )}
          </>
        )}

        {view.step === 'sending' && <Working>{COPY.sending}</Working>}

        {view.step === 'waiting_teacher' && (
          <div className="flex items-start gap-3 rounded-2xl bg-white p-4 text-[15px] leading-relaxed" dir="auto">
            <MessageCircle className="mt-0.5 h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
            <span>{COPY.waiting(first)}</span>
          </div>
        )}

        {(view.step === 'sent' || view.step === 'done') && (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-white p-5 text-center">
            <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-accent"><Check className="h-10 w-10 text-white" strokeWidth={2.6} aria-hidden="true" /></span>
            <span className="text-[22px] font-bold" dir="auto">{COPY.sent(first)}</span>
            <span className="text-[15px] text-[#3a3f4b]">{COPY.sentSub}</span>
          </div>
        )}

        {view.step === 'stopped' && (
          <Warning>{view.problem === 'duplicate' ? COPY.stoppedDuplicate : COPY.stopped}</Warning>
        )}

        {pastFeedback && (
          <details className="rounded-2xl bg-white p-4">
            <summary className="cursor-pointer text-[16px] font-bold">{COPY.yourFeedback}</summary>
            <div className="mt-3"><FeedbackCard fb={fb} /></div>
          </details>
        )}
      </div>
    </PortalLayout>
  );
};

export default LeaderObservation;
