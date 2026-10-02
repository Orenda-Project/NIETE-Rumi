import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  AlertTriangle, BookOpen, Camera, Check, ChevronLeft, Clock, FileText, Loader2, MessageCircle, Mic, MicOff,
  Pause, Play, Smartphone, Upload, WifiOff, X,
} from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import RecordIcon from '../components/coaching/RecordIcon';
import BottomSheet from '../components/coaching/BottomSheet';
import SoundBars from '../components/coaching/SoundBars';
import LibraryPicker, { type PickedPlan } from '../components/coaching/LibraryPicker';
import { portal } from '../services/api';
import { acceptFor, checkFile, formatSize, MAX_PHOTOS, readAudioDuration, SHORT_RECORDING_SECONDS } from '../lib/coachingUpload';
import { canRecordHere, pickRecordingType } from '../lib/recordingSupport';
import { keepScreenOn } from '../lib/keepAwake';
import { LessonRecorder } from '../lib/lessonRecorder';
import { deleteRecording, latestUnsent, type StoredRecording } from '../lib/recordingStore';
import { withDuration } from '../lib/webmDuration';
import { sendLesson, SendError, type LibraryPick } from '../lib/coachingSend';

/**
 * bd-5rz1v — "Record your class". Reached from the big button on Coaching.
 *
 * Built for a teacher who is not confident with phones: one big choice per
 * screen, few words, nothing that can end a lesson by accident.
 *
 *   choose     Record now (only where the microphone can work) | Choose a recording
 *   recording  big clock, sound bars, Pause, Finish — Finish asks first
 *   check      listen, redo, lesson plan (library | photo | file), board photos
 *   sending    progress; the recording stays on the phone until it has arrived
 *   sent       Open this lesson
 *
 * The analysis is the same pipeline as WhatsApp (bd-lfzoz): the files go straight
 * to R2, the bot starts the session, and progress + the report still reach her
 * WhatsApp. English-only, like every portal page; her reflective question is
 * generated in her own language.
 */

const COPY = {
  title: 'Record your class',
  checkTitle: 'Check and send',
  libraryTitle: 'Choose a lesson plan',
  notAvailable: "Recording a lesson from the portal isn't available on your account yet. You can still send a recording to the WhatsApp bot.",
  recordNow: 'Record now',
  recordNowSub: 'Start when your class starts.',
  or: 'or',
  chooseFile: 'Choose a recording',
  chooseFileSub: 'One you already made on this phone.',
  tip: 'Record the whole lesson. 30 to 40 minutes is best.',
  notAudio: 'That is not a recording. Choose a sound file from your phone.',
  tooLarge: 'That recording is too large to send.',
  unsentTitle: 'You have a recording that was not sent',
  sendIt: 'Send it',
  delete: 'Delete',
  micBlocked: "We can't use the microphone",
  micAllow: 'When your phone asks, tap Allow.',
  micHelpApp: 'If you tapped Block before: open phone Settings → Apps → NIETE → Permissions → Microphone → Allow.',
  micHelpWeb: 'If you tapped Block before: tap the lock next to the web address, then allow the microphone.',
  tryAgain: 'Try again',
  chooseInstead: 'Choose a recording instead',
  recording: 'Recording',
  paused: 'Paused',
  minutesWord: 'minutes',
  hearing: 'We can hear your class.',
  pausedNote: 'Recording is paused.',
  keepOpen: 'Keep this screen open. Put the phone face up, near you.',
  screenWentOff: 'The screen went off for a while. Part of the lesson may be silent. Keep this screen open.',
  finish: 'Finish',
  pause: 'Pause',
  resume: 'Continue',
  finishQ: 'Finish recording?',
  youRecorded: (m: string) => `You recorded ${m}.`,
  thatIsShort: 'That is short. Tips work best on a whole lesson.',
  yesFinish: 'Yes, finish',
  keepRecording: 'Keep recording',
  yourRecording: 'Your recording',
  justNow: 'recorded just now',
  listen: 'Listen',
  stopListening: 'Pause',
  recordAgain: 'Delete and record again',
  chooseAnother: 'Choose a different file',
  shortWarning: 'This is under 10 minutes. You can still send it, but the tips may be short.',
  addMore: 'Add more',
  canSkip: '(you can skip this)',
  lessonPlan: 'Lesson plan',
  lessonPlanSub: 'From our library, or a photo of yours.',
  add: '+ Add',
  change: 'Change',
  photosTitle: 'Photos of the board',
  photosSub: `Up to ${MAX_PHOTOS}. No faces.`,
  tooManyPhotos: `You can add up to ${MAX_PHOTOS} photos.`,
  notAPhoto: 'That is not a photo. Choose a JPG or PNG.',
  send: 'Send to Digital Coach',
  addPlanTitle: 'Add your lesson plan',
  fromLibrary: 'From our library',
  fromLibrarySub: 'Pick the lesson you taught.',
  takePhoto: 'Take a photo',
  takePhotoSub: 'Of your own written plan.',
  orFile: 'Or choose a file (PDF or Word)',
  cancel: 'Cancel',
  photoOfPlan: 'Photo of your plan',
  takenNow: 'Taken just now',
  planNotOk: 'That is not a lesson plan file. Choose a PDF, Word file or photo.',
  sending: 'Sending your class…',
  keepOpenSending: 'Keep this screen open until it is done.',
  netTitle: 'The internet stopped',
  netRecorded: "Don't worry. Your recording is safe on this phone.",
  netFile: "Don't worry. Nothing was lost.",
  planProblem: 'That lesson plan could not be used. Pick another, or take a photo of yours.',
  changePlan: 'Change the lesson plan',
  refused: 'Something was not accepted. Please try again.',
  busyTitle: 'A lesson is already being analysed',
  busySub: 'When it is finished you can send this one.',
  busySafe: 'Your recording is safe on this phone.',
  openThat: 'Open that lesson',
  sent: 'Sent!',
  sentSub: 'Your Digital Coach is listening to your class. It takes about 10 minutes.',
  alsoWhatsApp: 'We will also tell you on WhatsApp.',
  openLesson: 'Open this lesson',
  backToCoaching: 'Back to Coaching',
};

type Audio = {
  blob: Blob;
  filename: string;
  durationMs: number | null;
  /** Set when it was recorded here (or recovered): the phone copy to delete once sent. */
  recordingId: string | null;
  label: string;
  sub: string;
};

type Plan =
  | { kind: 'library'; pick: LibraryPick; title: string; sub: string }
  | { kind: 'file'; file: File; title: string; sub: string };

type Stage =
  | 'choose' | 'micBlocked' | 'recording' | 'check' | 'library' | 'sending' | 'failed' | 'busy' | 'sent';

function minutesText(ms: number): string {
  if (ms < 60_000) return 'less than a minute';
  const m = Math.round(ms / 60_000);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

function clockText(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function lessonFilename(ext: string, at = new Date()): string {
  const d = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const t = `${String(at.getHours()).padStart(2, '0')}.${String(at.getMinutes()).padStart(2, '0')}`;
  return `Lesson ${d} ${t}${ext}`;
}

/** A live 0..1 microphone level, or null where Web Audio is unavailable. */
function useMicLevel(stream: MediaStream | null, active: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!stream || !active) return undefined;
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return undefined;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) { const v = (buf[i] - 128) / 128; sum += v * v; }
        setLevel(Math.sqrt(sum / buf.length));
      }, 120);
    } catch {
      setLevel(null);
    }
    return () => {
      if (timer) clearInterval(timer);
      try { void ctx?.close(); } catch { /* closed */ }
    };
  }, [stream, active]);
  return level;
}

const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-[14px] border border-[#e5e7eb] bg-white p-3.5 ${className}`}>{children}</div>
);

const Warning = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-2.5 rounded-xl bg-[#fff6e0] px-3.5 py-3 text-[15px] leading-snug text-[#7a5600]">
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

const PortalCoachingRecord = () => {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const [stage, setStage] = useState<Stage>('choose');
  const [unsent, setUnsent] = useState<{ meta: StoredRecording; blob: Blob } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // recording
  const recorderRef = useRef<LessonRecorder | null>(null);
  const releaseScreen = useRef<(() => Promise<void>) | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [screenWentOff, setScreenWentOff] = useState(false);

  // check
  const [audio, setAudio] = useState<Audio | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planSheet, setPlanSheet] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // library
  const [libraryLevel, setLibraryLevel] = useState(0);
  const [libraryBack, setLibraryBack] = useState(0);

  // send
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<SendError | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const audioInput = useRef<HTMLInputElement>(null);
  const planPhotoInput = useRef<HTMLInputElement>(null);
  const planFileInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);

  const level = useMicLevel(stream, stage === 'recording' && !paused);

  // ── first load: is it on for her, can this device record, anything unsent? ──
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => portal.getConfig())
      .then((cfg) => { if (live) setEnabled(cfg?.features?.selfObservation === true); })
      .catch(() => { if (live) setEnabled(false); });
    canRecordHere().then((ok) => { if (live) setCanRecord(ok); }).catch(() => {});
    latestUnsent().then((u) => { if (live) setUnsent(u); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // The recording's playback url follows the audio and is released with it.
  useEffect(() => {
    if (!audio) { setAudioUrl(null); return undefined; }
    let url: string | null = null;
    try { url = URL.createObjectURL(audio.blob); } catch { url = null; }
    setAudioUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [audio]);

  // The clock, and a guard against leaving while recording.
  useEffect(() => {
    if (stage !== 'recording') return undefined;
    const tick = setInterval(() => setElapsed(recorderRef.current?.elapsedMs() ?? 0), 500);
    setElapsed(recorderRef.current?.elapsedMs() ?? 0);
    const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onHide = () => { if (document.visibilityState === 'hidden') setScreenWentOff(true); };
    window.addEventListener('beforeunload', leave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(tick);
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [stage]);

  // Never leave the microphone or the screen hold on when she leaves the page.
  useEffect(() => () => {
    void releaseScreen.current?.();
    if (recorderRef.current) void recorderRef.current.stop().catch(() => {});
  }, []);

  // ── choose ────────────────────────────────────────────────────────────────
  const startRecording = async () => {
    const type = pickRecordingType();
    if (!type) { setStage('micBlocked'); return; }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        // A classroom, not a call: call-style echo and noise suppression would
        // also suppress children answering from across the room.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      setStage('micBlocked');
      return;
    }
    const rec = new LessonRecorder({ stream: media, type });
    recorderRef.current = rec;
    setStream(media);
    setPaused(false);
    setScreenWentOff(false);
    setElapsed(0);
    try {
      await rec.start();
    } catch {
      setStage('micBlocked');
      return;
    }
    releaseScreen.current = await keepScreenOn();
    setStage('recording');
  };

  const onAudioChosen = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    const problem = checkFile(file, 'audio');
    if (problem) { setFileError(problem === 'too_large' ? COPY.tooLarge : COPY.notAudio); return; }
    const seconds = await readAudioDuration(file);
    const durationMs = seconds != null ? seconds * 1000 : null;
    setAudio({
      blob: file,
      filename: file.name,
      durationMs,
      recordingId: null,
      label: file.name,
      sub: [durationMs != null ? minutesText(durationMs) : null, formatSize(file.size)].filter(Boolean).join(' · '),
    });
    setStage('check');
  };

  const sendUnsent = async () => {
    if (!unsent) return;
    const { meta } = unsent;
    const blob = await withDuration(unsent.blob, meta.ext, meta.elapsedMs);
    setAudio({
      blob,
      filename: lessonFilename(meta.ext, new Date(meta.startedAt)),
      durationMs: meta.elapsedMs || null,
      recordingId: meta.id,
      label: COPY.yourRecording,
      sub: [meta.elapsedMs ? minutesText(meta.elapsedMs) : null,
        new Date(meta.startedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })]
        .filter(Boolean).join(' · '),
    });
    setUnsent(null);
    setStage('check');
  };

  const deleteUnsent = async () => {
    if (!unsent) return;
    try { await deleteRecording(unsent.meta.id); } catch { /* already gone */ }
    setUnsent(null);
  };

  // ── recording ─────────────────────────────────────────────────────────────
  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (paused) { rec.resume(); setPaused(false); } else { rec.pause(); setPaused(true); }
    setElapsed(rec.elapsedMs());
  };

  const finishRecording = async () => {
    const rec = recorderRef.current;
    setConfirmFinish(false);
    if (!rec) return;
    const out = await rec.stop();
    recorderRef.current = null;
    setStream(null);
    void releaseScreen.current?.();
    releaseScreen.current = null;
    setAudio({
      blob: out.blob,
      filename: lessonFilename(out.type.ext),
      durationMs: out.durationMs,
      recordingId: out.id,
      label: COPY.yourRecording,
      sub: `${minutesText(out.durationMs)} · ${COPY.justNow}`,
    });
    setStage('check');
  };

  // ── check ─────────────────────────────────────────────────────────────────
  const redo = async () => {
    const wasRecorded = audio?.recordingId;
    if (wasRecorded) { try { await deleteRecording(wasRecorded); } catch { /* gone */ } }
    setAudio(null);
    setPlaying(false);
    setStage('choose');
    if (!wasRecorded) setTimeout(() => audioInput.current?.click(), 0);
  };

  const togglePlay = () => {
    const el = player.current;
    if (!el) return;
    try {
      if (playing) { el.pause(); setPlaying(false); } else { void el.play()?.catch(() => setPlaying(false)); setPlaying(true); }
    } catch {
      setPlaying(false);
    }
  };

  const onPlanFile = (file: File | undefined, asPhoto: boolean) => {
    setPlanError(null);
    if (!file) return;
    if (checkFile(file, 'lesson_plan')) { setPlanError(COPY.planNotOk); return; }
    setPlan({
      kind: 'file',
      file,
      title: asPhoto ? COPY.photoOfPlan : file.name,
      sub: asPhoto ? COPY.takenNow : `File · ${formatSize(file.size)}`,
    });
    setPlanSheet(false);
  };

  const onPhotos = (list: FileList | null) => {
    setPhotosError(null);
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    if (chosen.some((f) => checkFile(f, 'photo'))) { setPhotosError(COPY.notAPhoto); return; }
    const all = [...photos, ...chosen];
    if (all.length > MAX_PHOTOS) { setPhotosError(COPY.tooManyPhotos); return; }
    setPhotos(all);
  };

  const onLibraryPick = useCallback((p: PickedPlan) => {
    setPlan({ kind: 'library', pick: p.pick, title: p.title, sub: p.sub });
    setStage('check');
  }, []);

  // ── send ──────────────────────────────────────────────────────────────────
  const send = async () => {
    if (!audio) return;
    setFailure(null);
    setProgress(0);
    setStage('sending');
    try {
      const { coachingSessionId } = await sendLesson({
        audio: { blob: audio.blob, filename: audio.filename },
        plan: plan ? (plan.kind === 'library' ? { kind: 'library', pick: plan.pick } : { kind: 'file', file: plan.file }) : null,
        photos,
      }, portal, setProgress);
      if (audio.recordingId) { try { await deleteRecording(audio.recordingId); } catch { /* gone */ } }
      setSessionId(coachingSessionId);
      setStage('sent');
    } catch (err) {
      const e = err instanceof SendError ? err : new SendError('network');
      setFailure(e);
      setStage(e.kind === 'in_progress' ? 'busy' : 'failed');
    }
  };

  // ── header ────────────────────────────────────────────────────────────────
  const recordingNow = stage === 'recording';
  const title = stage === 'library' ? COPY.libraryTitle : stage === 'check' ? COPY.checkTitle : COPY.title;
  const back = () => {
    if (stage === 'library') {
      if (libraryLevel > 0) setLibraryBack((n) => n + 1); else setStage('check');
      return;
    }
    navigate('/portal/coaching');
  };

  if (enabled === null) {
    return <PortalLayout><LoadingState type="full" /></PortalLayout>;
  }

  if (!enabled) {
    return (
      <PortalLayout>
        <div className="mx-auto max-w-md py-10 text-center text-muted-foreground">{COPY.notAvailable}</div>
      </PortalLayout>
    );
  }

  const isShort = audio?.durationMs != null && audio.durationMs < SHORT_RECORDING_SECONDS * 1000;
  const native = Capacitor.isNativePlatform();

  return (
    <PortalLayout bare={recordingNow || stage === 'sending'}>
      <div className="mx-auto flex w-full max-w-md flex-col pb-6">
        <div className="mb-3 flex h-12 items-center gap-1">
          {!recordingNow && stage !== 'sending' && (
            <button type="button" onClick={back} aria-label="Back"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-primary">
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          <h1 className={`text-lg font-bold text-primary ${recordingNow || stage === 'sending' ? 'pl-2' : ''}`}>{title}</h1>
        </div>

        {/* 1. choose */}
        {stage === 'choose' && (
          <div className="flex flex-col gap-4">
            {unsent && (
              <div className="flex flex-col gap-3 rounded-2xl border-2 border-[#f0c36d] bg-[#fff6e0] p-4">
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 h-6 w-6 shrink-0 text-[#7a5600]" aria-hidden="true" />
                  <div className="flex flex-col gap-1">
                    <span className="text-[17px] font-bold text-[#5c4100]">{COPY.unsentTitle}</span>
                    <span className="text-[15px] text-[#7a5600]">
                      {[unsent.meta.elapsedMs ? minutesText(unsent.meta.elapsedMs) : null,
                        new Date(unsent.meta.startedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <button type="button" onClick={sendUnsent} className="h-12 flex-1 rounded-xl bg-primary text-[17px] font-bold text-white">{COPY.sendIt}</button>
                  <button type="button" onClick={deleteUnsent} className="h-12 rounded-xl border-2 border-[#d6d9de] bg-white px-5 text-[16px] font-semibold text-[#5b6170]">{COPY.delete}</button>
                </div>
              </div>
            )}

            {canRecord && (
              <>
                <button type="button" onClick={startRecording}
                  className="flex flex-col items-center gap-3.5 rounded-[20px] border-[3px] border-primary bg-[#e3f4ea] px-5 py-7 text-center text-primary shadow-[0_4px_14px_rgba(51,55,72,0.10)]">
                  <RecordIcon size={104} />
                  <span className="text-2xl font-bold">{COPY.recordNow}</span>
                  <span className="text-base text-[#3a4a42]">{COPY.recordNowSub}</span>
                </button>
                <div className="flex items-center gap-3 text-[15px] text-muted-foreground">
                  <span className="h-px flex-1 bg-[#d6d9de]" /><span>{COPY.or}</span><span className="h-px flex-1 bg-[#d6d9de]" />
                </div>
              </>
            )}

            <button type="button" onClick={() => audioInput.current?.click()}
              className="flex items-center gap-4 rounded-2xl border-2 border-primary bg-white px-5 py-4 text-left text-primary">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-[#eef0f4]">
                <Upload className="h-7 w-7" aria-hidden="true" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-xl font-bold">{COPY.chooseFile}</span>
                <span className="text-[15px] text-[#5b6170]">{COPY.chooseFileSub}</span>
              </span>
            </button>
            <input ref={audioInput} data-testid="audio-input" type="file" accept={`${acceptFor('audio')},audio/*`} className="hidden"
              onChange={(e) => { void onAudioChosen(e.target.files?.[0]); e.target.value = ''; }} />
            {fileError && <Warning>{fileError}</Warning>}

            <div className="flex items-start gap-2.5 rounded-xl bg-white p-3.5 text-[15px] leading-snug text-[#3a3f4b]">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <span>{COPY.tip}</span>
            </div>
          </div>
        )}

        {/* 1b. microphone refused */}
        {stage === 'micBlocked' && (
          <div className="flex flex-col items-center gap-4 px-1 pt-4 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#fdecea]">
              <MicOff className="h-11 w-11 text-[#c62828]" aria-hidden="true" />
            </span>
            <h2 className="text-[23px] font-bold">{COPY.micBlocked}</h2>
            <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{COPY.micAllow}</p>
            <p className="w-full rounded-xl bg-white p-3.5 text-left text-[15px] leading-relaxed text-[#5b6170]">
              {native ? COPY.micHelpApp : COPY.micHelpWeb}
            </p>
            <button type="button" onClick={startRecording} className="h-14 w-full rounded-xl bg-primary text-lg font-bold text-white">{COPY.tryAgain}</button>
            <button type="button" onClick={() => { setStage('choose'); setTimeout(() => audioInput.current?.click(), 0); }}
              className="h-[52px] w-full rounded-xl border-2 border-primary bg-white text-[17px] font-bold text-primary">{COPY.chooseInstead}</button>
          </div>
        )}

        {/* 2. recording */}
        {stage === 'recording' && (
          <div className="flex min-h-[70vh] flex-col items-center gap-4 rounded-2xl bg-white px-5 pb-6 pt-7">
            <div className={`flex items-center gap-2.5 rounded-full px-4 py-2 text-[17px] font-bold ${paused ? 'bg-[#eef0f4] text-[#5b6170]' : 'bg-[#fdecea] text-[#c62828]'}`}>
              <span className="relative flex h-[18px] w-[18px] items-center justify-center" aria-hidden="true">
                {!paused && <span className="absolute inset-0 rounded-full bg-[rgba(229,57,53,0.55)] animate-attention-ring motion-reduce:hidden" />}
                <span className={`relative h-3 w-3 ${paused ? 'rounded-sm bg-[#5b6170]' : 'rounded-full bg-[#c62828]'}`} />
              </span>
              <span>{paused ? COPY.paused : COPY.recording}</span>
            </div>
            <div className="text-[76px] font-bold leading-none tabular-nums" aria-live="off">{clockText(elapsed)}</div>
            <div className="-mt-2 text-base text-[#5b6170]">{COPY.minutesWord}</div>
            <SoundBars live={!paused} level={level} />
            <div className="-mt-1 text-base text-[#3a3f4b]">{paused ? COPY.pausedNote : COPY.hearing}</div>
            {screenWentOff && <Warning>{COPY.screenWentOff}</Warning>}
            <div className="flex w-full items-center gap-3 rounded-xl bg-[#f4f5f6] p-3.5 text-[15px] leading-snug text-[#3a3f4b]">
              <Smartphone className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
              <span>{COPY.keepOpen}</span>
            </div>
            <div className="flex-1" />
            <button type="button" onClick={() => setConfirmFinish(true)}
              className="flex h-16 w-full items-center justify-center gap-3 rounded-[14px] bg-primary text-xl font-bold text-white">
              <span className="h-[18px] w-[18px] rounded-[3px] bg-white" aria-hidden="true" />
              {COPY.finish}
            </button>
            <button type="button" onClick={togglePause}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary">
              {paused ? <Mic className="h-5 w-5" aria-hidden="true" /> : <Pause className="h-5 w-5" aria-hidden="true" />}
              {paused ? COPY.resume : COPY.pause}
            </button>
          </div>
        )}

        {confirmFinish && (
          <BottomSheet label={COPY.finishQ} onClose={() => setConfirmFinish(false)}>
            <div className="text-[23px] font-bold">{COPY.finishQ}</div>
            <div className="text-[17px] text-[#3a3f4b]">{COPY.youRecorded(minutesText(recorderRef.current?.elapsedMs() ?? elapsed))}</div>
            {(recorderRef.current?.elapsedMs() ?? elapsed) < SHORT_RECORDING_SECONDS * 1000 && <Warning>{COPY.thatIsShort}</Warning>}
            <button type="button" onClick={finishRecording} className="h-[60px] rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.yesFinish}</button>
            <button type="button" onClick={() => setConfirmFinish(false)}
              className="h-14 rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary">{COPY.keepRecording}</button>
          </BottomSheet>
        )}

        {/* 3. check and send */}
        {stage === 'check' && audio && (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-3.5 rounded-2xl border-2 border-accent bg-white p-4">
              <div className="flex items-center gap-3.5">
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent">
                  <Check className="h-7 w-7 text-white" strokeWidth={2.6} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[19px] font-bold">{audio.label}</span>
                  <span className="text-[15px] text-[#5b6170]">{audio.sub}</span>
                </span>
              </div>
              {audioUrl && (
                <>
                  <audio ref={player} src={audioUrl} preload="metadata" onEnded={() => setPlaying(false)} className="hidden" />
                  <button type="button" onClick={togglePlay}
                    className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] border border-[#d6d9de] bg-[#f4f5f6] text-base font-semibold text-primary">
                    {playing ? <Pause className="h-[18px] w-[18px]" aria-hidden="true" /> : <Play className="h-[18px] w-[18px]" aria-hidden="true" />}
                    {playing ? COPY.stopListening : COPY.listen}
                  </button>
                </>
              )}
              <button type="button" onClick={redo} className="h-11 text-[15px] font-semibold text-[#5b6170] underline">
                {audio.recordingId ? COPY.recordAgain : COPY.chooseAnother}
              </button>
            </div>

            {isShort && <Warning>{COPY.shortWarning}</Warning>}

            <div className="mt-1 text-base font-bold text-primary">
              {COPY.addMore} <span className="font-normal text-muted-foreground">{COPY.canSkip}</span>
            </div>

            <div className={`flex items-center gap-3 rounded-[14px] bg-white p-3.5 ${plan ? 'border-2 border-accent' : 'border border-[#e5e7eb]'}`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] ${plan ? 'bg-[#e3f4ea] text-[#1b6b43]' : 'bg-[#eef0f4] text-primary'}`}>
                {plan?.kind === 'library' ? <BookOpen className="h-[22px] w-[22px]" aria-hidden="true" />
                  : plan?.kind === 'file' && plan.title === COPY.photoOfPlan ? <Camera className="h-[22px] w-[22px]" aria-hidden="true" />
                    : <FileText className="h-[22px] w-[22px]" aria-hidden="true" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[17px] font-semibold" dir="auto">{plan ? plan.title : COPY.lessonPlan}</span>
                <span className={`text-sm ${plan ? 'text-[#1b6b43]' : 'text-muted-foreground'}`}>{plan ? plan.sub : COPY.lessonPlanSub}</span>
              </span>
              <button type="button" onClick={() => { setPlanError(null); setPlanSheet(true); }}
                aria-label={plan ? 'Change the lesson plan' : 'Add a lesson plan'}
                className="h-11 shrink-0 rounded-[10px] border-2 border-primary bg-white px-4 text-base font-bold text-primary">
                {plan ? COPY.change : COPY.add}
              </button>
            </div>
            {planError && <Warning>{planError}</Warning>}

            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#eef0f4] text-primary">
                  <Camera className="h-[22px] w-[22px]" aria-hidden="true" />
                </span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[17px] font-semibold">{COPY.photosTitle}</span>
                  <span className="text-sm text-muted-foreground">{COPY.photosSub}</span>
                </span>
                <button type="button" onClick={() => photosInput.current?.click()} disabled={photos.length >= MAX_PHOTOS}
                  aria-label="Add photos of the board"
                  className="h-11 shrink-0 rounded-[10px] border-2 border-primary bg-white px-4 text-base font-bold text-primary disabled:border-[#c4c8cf] disabled:text-[#9aa0aa]">
                  {COPY.add}
                </button>
              </div>
              <input ref={photosInput} data-testid="photos-input" type="file" multiple accept={`${acceptFor('photo')},image/jpeg,image/png`} className="hidden"
                onChange={(e) => { onPhotos(e.target.files); e.target.value = ''; }} />
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2.5">
                  {photos.map((p, i) => (
                    <span key={`${p.name}-${i}`} className="relative flex h-16 max-w-[120px] items-end rounded-lg bg-[#eef0f4] px-2 py-1.5 text-xs text-[#3a3f4b]">
                      <span className="truncate">{p.name}</span>
                      <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                        className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary text-white">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {photosError && <Warning>{photosError}</Warning>}
            </Card>

            <button type="button" onClick={send}
              className="mt-1.5 flex h-16 items-center justify-center gap-3 rounded-[14px] bg-primary text-xl font-bold text-white">
              {COPY.send}
            </button>
          </div>
        )}

        {planSheet && (
          <BottomSheet label={COPY.addPlanTitle} onClose={() => setPlanSheet(false)}>
            <div className="text-[23px] font-bold">{COPY.addPlanTitle}</div>
            <button type="button" onClick={() => { setPlanSheet(false); setLibraryLevel(0); setStage('library'); }}
              className="flex items-center gap-4 rounded-2xl border-2 border-primary bg-[#e3f4ea] p-4 text-left text-primary">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-white"><BookOpen className="h-[30px] w-[30px]" aria-hidden="true" /></span>
              <span className="flex flex-col gap-1"><span className="text-xl font-bold">{COPY.fromLibrary}</span><span className="text-[15px] text-[#3a4a42]">{COPY.fromLibrarySub}</span></span>
            </button>
            <button type="button" onClick={() => planPhotoInput.current?.click()}
              className="flex items-center gap-4 rounded-2xl border-2 border-primary bg-white p-4 text-left text-primary">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-[#eef0f4]"><Camera className="h-[30px] w-[30px]" aria-hidden="true" /></span>
              <span className="flex flex-col gap-1"><span className="text-xl font-bold">{COPY.takePhoto}</span><span className="text-[15px] text-[#5b6170]">{COPY.takePhotoSub}</span></span>
            </button>
            {/* accept must be exactly image/*: Capacitor opens the camera only then (any
                other list gets the file picker). The type is still checked on arrival. */}
            <input ref={planPhotoInput} data-testid="plan-photo-input" type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { onPlanFile(e.target.files?.[0], true); e.target.value = ''; }} />
            <button type="button" onClick={() => planFileInput.current?.click()} className="h-11 text-base font-semibold text-primary underline">{COPY.orFile}</button>
            <input ref={planFileInput} data-testid="plan-file-input" type="file" accept={acceptFor('lesson_plan')} className="hidden"
              onChange={(e) => { onPlanFile(e.target.files?.[0], false); e.target.value = ''; }} />
            <button type="button" onClick={() => setPlanSheet(false)}
              className="h-[52px] rounded-xl border border-[#d6d9de] bg-white text-[17px] font-semibold text-[#5b6170]">{COPY.cancel}</button>
          </BottomSheet>
        )}

        {/* 3c. the library */}
        {stage === 'library' && (
          <LibraryPicker onPick={onLibraryPick} onStepChange={setLibraryLevel} backSignal={libraryBack} />
        )}

        {/* 4. sending */}
        {stage === 'sending' && (
          <div className="flex flex-col items-center gap-4 px-1 pt-10 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#e3f4ea]">
              <Upload className="h-11 w-11 text-[#1b6b43]" aria-hidden="true" />
            </span>
            <h2 className="text-[23px] font-bold">{COPY.sending}</h2>
            <div className="relative h-4 w-full overflow-hidden rounded-full bg-[#e5e7eb]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="relative h-full overflow-hidden rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(4, progress)}%` }}>
                <span className="absolute inset-y-0 w-2/5 bg-white/35 animate-progress-stripe motion-reduce:hidden" />
              </div>
            </div>
            <div className="text-xl font-bold text-[#1b6b43]">{progress}%</div>
            <div className="flex w-full items-center gap-3 rounded-xl bg-white p-3.5 text-left text-[15px] leading-snug text-[#3a3f4b]">
              <Smartphone className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
              <span>{COPY.keepOpenSending}</span>
            </div>
          </div>
        )}

        {/* 4b. not sent */}
        {stage === 'failed' && failure && (
          <div className="flex flex-col items-center gap-4 px-1 pt-10 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#fff6e0]">
              {failure.kind === 'network' ? <WifiOff className="h-11 w-11 text-[#7a5600]" aria-hidden="true" /> : <AlertTriangle className="h-11 w-11 text-[#7a5600]" aria-hidden="true" />}
            </span>
            {failure.kind === 'network' && (
              <>
                <h2 className="text-[23px] font-bold">{COPY.netTitle}</h2>
                <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{audio?.recordingId ? COPY.netRecorded : COPY.netFile}</p>
                <button type="button" onClick={send} className="mt-2 h-[60px] w-full rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.tryAgain}</button>
              </>
            )}
            {(failure.kind === 'plan_not_ready' || failure.kind === 'plan_not_found') && (
              <>
                <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{COPY.planProblem}</p>
                <button type="button" onClick={() => { setPlan(null); setStage('check'); setPlanSheet(true); }}
                  className="mt-2 h-[60px] w-full rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.changePlan}</button>
              </>
            )}
            {failure.kind === 'refused' && (
              <>
                <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{COPY.refused}</p>
                <button type="button" onClick={() => setStage('check')} className="mt-2 h-[60px] w-full rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.tryAgain}</button>
              </>
            )}
          </div>
        )}

        {/* 4c. another lesson still being analysed */}
        {stage === 'busy' && (
          <div className="flex flex-col items-center gap-4 px-1 pt-10 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#eef0f4]">
              <Loader2 className="h-11 w-11 text-primary motion-safe:animate-spin" aria-hidden="true" />
            </span>
            <h2 className="text-[23px] font-bold">{COPY.busyTitle}</h2>
            <p className="text-[17px] leading-relaxed text-[#3a3f4b]">
              {COPY.busySub} {audio?.recordingId ? COPY.busySafe : ''}
            </p>
            {failure?.coachingSessionId && (
              <Link to={`/portal/coaching/session/${failure.coachingSessionId}`}
                className="flex h-[60px] w-full items-center justify-center rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.openThat}</Link>
            )}
            <Link to="/portal/coaching"
              className="flex h-14 w-full items-center justify-center rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary">{COPY.backToCoaching}</Link>
          </div>
        )}

        {/* 5. sent */}
        {stage === 'sent' && sessionId && (
          <div className="flex flex-col items-center gap-4 px-1 pt-10 text-center">
            <span className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-accent">
              <Check className="h-14 w-14 text-white" strokeWidth={2.6} aria-hidden="true" />
            </span>
            <h2 className="text-[26px] font-bold">{COPY.sent}</h2>
            <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{COPY.sentSub}</p>
            <p className="flex items-center gap-2 text-[15px] text-[#5b6170]">
              <MessageCircle className="h-[18px] w-[18px] text-accent" aria-hidden="true" />{COPY.alsoWhatsApp}
            </p>
            <Link to={`/portal/coaching/session/${sessionId}`}
              className="mt-2 flex h-[60px] w-full items-center justify-center rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.openLesson}</Link>
            <Link to="/portal/coaching"
              className="flex h-14 w-full items-center justify-center rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary">{COPY.backToCoaching}</Link>
          </div>
        )}
      </div>
    </PortalLayout>
  );
};

export default PortalCoachingRecord;
