import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  AudioLines, BookOpen, Camera, Check, CircleAlert, FileAudio, FileText, FileWarning, Hourglass, Image as ImageIcon,
  Loader2, Lock, MessageCircle, Mic, MicOff, Pause, Play, RotateCcw, Send, Settings, Smartphone, Square, TriangleAlert,
  Upload, WifiOff, X,
} from 'lucide-react';
import PortalLayout from '../../components/PortalLayout';
import { acceptFor, formatSize, MAX_PHOTOS, SHORT_RECORDING_SECONDS } from '../../lib/coachingUpload';
import { useRecordingClock, useRecordingSession, type RecordingSession } from '../../lib/recordingSession';
import { clockText } from '../../lib/clockText';
import { hasHistoryBehind, useMicLevel } from '../../lib/recordFlow';
import { COACHING_COPY } from '../copy';
import { InnerBar } from '../InnerBar';
import { List, Row, SectionLabel } from '../List';
import { Chip } from '../Chip';
import { BottomActions, BottomButton } from '../BottomButton';
import { Sheet } from '../Sheet';
import { Hero } from '../Hero';
import { pkDayMonth } from '../range';
import { LevelBars } from './LevelBars';
import { LibraryStep, type LibraryStepInfo } from './LibraryStep';
import { PlanSheet } from './PlanSheet';
import { useSendFlow, type Audio, type Plan } from './useSendFlow';

/**
 * bd-5rz1v.26 — /portal/coaching/new in the new UI: record, then check and send. Picked by
 * pages/PortalCoachingRecord (portal_new_ui + self-observation, a teacher); the behaviour is
 * useSendFlow's, which is today's page's. Every screen is an inner page under Coaching.
 *
 *   recording   the Recording chip (red dot; the one place red means recording) or Paused
 *               (amber), a big clock, the sound bars, "Keep app open"; a Lesson plans row with
 *               "Recording continues" (the recording outlives this page, bd-5rz1v.10); Finish
 *               (green, asks first) and Pause / Continue (outline)
 *   refused     Microphone blocked, where to allow it as a path, Try again, Upload recording
 *   check       her recording (listen, record again / change file); Optional: a lesson plan
 *               (PlanSheet: recent, library, photo, file) and up to 3 board photos; Send
 *   library     LibraryStep, one step a page; Back steps up
 *   sending     a ring with the percentage and no menu: one stray tap must not take her away
 *   after       Sent, No internet, Lesson plan not used, Not accepted, Another lesson analysing
 */

function useSession(): RecordingSession {
  const session = useRecordingSession();
  if (!session) throw new Error('RecordPage needs a RecordingSessionProvider above it');
  return session;
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** The column: under the bar on a desktop, at a readable width. */
function Column({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1120px] px-[14px] pb-[14px] md:px-10">
      <div className="flex w-full flex-col gap-3 md:max-w-[640px]">{children}</div>
    </div>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return <div className="flex justify-center"><Chip tone="error" icon={CircleAlert}>{children}</Chip></div>;
}

export default function RecordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const flow = useSendFlow(session);
  const { stage, audio, plan, photos } = flow;
  const elapsed = useRecordingClock(session);
  const level = useMicLevel(session.stream, stage === 'recording' && !session.paused);
  // Opened from inside the app (not a fresh load): Back while recording goes back, not to Coaching.
  const cameFromApp = useRef(location.key !== 'default');

  const [confirmFinish, setConfirmFinish] = useState(false);
  const [planSheet, setPlanSheet] = useState(false);
  const [library, setLibrary] = useState<LibraryStepInfo>({ level: 0, crumb: [] });
  const [libraryBack, setLibraryBack] = useState(0);
  const audioInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
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
    // bd-5rz1v.10 — while recording, Back simply goes back: the lesson carries on and the bar on
    // the next page leads here again.
    if (stage === 'recording' && (hasHistoryBehind() || cameFromApp.current)) { navigate(-1); return; }
    navigate('/portal/coaching');
  };

  const steps = COACHING_COPY.steps;
  const title = stage === 'library' ? [steps.grade, steps.subject, steps.chapter, steps.lesson][library.level]
    : stage === 'check' ? COACHING_COPY.checkTitle
      : stage === 'failed' || stage === 'busy' || stage === 'sent' ? COACHING_COPY.send
        : COACHING_COPY.recordTitle;
  const crumb = [COACHING_COPY.title, ...(stage === 'library' ? library.crumb : [])].join(' · ');
  const elapsedNow = session.elapsedMs() || elapsed;

  return (
    <PortalLayout ownHeading bare={stage === 'sending'}>
      {stage !== 'sending' ? <InnerBar feature="coaching" crumb={crumb} title={title} onBack={back} /> : null}

      {/* The one place a recording file is picked here: Upload recording (microphone refused)
          and Change file. Opened from the tap. */}
      <input
        ref={audioInput}
        hidden
        type="file"
        data-testid="audio-input"
        accept={`${acceptFor('audio')},audio/*`}
        onChange={(e) => { void flow.chooseAudio(e.target.files?.[0]); e.target.value = ''; }}
      />

      <Column>
        {stage === 'starting' ? <Hero title={COACHING_COPY.loading} icon={Loader2} spinning live /> : null}

        {stage === 'micBlocked' ? (
          <>
            <Hero title={COACHING_COPY.micBlocked} icon={MicOff} tone="error" live />
            <List label={COACHING_COPY.micBlocked}>
              {(Capacitor.isNativePlatform() ? COACHING_COPY.micApp : COACHING_COPY.micWeb).map((step, i) => (
                <Row key={step} title={step} icon={i > 0 ? Mic : Capacitor.isNativePlatform() ? Settings : Lock} />
              ))}
            </List>
            {flow.fileProblem ? <Problem>{flow.fileProblem === 'too_large' ? COACHING_COPY.tooLarge : COACHING_COPY.notAudio}</Problem> : null}
            <BottomActions>
              <BottomButton icon={RotateCcw} onClick={() => { void flow.startRecording(); }}>{COACHING_COPY.tryAgain}</BottomButton>
              <BottomButton tone="outline" icon={Upload} onClick={pickAudio}>{COACHING_COPY.upload}</BottomButton>
            </BottomActions>
          </>
        ) : null}

        {stage === 'recording' ? (
          <>
            <section className="flex flex-col items-center gap-3 rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card px-4 pb-5 pt-5">
              {session.paused
                ? <Chip tone="waiting" icon={Pause}>{COACHING_COPY.paused}</Chip>
                : <Chip tone="recording">{COACHING_COPY.recording}</Chip>}
              <div data-testid="record-clock" aria-live="off" className="text-[64px] font-extrabold leading-none tabular-nums text-nu-surface-text">
                {clockText(elapsed)}
              </div>
              <LevelBars live={!session.paused} level={level} />
              <div className="flex flex-wrap justify-center gap-1.5">
                {session.screenWentOff ? <Chip tone="waiting" icon={TriangleAlert}>{COACHING_COPY.screenWentOff}</Chip> : null}
                <Chip icon={Smartphone}>{COACHING_COPY.keepAppOpen}</Chip>
              </div>
            </section>
            <List>
              <Row
                title={COACHING_COPY.lessonPlans}
                icon={BookOpen}
                to="/portal/curriculum"
                chips={<Chip tone="recording">{COACHING_COPY.continues}</Chip>}
                testId="record-lesson-plans"
              />
            </List>
            <BottomActions>
              <BottomButton icon={Square} onClick={() => setConfirmFinish(true)}>{COACHING_COPY.finish}</BottomButton>
              <BottomButton tone="outline" icon={session.paused ? Mic : Pause} onClick={flow.togglePause}>
                {session.paused ? COACHING_COPY.resume : COACHING_COPY.pause}
              </BottomButton>
            </BottomActions>
          </>
        ) : null}

        {stage === 'check' && audio ? (
          <>
            <List label={COACHING_COPY.yourRecording}>
              <Row
                title={audio.source === 'file' ? audio.filename : COACHING_COPY.yourRecording}
                icon={AudioLines}
                tile="done"
                chips={<RecordingChips audio={audio} />}
                testId="check-recording"
              />
              {audioUrl ? (
                <Row title={playing ? COACHING_COPY.stopListening : COACHING_COPY.listen} icon={playing ? Pause : Play} onClick={togglePlay} />
              ) : null}
              <Row
                title={audio.recordingId ? COACHING_COPY.recordAgain : COACHING_COPY.changeFile}
                icon={audio.recordingId ? RotateCcw : FileAudio}
                onClick={() => { setPlaying(false); void flow.redo(pickAudio); }}
              />
            </List>
            {audioUrl ? (
              <audio ref={player} src={audioUrl} preload="metadata" onEnded={() => setPlaying(false)} className="hidden" />
            ) : null}
            {flow.fileProblem ? <Problem>{flow.fileProblem === 'too_large' ? COACHING_COPY.tooLarge : COACHING_COPY.notAudio}</Problem> : null}

            <SectionLabel>{COACHING_COPY.optional}</SectionLabel>
            <List>
              <PlanRow plan={plan} onClick={() => { flow.clearPlanProblem(); setPlanSheet(true); }} />
              <Row
                title={COACHING_COPY.boardPhotos}
                icon={Camera}
                value={COACHING_COPY.photosOf(photos.length, MAX_PHOTOS)}
                onClick={() => photosInput.current?.click()}
                state={photos.length >= MAX_PHOTOS ? 'off' : undefined}
                testId="check-photos"
              />
              {photos.map((p, i) => (
                <Row
                  key={`${p.name}-${i}`}
                  title={p.name}
                  icon={ImageIcon}
                  tile="quiet"
                  end={X}
                  onClick={() => flow.removePhoto(i)}
                  ariaLabel={COACHING_COPY.removePhoto(p.name)}
                />
              ))}
            </List>
            <input
              ref={photosInput}
              hidden
              type="file"
              multiple
              data-testid="photos-input"
              accept={`${acceptFor('photo')},image/jpeg,image/png`}
              onChange={(e) => { flow.addPhotos(e.target.files); e.target.value = ''; }}
            />
            {flow.photosProblem ? <Problem>{flow.photosProblem === 'too_many' ? COACHING_COPY.upToThree : COACHING_COPY.notAPhoto}</Problem> : null}

            <BottomActions>
              <BottomButton icon={Send} onClick={() => { void flow.send(); }}>{COACHING_COPY.sendToCoach}</BottomButton>
            </BottomActions>
          </>
        ) : null}

        {stage === 'library' ? (
          <LibraryStep
            onPick={(p) => { flow.pickPlan(p); flow.setStage('check'); }}
            onStepChange={setLibrary}
            backSignal={libraryBack}
          />
        ) : null}

        {stage === 'sending' ? (
          <div className="pt-6">
            <Hero
              title={COACHING_COPY.sending}
              ring={{ value: flow.progress / 100, text: `${flow.progress}%` }}
              chips={<Chip icon={Smartphone}>{COACHING_COPY.keepAppOpen}</Chip>}
              live
            />
          </div>
        ) : null}

        {stage === 'failed' && flow.failure ? (
          flow.failure.kind === 'network' ? (
            <>
              <Hero
                title={COACHING_COPY.noInternet}
                icon={WifiOff}
                tone="waiting"
                chips={audio?.recordingId ? <Chip tone="done" icon={Check}>{COACHING_COPY.savedOnPhone}</Chip> : null}
                live
              />
              <BottomActions>
                <BottomButton icon={RotateCcw} onClick={() => { void flow.send(); }}>{COACHING_COPY.tryAgain}</BottomButton>
              </BottomActions>
            </>
          ) : flow.failure.kind === 'plan_not_ready' || flow.failure.kind === 'plan_not_found' ? (
            <>
              <Hero title={COACHING_COPY.planNotUsed} icon={FileWarning} tone="waiting" live />
              <BottomActions>
                <BottomButton icon={BookOpen} onClick={() => { flow.dropPlan(); setPlanSheet(true); }}>{COACHING_COPY.changePlan}</BottomButton>
              </BottomActions>
            </>
          ) : (
            <>
              <Hero title={COACHING_COPY.notAccepted} icon={CircleAlert} tone="error" live />
              <BottomActions>
                <BottomButton icon={RotateCcw} onClick={() => flow.setStage('check')}>{COACHING_COPY.tryAgain}</BottomButton>
              </BottomActions>
            </>
          )
        ) : null}

        {stage === 'busy' ? (
          <>
            <Hero
              title={COACHING_COPY.busy}
              icon={Hourglass}
              tone="waiting"
              chips={audio?.recordingId ? <Chip tone="done" icon={Check}>{COACHING_COPY.savedOnPhone}</Chip> : null}
              live
            />
            <BottomActions>
              {flow.failure?.coachingSessionId ? (
                <BottomButton to={`/portal/coaching/session/${flow.failure.coachingSessionId}`}>{COACHING_COPY.openThat}</BottomButton>
              ) : null}
              <BottomButton tone="outline" to="/portal/coaching">{COACHING_COPY.title}</BottomButton>
            </BottomActions>
          </>
        ) : null}

        {stage === 'sent' && flow.sessionId ? (
          <>
            <Hero
              title={COACHING_COPY.sent}
              icon={Check}
              tone="done"
              chips={(
                <>
                  <Chip icon={Hourglass}>{COACHING_COPY.aboutTen}</Chip>
                  <Chip icon={MessageCircle}>{COACHING_COPY.whatsAppToo}</Chip>
                </>
              )}
              live
            />
            <BottomActions>
              {/* Replace: Back from the lesson goes to Coaching, not to this finished page. */}
              <BottomButton icon={Play} iconFlips onClick={() => navigate(`/portal/coaching/session/${flow.sessionId}`, { replace: true })}>
                {COACHING_COPY.openLesson}
              </BottomButton>
              <BottomButton tone="outline" onClick={() => navigate('/portal/coaching', { replace: true })}>{COACHING_COPY.title}</BottomButton>
            </BottomActions>
          </>
        ) : null}
      </Column>

      <Sheet open={confirmFinish} title={COACHING_COPY.finishTitle} onClose={() => setConfirmFinish(false)} testId="record-finish-sheet">
        <div className="flex flex-wrap justify-center gap-1.5 py-1">
          <Chip>{COACHING_COPY.minutes(minutes(elapsedNow))}</Chip>
          {elapsedNow < SHORT_RECORDING_SECONDS * 1000 ? <Chip tone="waiting" icon={TriangleAlert}>{COACHING_COPY.shortLesson}</Chip> : null}
        </div>
        <BottomButton icon={Check} onClick={() => { setConfirmFinish(false); void flow.finishRecording(); }}>{COACHING_COPY.yesFinish}</BottomButton>
        <BottomButton tone="outline" onClick={() => setConfirmFinish(false)}>{COACHING_COPY.keepRecording}</BottomButton>
      </Sheet>

      <PlanSheet
        open={planSheet}
        onClose={() => setPlanSheet(false)}
        onPick={(p) => { flow.pickPlan(p); setPlanSheet(false); }}
        onLibrary={() => { setPlanSheet(false); setLibrary({ level: 0, crumb: [] }); flow.setStage('library'); }}
        onFile={flow.choosePlanFile}
        problem={flow.planProblem}
      />
    </PortalLayout>
  );
}

/** Minutes, then when or how big, then "Short lesson" for one under 10 minutes. */
function RecordingChips({ audio }: { audio: Audio }) {
  const day = audio.startedAt ? pkDayMonth(audio.startedAt) : null;
  const short = audio.durationMs != null && audio.durationMs < SHORT_RECORDING_SECONDS * 1000;
  return (
    <>
      {audio.durationMs != null ? <Chip>{COACHING_COPY.minutes(minutes(audio.durationMs))}</Chip> : null}
      {audio.source === 'recorded' ? <Chip>{COACHING_COPY.justNow}</Chip> : null}
      {audio.source === 'resumed' && day ? <Chip>{`${day.day} ${day.month}`}</Chip> : null}
      {audio.source === 'file' ? <Chip>{formatSize(audio.size)}</Chip> : null}
      {short ? <Chip tone="waiting" icon={TriangleAlert}>{COACHING_COPY.shortLesson}</Chip> : null}
    </>
  );
}

/** The lesson plan row: "Lesson plan · Add", or what she chose (green tile) — tap to change. */
function PlanRow({ plan, onClick }: { plan: Plan | null; onClick: () => void }) {
  if (!plan) {
    return <Row title={COACHING_COPY.lessonPlan} icon={BookOpen} value={COACHING_COPY.add} valueMuted onClick={onClick} testId="check-plan" />;
  }
  if (plan.kind === 'library') {
    return (
      <Row
        title={plan.title}
        icon={BookOpen}
        tile="done"
        chips={plan.chips.map((c) => <Chip key={c}>{c}</Chip>)}
        onClick={onClick}
        testId="check-plan"
      />
    );
  }
  return (
    <Row
      title={plan.asPhoto ? COACHING_COPY.lessonPlan : plan.file.name}
      icon={plan.asPhoto ? Camera : FileText}
      tile="done"
      chips={<Chip>{plan.asPhoto ? COACHING_COPY.photo : COACHING_COPY.file}</Chip>}
      onClick={onClick}
      testId="check-plan"
    />
  );
}
