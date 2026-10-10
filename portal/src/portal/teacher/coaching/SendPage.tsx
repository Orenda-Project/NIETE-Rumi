import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Check, Mic, Pause, Play, RotateCcw, Send, Square, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clockText } from '../../lib/clockText';
import { acceptFor } from '../../lib/coachingUpload';
import type { TeacherClass } from '../../lib/coachingSend';
import { loadGradeSubjects, type GradeSubject } from '../../lib/gradeSubjects';
import { hasHistoryBehind, useMicLevel } from '../../lib/recordFlow';
import { useRecordingClock, useRecordingSession, type RecordingSession } from '../../lib/recordingSession';
import { LevelBars } from '../../newui/coaching/LevelBars';
import { LibraryStep, type LibraryStepInfo } from '../../newui/coaching/LibraryStep';
import { PlanSheet } from '../../newui/coaching/PlanSheet';
import { useSendFlow } from '../../newui/coaching/useSendFlow';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import TeacherPage from '../TeacherPage';
import { openUrl } from '../lessons/paths';
import { teacherPath } from '../routes';
import { ClassPicker, ConfirmTray, type GradeSubjectPair } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { useCopy } from '../i18n';
import { COACHING, type CoachingCopy } from './copy';
import { clearDraft, peekDraft, planKeyOf, type DraftPlan } from './draft';
import { PhotoGrid, PlanPicker, SectionHeading } from './parts';
import { COACHING_HOME, COACHING_SEND, lessonPath } from './paths';

/**
 * bd-fmf24g.4 — the teacher v2 send page (v28 canvas CoachingRecord + CoachingCheck): record, check and
 * send, sent — one page on today's send flow (newui/coaching/useSendFlow, with v2 paths), so the
 * recording, the upload and every failure behave exactly as they do today.
 *
 *   arrival   the hub's choice (state.start) and its plan + photos (draft.ts). No choice: back to the hub.
 *   record    the ring and clock, Pause / Stop, and the lesson plan one tap away — the recording carries
 *             on there (the recording bar's Return comes back here).
 *   check     her lesson (listen, Redo / Change file), Attached: her class, the lesson plan, the photos —
 *             each changeable here — then Send.
 *   after     Sending (no menu), Sent → Open lesson, or what went wrong and the way on.
 *
 * bd-fmf24g.13.2 — every word in the page's language (useCopy). The plan sheet and the library step are
 * today's (newui/coaching) and keep their own words.
 */

const PATHS = { record: COACHING_SEND, hub: COACHING_HOME };

function useSession(): RecordingSession {
  const session = useRecordingSession();
  if (!session) throw new Error('SendPage needs a RecordingSessionProvider above it');
  return session;
}

const comboLabel = (c: GradeSubjectPair | null, C: CoachingCopy) => (c ? `${C.grade(c.grade)} · ${c.subject}` : C.title);

function Dock({ children }: { children: ReactNode }) {
  return <div className="flex w-full gap-2.5">{children}</div>;
}

function Action({ children, onClick, to, tone = 'primary', icon: Icon, disabled }: {
  children: ReactNode; onClick?: () => void; to?: string; tone?: 'primary' | 'outline' | 'danger';
  icon?: typeof Send; disabled?: boolean;
}) {
  const cls = cn(
    'flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-[1.5px] text-[16px] font-semibold',
    tone === 'primary' && 'border-[#33374a] bg-[#33374a] text-white',
    tone === 'danger' && 'border-[#c8331f] bg-[#c8331f] text-white',
    tone === 'outline' && 'border-[#c7cad6] bg-white text-[#33374a]',
    disabled && 'pointer-events-none border-[#e5e7eb] bg-[#e5e7eb] text-[#6b7280]',
    FOCUS,
  );
  const body = <>{Icon ? <Icon className="h-5 w-5" aria-hidden="true" /> : null}{children}</>;
  return to
    ? <Link to={to} className={cls}>{body}</Link>
    : <button type="button" onClick={onClick} disabled={disabled} className={cls}>{body}</button>;
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
  const location = useLocation();
  const session = useSession();
  const flow = useSendFlow(session, PATHS);
  const { stage, audio, plan, photos } = flow;
  const elapsed = useRecordingClock(session);
  const level = useMicLevel(session.stream, stage === 'recording' && !session.paused);
  const cameFromApp = useRef(location.key !== 'default');

  const [combosLoad] = useLoad(() => loadGradeSubjects(), 'gs:coaching');
  const mine = useMemo(
    () => (dataOf(combosLoad) ?? []).filter((c): c is GradeSubject & { grade: number } => c.grade != null),
    [combosLoad],
  );
  const [combo, setCombo] = useState<GradeSubjectPair | null>(() => peekDraft()?.combo ?? null);

  // bd-fmf24g.9: the class she picked travels with the recording and is what the lesson is scored on. Her
  // subject key comes from her own class list (the pick is her subject's name, in her language).
  const teacherClass = useMemo<TeacherClass | null>(() => {
    if (!combo) return null;
    const hit = mine.find((c) => c.grade === combo.grade && c.subject === combo.subject);
    return { grade: combo.grade, subject: combo.subject, ...(hit?.subjectKey ? { subjectKey: hit.subjectKey } : {}) };
  }, [combo, mine]);

  // The hub's plan and photos, once, after the flow has taken its arrival.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const d = peekDraft();
    if (!d) return;
    if (d.plan?.kind === 'library') flow.pickPlan({ pick: d.plan.pick, title: d.plan.title, chips: d.plan.chips });
    else if (d.plan?.kind === 'file') flow.choosePlanFile(d.plan.file, d.plan.asPhoto);
    if (d.photos.length) flow.addPhotos(d.photos);
    // Once, on arrival; the handlers are this render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (stage === 'sent') clearDraft(); }, [stage]);

  const [confirmFinish, setConfirmFinish] = useState(false);
  const [planSheet, setPlanSheet] = useState(false);
  const [library, setLibrary] = useState<LibraryStepInfo>({ level: 0, crumb: [] });
  const [libraryBack, setLibraryBack] = useState(0);
  const onLibraryStep = useCallback((info: LibraryStepInfo) => setLibrary(info), []);
  const audioInput = useRef<HTMLInputElement>(null);
  const pickAudio = () => audioInput.current?.click();

  // Listening back: the recording's url follows it and is released with it.
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    setPlaying(false);
    if (!audio) { setAudioUrl(null); return undefined; }
    let url: string | null = null;
    try { url = URL.createObjectURL(audio.blob); } catch { url = null; }
    setAudioUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [audio]);
  const togglePlay = () => {
    const el = player.current;
    if (!el) return;
    try {
      if (playing) { el.pause(); setPlaying(false); } else { void el.play()?.catch(() => setPlaying(false)); setPlaying(true); }
    } catch {
      setPlaying(false);
    }
  };

  const back = () => {
    if (stage === 'library') {
      if (library.level > 0) setLibraryBack((n) => n + 1); else flow.setStage('check');
      return;
    }
    // While recording, Back simply goes back: the lesson carries on, and the bar leads here again.
    if (stage === 'recording' && (hasHistoryBehind() || cameFromApp.current)) { navigate(-1); return; }
    navigate(COACHING_HOME);
  };

  // The lesson plan she chose, opened in the app (the recording carries on); else the plans.
  const planHref = (() => {
    if (plan?.kind !== 'library') return teacherPath('lessons');
    const key = planKeyOf(plan.pick);
    if (!key) return teacherPath('lessons');
    return openUrl({ plan: key, lang: 'lang' in plan.pick ? plan.pick.lang : null, title: plan.title });
  })();

  const minutesOf = (ms: number | null) => (ms != null ? Math.max(1, Math.round(ms / 60_000)) : null);
  const title = stage === 'check' ? C.checkTitle
    : stage === 'library' ? C.lessonPlans
      : stage === 'sent' ? C.sent
        : stage === 'sending' || stage === 'failed' || stage === 'busy' ? C.send
          : C.recordTitle;
  const crumb = stage === 'recording' && plan?.kind === 'library' ? `${comboLabel(combo, C)} · ${plan.title}` : comboLabel(combo, C);

  const dock = stage === 'recording' ? (
    <Dock>
      <Action tone="outline" icon={session.paused ? Mic : Pause} onClick={flow.togglePause}>{session.paused ? C.resume : C.pause}</Action>
      <Action tone="danger" icon={Square} onClick={() => setConfirmFinish(true)}>{C.stop}</Action>
    </Dock>
  ) : stage === 'check' && audio ? (
    <Dock><Action icon={Send} onClick={() => { void flow.send(teacherClass); }}>{C.send}</Action></Dock>
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
          <Status title={C.micBlocked} tone="error" />
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
              {plan?.kind === 'library' ? C.openPlan : C.lessonPlans}
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

      {stage === 'check' && audio ? (
        <>
          <section aria-label={C.yourRecording} className={cn(CARD, 'flex min-h-[84px] items-center gap-3 p-3')}>
            <button
              type="button"
              onClick={togglePlay}
              disabled={!audioUrl}
              aria-label={playing ? C.stopListening : C.listen}
              className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#2f7a52] bg-white text-[#2f7a52]', FOCUS)}
            >
              {playing ? <Pause className="h-[22px] w-[22px]" aria-hidden="true" /> : <Play className="h-[22px] w-[22px] rtl:rotate-180" aria-hidden="true" />}
            </button>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[16px] font-semibold">{audio.source === 'file' ? audio.filename : C.yourRecording}</span>
              {minutesOf(audio.durationMs) != null ? <span className="text-[13px] text-[#6b7280]">{C.minutes(minutesOf(audio.durationMs) as number)}</span> : null}
            </span>
            <button
              type="button"
              onClick={() => { setPlaying(false); void flow.redo(pickAudio); }}
              className={cn('flex min-h-14 items-center gap-1.5 rounded-xl bg-[#f3f4f6] px-3.5 text-[14px] font-semibold text-[#33374a]', FOCUS)}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {audio.recordingId ? C.redo : C.changeFile}
            </button>
            {audioUrl ? <audio ref={player} src={audioUrl} preload="metadata" onEnded={() => setPlaying(false)} className="hidden" /> : null}
          </section>
          {flow.fileProblem ? <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{flow.fileProblem === 'too_large' ? C.tooLarge : C.notAudio}</p> : null}

          <SectionHeading>{C.attached}</SectionHeading>
          <section aria-label={C.attached} className="flex flex-col gap-2.5">
            {mine.length ? (
              <ClassPicker label={C.yourClass} combos={mine} allowOther={false} value={combo} onChange={(v) => setCombo(v)} />
            ) : null}
            <PlanPicker plan={plan as DraftPlan | null} onOpen={() => { flow.clearPlanProblem(); setPlanSheet(true); }} />
            <div className="mx-1 mt-1 flex items-center justify-between text-[15px]">
              <span className="font-semibold">{C.photos}</span>
              <span className="text-[#6b7280]">{photos.length ? C.photosCount(photos.length) : C.none}</span>
            </div>
            <PhotoGrid
              photos={photos}
              testId="dc-send-photos-input"
              onChange={(next) => {
                if (next.length > photos.length) flow.addPhotos(next.slice(photos.length));
                else {
                  const gone = photos.findIndex((p, i) => next[i] !== p);
                  flow.removePhoto(gone === -1 ? photos.length - 1 : gone);
                }
              }}
            />
          </section>
        </>
      ) : null}

      {stage === 'library' ? (
        <LibraryStep
          words={C.picker}
          onPick={(p) => { flow.pickPlan(p); flow.setStage('check'); }}
          onStepChange={onLibraryStep}
          backSignal={libraryBack}
        />
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
            <Dock><Action icon={RotateCcw} onClick={() => { void flow.send(teacherClass); }}>{C.tryAgain}</Action></Dock>
          </>
        ) : flow.failure.kind === 'plan_not_ready' || flow.failure.kind === 'plan_not_found' ? (
          <>
            <Status title={C.planNotUsed} tone="error" />
            <Dock><Action icon={BookOpen} onClick={() => { flow.dropPlan(); setPlanSheet(true); }}>{C.changePlan}</Action></Dock>
          </>
        ) : (
          <>
            <Status title={C.notAccepted} tone="error" />
            <Dock><Action icon={RotateCcw} onClick={() => flow.setStage('check')}>{C.tryAgain}</Action></Dock>
          </>
        )
      ) : null}

      {stage === 'busy' ? (
        <>
          <Status title={C.busy}>{audio?.recordingId ? <span className="text-[14px] text-[#2f7a52]">{C.savedOnPhone}</span> : null}</Status>
          <Dock>
            {flow.failure?.coachingSessionId ? <Action to={lessonPath(flow.failure.coachingSessionId)}>{C.openThat}</Action> : null}
            <Action tone="outline" to={COACHING_HOME}>{C.title}</Action>
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

      <PlanSheet
        words={C.picker}
        open={planSheet}
        onClose={() => setPlanSheet(false)}
        onPick={(p) => { flow.pickPlan(p); setPlanSheet(false); }}
        onLibrary={() => { setPlanSheet(false); setLibrary({ level: 0, crumb: [] }); flow.setStage('library'); }}
        onFile={flow.choosePlanFile}
        problem={flow.planProblem}
      />
    </TeacherPage>
  );
}
