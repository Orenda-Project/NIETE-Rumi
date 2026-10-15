import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Check, Mic, Pause, Square, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clockText } from '../../lib/clockText';
import { acceptFor, checkFile, DC_MAX_PHOTOS, readAudioDuration } from '../../lib/coachingUpload';
import { SendError, sendLesson } from '../../lib/coachingSend';
import { loadGradeSubjects, type GradeSubject } from '../../lib/gradeSubjects';
import { lessonFilename, useMicLevel } from '../../lib/recordFlow';
import { useRecordingClock, useRecordingSession } from '../../lib/recordingSession';
import { deleteRecording } from '../../lib/recordingStore';
import { isInAppBrowser } from '@/lib/runtime';
import { getRecentPlans, planChips, pickOf } from '../../newui/coaching/coachingApi';
import { LevelBars } from '../../newui/coaching/LevelBars';
import { PlanSheet } from '../../newui/coaching/PlanSheet';
import type { Audio } from '../../newui/coaching/useSendFlow';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { portal } from '../../services/api';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { ClassPicker, ConfirmTray, HistoryRow, LeaveNote, ProgressSteps, RecordUploadPair, type SubjectsByGrade } from '../ui';
import { CARD, LIST_CARD } from '../ui/styles';
import { useCopy } from '../i18n';
import { NOTICES } from '../notices/copy';
import { COACHING } from './copy';
import { clearDraft, holdDraft, peekDraft, planKeyOf, readPrefill, type DraftClass, type DraftPlan } from './draft';
import { micBlockedLine, micPermissionDenied } from './micBlocked';
import { Action, Dock, FlowStep, PhotoGrid, PlanPicker, RecordingCard } from './parts';
import { COACHING_HOME, COACHING_NEW, lessonPath } from './paths';
import { dcSteps } from './report';
import { Reflection } from './reportLive';
import { useDcReport } from './useDcReport';

/**
 * Digital Coaching's one screen (design v6): Start DC observation on the main page opens it, and she never leaves it.
 * Each step opens once the one before is done:
 *
 *   1 Grade and subject   the kit's ClassPicker, as Lesson Plans and Assessment have it (every grade, the Lesson Plans
 *                         catalogue, hers starred), in the grade colours. Sent with the lesson as teacherClass.
 *   2 Recording           Start recording records HERE (clock, level, Pause, Stop and "Yes, finish"); the recording bar's
 *                         Return comes back here. Or Upload recording. Then Listen / Redo / Change file.
 *   3 Lesson plan         optional: her recent plans for this class in one tap, or the plan sheet (photo, library).
 *   4 Photos              up to ten, No faces.
 *   Submit                sends exactly that, with the class; then, on the same screen, the lesson's progress
 *                         (Analysing → Reflection question → Report ready), the question answered here, the leave note
 *                         and Back to Digital Coaching. The main page lists it under Analysing until it is ready.
 *
 * What she has chosen is held in memory (draft.ts) so a trip to the library or her lesson plan, and Back, finds it.
 * Opened from a lesson plan (?grade&subject&plan) the class and the plan arrive filled in.
 */

type AudioProblem = 'too_large' | 'not_audio' | null;
type RecPhase = 'idle' | 'starting' | 'recording' | 'micBlocked';
type Sending = { pct: number } | null;

const NO_SUBJECTS: SubjectsByGrade = {};
const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const minutesOf = (ms: number | null) => (ms != null ? Math.max(1, Math.round(ms / 60_000)) : null);

export function NewObservationPage() {
  const C = useCopy(COACHING);
  // The app's one leave line (Assessment's and Lesson Plans' waiting pages say the same).
  const { leave } = useCopy(NOTICES);
  const location = useLocation();
  const navigate = useNavigate();
  const session = useRecordingSession();
  const prefill = useMemo(() => readPrefill(location.search), [location.search]);

  const [combos] = useLoad(() => loadGradeSubjects('lessons'), 'gs:lessons');
  const [cat] = useLoad(() => lessonPlans.catalogue(), 'lp:catalogue');
  const [recentPlans] = useLoad(() => getRecentPlans(20), 'dc:recent-plans');
  const catalogue = dataOf(cat);
  const byGrade = useMemo<SubjectsByGrade>(() => (catalogue
    ? Object.fromEntries(Object.entries(catalogue.byGrade).map(([g, list]) => [g, list.map((s) => s.name)]))
    : NO_SUBJECTS), [catalogue]);
  const mine = useMemo(
    () => (dataOf(combos) ?? []).filter((c): c is GradeSubject & { grade: number } => c.grade != null),
    [combos],
  );

  // Coming back (Back, the recording bar's Return, a trip to the library) finds what she chose; else it starts empty.
  const cameBack = useNavigationType() === 'POP' || !!(location.state as { keep?: boolean } | null)?.keep || !!session?.active;
  const [kept] = useState(() => (cameBack ? peekDraft() : null));
  const [cls, setCls] = useState<DraftClass | null>(kept?.cls ?? null);
  const [audio, setAudio] = useState<Audio | null>(kept?.audio ?? null);
  const [audioProblem, setAudioProblem] = useState<AudioProblem>(null);
  const [plan, setPlan] = useState<DraftPlan | null>(kept?.plan ?? null);
  const [planProblem, setPlanProblem] = useState<'not_a_plan' | null>(null);
  const [planSheet, setPlanSheet] = useState(() => !!(location.state as { openPlan?: boolean } | null)?.openPlan);
  const [photos, setPhotos] = useState<File[]>(kept?.photos ?? []);
  const audioInput = useRef<HTMLInputElement>(null);

  useEffect(() => { holdDraft({ audio, plan, photos, cls }); }, [audio, plan, photos, cls]);

  // Opened from a lesson plan: her class (named from her classes) and that plan (named from her recent plans).
  const prefilled = useRef(!!kept);
  useEffect(() => {
    if (prefilled.current || (!prefill.pick && prefill.grade == null)) return;
    if (combos.status === 'loading' || combos.status === 'idle' || recentPlans.status === 'loading' || recentPlans.status === 'idle') return;
    prefilled.current = true;
    if (prefill.grade != null && prefill.subjectKey) {
      const hers = mine.find((c) => c.grade === prefill.grade && norm(c.subjectKey) === norm(prefill.subjectKey));
      if (hers) setCls({ grade: hers.grade, subject: hers.subject, subjectKey: hers.subjectKey ?? null });
    }
    if (prefill.pick) {
      const key = planKeyOf(prefill.pick);
      const known = (dataOf(recentPlans) ?? []).find((p) => p.planKey === key);
      setPlan({
        kind: 'library',
        pick: known ? pickOf(known) : prefill.pick,
        title: known?.title || C.planFallback,
        chips: known ? planChips(known, C.picker) : [],
      });
    }
  }, [prefill, combos, recentPlans, mine, C]);

  // 2 Recording, on this screen. A lesson already recording (the bar's Return) is shown, never a second one.
  const [phase, setPhase] = useState<RecPhase>(() => (session?.active ? 'recording' : 'idle'));
  const elapsed = useRecordingClock(session);
  const level = useMicLevel(session?.stream ?? null, phase === 'recording' && !session?.paused);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [micTries, setMicTries] = useState(0);
  const [browserBlocked, setBrowserBlocked] = useState(false);
  useEffect(() => {
    if (phase !== 'micBlocked') return undefined;
    let live = true;
    void micPermissionDenied().then((d) => { if (live) setBrowserBlocked(d); });
    return () => { live = false; };
  }, [phase, micTries]);
  // Finished somewhere else (Logout's "Stop & log out"): nothing is recording here any more.
  useEffect(() => { if (phase === 'recording' && session && !session.active) setPhase('idle'); }, [phase, session, session?.active]);

  const startRecording = async () => {
    if (!session) return;
    setAudioProblem(null);
    setPhase('starting');
    const result = await session.start({ returnTo: COACHING_NEW });
    setPhase(result === 'recording' ? 'recording' : 'micBlocked');
  };
  const finishRecording = async () => {
    if (!session) return;
    const out = await session.finish();
    setPhase('idle');
    if (!out) return;
    setAudio({
      blob: out.blob, filename: lessonFilename(out.type.ext), durationMs: out.durationMs,
      recordingId: out.id, source: 'recorded', size: out.blob.size, startedAt: null,
    });
  };
  const pickAudio = async (file: File | undefined) => {
    setAudioProblem(null);
    if (!file) return;
    const problem = checkFile(file, 'audio');
    if (problem) { setAudioProblem(problem === 'too_large' ? 'too_large' : 'not_audio'); return; }
    const seconds = await readAudioDuration(file);
    setPhase('idle');
    setAudio({
      blob: file, filename: file.name, durationMs: seconds != null ? seconds * 1000 : null,
      recordingId: null, source: 'file', size: file.size, startedAt: null,
    });
  };
  const redo = async () => {
    const id = audio?.recordingId;
    if (id) { try { await deleteRecording(id); } catch { /* gone */ } }
    setAudio(null);
    setAudioProblem(null);
  };

  // 3 Lesson plan: her recent plans for THIS class, one tap each.
  const forClass = useMemo(() => (cls
    ? (dataOf(recentPlans) ?? []).filter((p) => p.grade === cls.grade && norm(p.subject) === norm(cls.subject)).slice(0, 3)
    : []), [recentPlans, cls]);

  // Submit, and what came of it — on this screen.
  const [sending, setSending] = useState<Sending>(null);
  const [failure, setFailure] = useState<SendError | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const report = useDcReport(sessionId);
  const submit = async () => {
    if (!audio || !cls) return;
    setFailure(null);
    setSending({ pct: 0 });
    try {
      const { coachingSessionId } = await sendLesson({
        audio: { blob: audio.blob, filename: audio.filename },
        plan: plan ? (plan.kind === 'library' ? { kind: 'library', pick: plan.pick } : { kind: 'file', file: plan.file }) : null,
        photos,
        teacherClass: { grade: cls.grade, subject: cls.subject, ...(cls.subjectKey ? { subjectKey: cls.subjectKey } : {}) },
      }, portal, (pct) => setSending({ pct }));
      if (audio.recordingId) { try { await deleteRecording(audio.recordingId); } catch { /* gone */ } }
      clearDraft();
      setSessionId(coachingSessionId);
    } catch (err) {
      setFailure(err instanceof SendError ? err : new SendError('network'));
    } finally {
      setSending(null);
    }
  };

  const ready = !!cls && !!audio;
  const after = !!sessionId;
  const s1 = cls ? 'done' : 'now';
  const s2 = !cls ? 'upcoming' : audio ? 'done' : 'now';
  const s3 = !ready ? 'upcoming' : plan ? 'done' : 'now';
  const s4 = !ready ? 'upcoming' : photos.length ? 'done' : 'now';
  const micLine = micBlockedLine({ browserBlocked, retried: micTries > 0, inApp: isInAppBrowser() }, C);
  const progress = report.state.progress;

  const dock = after || sending
    ? undefined
    : phase === 'recording'
      ? (
        <Dock>
          <Action tone="outline" icon={session?.paused ? Mic : Pause} onClick={() => { if (session?.paused) session.resume(); else session?.pause(); }}>
            {session?.paused ? C.resume : C.pause}
          </Action>
          <Action tone="danger" icon={Square} onClick={() => setConfirmFinish(true)}>{C.stop}</Action>
        </Dock>
      )
      : ready ? <Dock><Action onClick={() => { void submit(); }}>{C.submit}</Action></Dock> : undefined;

  return (
    <TeacherPage
      feature="coaching"
      title={after ? C.dcObservation : C.startObservation}
      crumb={C.title}
      backTo={COACHING_HOME}
      testId="dc-new"
      dock={dock}
    >
      <input
        ref={audioInput}
        hidden
        type="file"
        data-testid="dc-audio-input"
        accept={acceptFor('audio')}
        onChange={(e) => { void pickAudio(e.target.files?.[0]); e.target.value = ''; }}
      />

      {!after ? (
        <>
          <FlowStep n={1} state={s1}>{C.gradeAndSubject}</FlowStep>
          <ClassPicker
            label={C.gradeAndSubject}
            combos={mine}
            subjectsByGrade={byGrade}
            value={cls ? { grade: cls.grade, subject: cls.subject } : null}
            onChange={(v, pick) => {
              const key = pick.combo && typeof pick.combo.subjectKey === 'string' ? pick.combo.subjectKey : null;
              setCls({ grade: v.grade, subject: v.subject, subjectKey: key });
              setPlan((p) => (p && p.kind === 'library' && cls && (cls.grade !== v.grade || cls.subject !== v.subject) ? null : p));
            }}
            gradeColours
          />

          <FlowStep n={2} state={s2}>{C.recording}</FlowStep>
          {cls && !audio && phase === 'recording' ? (
            <section aria-label={C.recording} className={cn(CARD, 'flex flex-col items-center gap-4 border-2 border-[#c8331f] px-4 py-5')}>
              <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold', session?.paused ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#fee4e2] text-[#c8331f]')}>
                {session?.paused ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <i aria-hidden="true" className="h-2 w-2 rounded-full bg-[#c8331f] motion-safe:animate-pulse" />}
                {session?.paused ? C.paused : C.recording}
              </span>
              <span role="timer" data-testid="dc-record-clock" className="text-[48px] font-light leading-none tracking-[-0.02em] tabular-nums">{clockText(elapsed)}</span>
              <LevelBars live={!session?.paused} level={level} />
              <span className="text-[13px] font-medium text-[#6b7280]">{C.keepAppOpen}</span>
            </section>
          ) : null}
          {cls && !audio && phase === 'starting' ? (
            <p aria-live="polite" className="mx-1 text-[15px] font-semibold text-[#6b7280]">{C.starting}</p>
          ) : null}
          {cls && !audio && phase === 'micBlocked' ? (
            <section className={cn(CARD, 'flex flex-col gap-3 p-4')}>
              <span className="text-[17px] font-semibold text-[#c8331f]">{C.micBlocked}</span>
              <p className="m-0 text-[15px] leading-[1.5] text-[#4b5563]">{micLine}</p>
              <Dock>
                <Action onClick={() => { setMicTries((n) => n + 1); void startRecording(); }}>{C.tryAgain}</Action>
                <Action tone="outline" icon={Upload} onClick={() => audioInput.current?.click()}>{C.uploadRecording}</Action>
              </Dock>
            </section>
          ) : null}
          {cls && !audio && phase === 'idle' ? (
            <RecordUploadPair
              onRecord={() => { void startRecording(); }}
              onUpload={() => audioInput.current?.click()}
              copy={{ startRecording: C.recordTitle, uploadRecording: C.uploadRecording }}
            />
          ) : null}
          {audio && cls ? (
            <RecordingCard audio={audio} onRedo={() => { void redo(); }} onChangeFile={() => audioInput.current?.click()} />
          ) : null}
          {audioProblem ? (
            <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{audioProblem === 'too_large' ? C.tooLarge : C.notAudio}</p>
          ) : null}

          <FlowStep n={3} state={s3} chips={[C.optional]}>{C.lessonPlan}</FlowStep>
          {ready ? (
            <>
              {!plan && forClass.length ? (
                <div className={LIST_CARD}>
                  {forClass.map((p, i) => (
                    <button
                      key={p.planKey}
                      type="button"
                      aria-label={p.title || C.planFallback}
                      className="block w-full text-start"
                      onClick={() => setPlan({ kind: 'library', pick: pickOf(p), title: p.title || C.planFallback, chips: planChips(p, C.picker) })}
                    >
                      <HistoryRow
                        subject={p.subject ?? cls?.subject ?? ''}
                        grade={p.grade ?? cls?.grade ?? null}
                        title={p.title || C.planFallback}
                        extra={[p.chapterTitle, p.dayLabel].filter(Boolean).join(' · ') || undefined}
                        action="none"
                        first={i === 0}
                      />
                    </button>
                  ))}
                </div>
              ) : null}
              <PlanPicker plan={plan} onOpen={() => { setPlanProblem(null); setPlanSheet(true); }} />
            </>
          ) : null}

          <FlowStep n={4} state={s4} chips={[C.upToPhotos(DC_MAX_PHOTOS), C.noFaces]}>{C.photos}</FlowStep>
          {ready ? (
            <>
              <p className="mx-1 -mt-1 whitespace-pre-line text-[14px] text-[#6b7280]">{C.photosHint}</p>
              <PhotoGrid photos={photos} onChange={setPhotos} testId="dc-photos-input" max={DC_MAX_PHOTOS} />
            </>
          ) : null}

          {sending ? (
            <section aria-live="polite" className={cn(CARD, 'flex flex-col items-center gap-2 px-4 py-6 text-center')}>
              <span className="text-[18px] font-semibold">{C.sending}</span>
              <span className="text-[44px] font-light tabular-nums">{`${sending.pct}%`}</span>
              <span className="text-[13px] font-medium text-[#6b7280]">{C.keepAppOpen}</span>
            </section>
          ) : null}
          {failure ? (
            <section role="alert" className={cn(CARD, 'flex flex-col gap-3 p-4')}>
              <span className="text-[17px] font-semibold text-[#c8331f]">
                {failure.kind === 'network' ? C.noInternet
                  : failure.kind === 'in_progress' ? C.busy
                    : failure.kind === 'plan_not_ready' || failure.kind === 'plan_not_found' ? C.planNotUsed
                      : C.notAccepted}
              </span>
              {failure.kind === 'in_progress' && failure.coachingSessionId ? (
                <Action to={lessonPath(failure.coachingSessionId)}>{C.openThat}</Action>
              ) : failure.kind === 'plan_not_ready' || failure.kind === 'plan_not_found' ? (
                <Action onClick={() => { setPlan(null); setFailure(null); setPlanSheet(true); }}>{C.changePlan}</Action>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <>
          {cls ? (
            <section aria-label={C.sent} className={LIST_CARD}>
              <HistoryRow
                subject={cls.subject}
                grade={cls.grade}
                title={`${C.grade(cls.grade)} · ${cls.subject}`}
                extra={[audio?.durationMs != null ? C.minutes(minutesOf(audio.durationMs) as number) : null, photos.length ? C.photosCount(photos.length) : null].filter(Boolean).join(' · ') || undefined}
                chip={{ text: C.sent, tone: 'done' }}
                action="none"
              />
            </section>
          ) : null}
          {progress?.stage === 'stopped' ? (
            <section aria-live="polite" className={cn(CARD, 'px-4 py-5 text-center text-[16px] font-semibold text-[#c8331f]')}>{C.stopped}</section>
          ) : (
            <ProgressSteps
              heading={C.progress}
              steps={dcSteps(progress?.stage ?? 'queued', !!report.sent, C)}
              done={report.ready}
              doneLabel={C.reportReady}
            />
          )}
          <Reflection r={report} />
          {report.ready && sessionId ? <Action to={lessonPath(sessionId)} icon={Check}>{C.openLesson}</Action> : <LeaveNote text={leave} />}
          <Action tone="outline" to={COACHING_HOME}>{C.backToCoaching}</Action>
        </>
      )}

      <ConfirmTray
        open={confirmFinish}
        title={C.finishTitle}
        onClose={() => setConfirmFinish(false)}
        chips={[{ text: C.minutes(minutesOf(session?.elapsedMs() || elapsed) as number) }]}
        confirmLabel={C.yesFinish}
        confirmIcon={Check}
        onConfirm={() => { setConfirmFinish(false); void finishRecording(); }}
        cancelLabel={C.keepRecording}
      />
      <PlanSheet
        words={C.picker}
        open={planSheet}
        onClose={() => setPlanSheet(false)}
        onPick={(p) => { setPlan({ kind: 'library', ...p }); setPlanSheet(false); }}
        onLibrary={() => { setPlanSheet(false); holdDraft({ audio, plan, photos, cls }); navigate(teacherPath('lessons')); }}
        onFile={(file, asPhoto) => {
          setPlanProblem(null);
          if (!file) return false;
          if (checkFile(file, 'lesson_plan')) { setPlanProblem('not_a_plan'); return false; }
          setPlan({ kind: 'file', file, asPhoto });
          return true;
        }}
        problem={planProblem}
      />
    </TeacherPage>
  );
}
