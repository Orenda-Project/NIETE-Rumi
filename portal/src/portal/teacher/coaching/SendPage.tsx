import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Check, Mic, Pause, Play, RotateCcw, Square, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clockText } from '../../lib/clockText';
import { acceptFor } from '../../lib/coachingUpload';
import { hasHistoryBehind, useMicLevel } from '../../lib/recordFlow';
import { useBack } from '../../lib/useBack';
import { useRecordingClock, useRecordingSession, type RecordingSession } from '../../lib/recordingSession';
import { LevelBars } from '../../newui/coaching/LevelBars';
import { useSendFlow } from '../../newui/coaching/useSendFlow';
import TeacherPage from '../TeacherPage';
import { openUrl } from '../lessons/paths';
import { teacherPath } from '../routes';
import { ConfirmTray } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { useCopy } from '../i18n';
import { COACHING } from './copy';
import { clearDraft, holdDraft, peekDraft, planKeyOf } from './draft';
import { Action, Dock } from './parts';
import { COACHING_HOME, COACHING_SEND, lessonPath } from './paths';

/**
 * bd-fmf24g.4 — the teacher v2 send page (v28 canvas CoachingRecord): the RECORDING page, and the sending that follows,
 * on today's send flow (newui/coaching/useSendFlow, with v2 paths), so the recording, the upload and every failure
 * behave exactly as they do today.
 *
 * bd-fmf24g.76 — Check and send moved INTO the Digital Coaching page (CoachingHome): this page records, and the
 * page holds the recording, the lesson plan and the photos (draft.ts) and has the one Submit.
 *
 *   arrival   the page's choice (state.start): 'record' starts the recording; 'submit' sends what the page holds, with no
 *             class. No choice: back to the page.
 *   record    the ring and clock, Pause / Stop, and the lesson plan one tap away — the recording carries
 *             on there (the recording bar's Return comes back here). Stop, then Yes, finish: the recording is put in the
 *             draft and she is back on the Digital Coaching page, where it is attached.
 *   after     Sending (no menu), Sent → Open lesson, or what went wrong and the way on (back to the page, its draft kept).
 *
 * bd-fmf24g.13.2 — every word in the page's language (useCopy).
 */

/** The way back to the page: its draft is kept (CoachingHome reads state.keep). */
const KEEP = { keep: true };
const PATHS = { record: COACHING_SEND, hub: COACHING_HOME, hubState: KEEP };

function useSession(): RecordingSession {
  const session = useRecordingSession();
  if (!session) throw new Error('SendPage needs a RecordingSessionProvider above it');
  return session;
}

/** A status in the middle of the page: a word, and what to do next under it. */
function Status({ title, tone = 'info', children }: { title: string; tone?: 'info' | 'done' | 'error'; children?: ReactNode }) {
  return (
    <section aria-live="polite" className={cn(CARD, 'flex flex-col items-center gap-2 px-4 py-6 text-center')}>
      <span className={cn('text-[18px] font-semibold', tone === 'done' && 'text-[#2f7a52]', tone === 'error' && 'text-[#c8331f]')}>{title}</span>
      {children}
    </section>
  );
}

export function SendPage() {
  const C = useCopy(COACHING);
  const navigate = useNavigate();
  const goBack = useBack(COACHING_HOME);
  const location = useLocation();
  const session = useSession();
  const flow = useSendFlow(session, PATHS, {
    adopt: () => {
      const d = peekDraft();
      return d ? { audio: d.audio, plan: d.plan, photos: d.photos } : null;
    },
  });
  const { stage, audio } = flow;
  const elapsed = useRecordingClock(session);
  const level = useMicLevel(session.stream, stage === 'recording' && !session.paused);
  const cameFromApp = useRef(location.key !== 'default');

  // A recording in hand (just finished here, or a file taken at "Microphone blocked"): it goes into the draft and
  // she is back on the Digital Coaching page, where it is attached. A sent lesson's draft is cleared.
  useEffect(() => {
    if (stage === 'check' && audio) {
      const d = peekDraft();
      holdDraft({ audio, plan: d?.plan ?? null, photos: d?.photos ?? [] });
      navigate(COACHING_HOME, { replace: true, state: KEEP });
    }
  }, [stage, audio, navigate]);
  useEffect(() => { if (stage === 'sent') clearDraft(); }, [stage]);

  const [confirmFinish, setConfirmFinish] = useState(false);
  const audioInput = useRef<HTMLInputElement>(null);
  const pickAudio = () => audioInput.current?.click();

  const back = () => {
    // While recording, Back simply goes back: the lesson carries on, and the bar leads here again.
    if (stage === 'recording' && (hasHistoryBehind() || cameFromApp.current)) { navigate(-1); return; }
    goBack();
  };

  // The lesson plan she chose, opened in the app (the recording carries on); else the plans.
  const chosenPlan = peekDraft()?.plan ?? null;
  const planHref = (() => {
    if (chosenPlan?.kind !== 'library') return teacherPath('lessons');
    const key = planKeyOf(chosenPlan.pick);
    if (!key) return teacherPath('lessons');
    return openUrl({ plan: key, lang: 'lang' in chosenPlan.pick ? chosenPlan.pick.lang : null, title: chosenPlan.title });
  })();

  const minutesOf = (ms: number | null) => (ms != null ? Math.max(1, Math.round(ms / 60_000)) : null);
  const title = stage === 'sent' ? C.sent
    : stage === 'sending' || stage === 'failed' || stage === 'busy' ? C.send
      : C.recordTitle;
  const crumb = stage === 'recording' && chosenPlan?.kind === 'library' ? `${C.title} · ${chosenPlan.title}` : C.title;

  const dock = stage === 'recording' ? (
    <Dock>
      <Action tone="outline" icon={session.paused ? Mic : Pause} onClick={flow.togglePause}>{session.paused ? C.resume : C.pause}</Action>
      <Action tone="danger" icon={Square} onClick={() => setConfirmFinish(true)}>{C.stop}</Action>
    </Dock>
  ) : null;

  return (
    <TeacherPage
      feature="coaching"
      title={title}
      crumb={crumb}
      onBack={stage === 'sending' ? undefined : back}
      bare={stage === 'sending' || stage === 'recording'}
      dock={dock}
      testId="dc-send"
    >
      <input
        ref={audioInput}
        hidden
        type="file"
        data-testid="dc-send-audio-input"
        accept={acceptFor('audio')}
        onChange={(e) => { void flow.chooseAudio(e.target.files?.[0]); e.target.value = ''; }}
      />

      {stage === 'starting' ? <Status title={C.starting} /> : null}

      {stage === 'micBlocked' ? (
        <>
          <Status title={C.micBlocked} tone="error">
            {/* bd-idkgm2 — ICT feedback row 18: what to do, in her language. */}
            <p className="m-0 text-[15px] leading-[1.5] text-[#4b5563]">{C.micBlockedHint}</p>
          </Status>
          {flow.fileProblem ? <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{flow.fileProblem === 'too_large' ? C.tooLarge : C.notAudio}</p> : null}
          <Dock>
            <Action icon={RotateCcw} onClick={() => { void flow.startRecording(); }}>{C.tryAgain}</Action>
            <Action tone="outline" icon={Upload} onClick={pickAudio}>{C.uploadRecording}</Action>
          </Dock>
        </>
      ) : null}

      {stage === 'recording' ? (
        <>
          <section aria-label={C.recording} className="flex flex-col items-center gap-6 pt-6">
            <div role="timer" className="flex h-60 w-60 flex-col items-center justify-center gap-2.5 rounded-full border-[12px] border-[#fee4e2] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
              <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold', session.paused ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#fee4e2] text-[#c8331f]')}>
                {session.paused ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <i aria-hidden="true" className="h-2 w-2 rounded-full bg-[#c8331f]" />}
                {session.paused ? C.paused : C.recording}
              </span>
              <span data-testid="dc-record-clock" className="text-[54px] font-light leading-none tracking-[-0.02em] tabular-nums">{clockText(elapsed)}</span>
            </div>
            <LevelBars live={!session.paused} level={level} />
            <Link to={planHref} className={cn('flex min-h-14 w-full max-w-[320px] items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-[#c7cad6] bg-white px-4 text-[16px] font-semibold text-[#33374a]', FOCUS)}>
              <BookOpen className="h-[22px] w-[22px]" aria-hidden="true" />
              {chosenPlan?.kind === 'library' ? C.openPlan : C.lessonPlans}
            </Link>
            <span className="text-[13px] font-medium text-[#6b7280]">{C.keepAppOpen}</span>
          </section>
          {/* bd-fmf24g.41: the kit's ConfirmTray (its two buttons were squashed to 26px here by flex-1 in a column). */}
          <ConfirmTray
            open={confirmFinish}
            title={C.finishTitle}
            onClose={() => setConfirmFinish(false)}
            chips={[{ text: C.minutes(minutesOf(session.elapsedMs() || elapsed) as number) }]}
            confirmLabel={C.yesFinish}
            confirmIcon={Check}
            onConfirm={() => { setConfirmFinish(false); void flow.finishRecording(); }}
            cancelLabel={C.keepRecording}
          />
        </>
      ) : null}

      {stage === 'sending' ? (
        <Status title={C.sending}>
          <span className="text-[44px] font-light tabular-nums">{`${flow.progress}%`}</span>
          <span className="text-[13px] font-medium text-[#6b7280]">{C.keepAppOpen}</span>
        </Status>
      ) : null}

      {stage === 'failed' && flow.failure ? (
        flow.failure.kind === 'network' ? (
          <>
            <Status title={C.noInternet} tone="error">{audio?.recordingId ? <span className="text-[14px] text-[#2f7a52]">{C.savedOnPhone}</span> : null}</Status>
            <Dock><Action icon={RotateCcw} onClick={() => { void flow.send(null); }}>{C.tryAgain}</Action></Dock>
          </>
        ) : flow.failure.kind === 'plan_not_ready' || flow.failure.kind === 'plan_not_found' ? (
          <>
            <Status title={C.planNotUsed} tone="error" />
            <Dock>
              <Action
                icon={BookOpen}
                onClick={() => {
                  // The plan is dropped from the page's draft and its plan sheet opens there.
                  holdDraft({ audio: audio ?? null, plan: null, photos: peekDraft()?.photos ?? [] });
                  navigate(COACHING_HOME, { replace: true, state: { keep: true, openPlan: true } });
                }}
              >
                {C.changePlan}
              </Action>
            </Dock>
          </>
        ) : (
          <>
            <Status title={C.notAccepted} tone="error" />
            <Dock><Action icon={RotateCcw} onClick={() => navigate(COACHING_HOME, { replace: true, state: KEEP })}>{C.tryAgain}</Action></Dock>
          </>
        )
      ) : null}

      {stage === 'busy' ? (
        <>
          <Status title={C.busy}>{audio?.recordingId ? <span className="text-[14px] text-[#2f7a52]">{C.savedOnPhone}</span> : null}</Status>
          <Dock>
            {flow.failure?.coachingSessionId ? <Action to={lessonPath(flow.failure.coachingSessionId)}>{C.openThat}</Action> : null}
            <Action tone="outline" to={COACHING_HOME} state={KEEP}>{C.title}</Action>
          </Dock>
        </>
      ) : null}

      {stage === 'sent' && flow.sessionId ? (
        <>
          <Status title={C.sent} tone="done" />
          <Dock>
            <Action icon={Play} onClick={() => navigate(lessonPath(flow.sessionId as string), { replace: true })}>{C.openLesson}</Action>
            <Action tone="outline" onClick={() => navigate(COACHING_HOME, { replace: true })}>{C.title}</Action>
          </Dock>
        </>
      ) : null}
    </TeacherPage>
  );
}
