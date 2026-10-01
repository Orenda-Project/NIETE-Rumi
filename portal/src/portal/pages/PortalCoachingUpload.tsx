import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, FileAudio, FileText, Image as ImageIcon, Loader2, Upload, X,
  type LucideIcon,
} from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { portal } from '../services/api';
import {
  MAX_PHOTOS, SHORT_RECORDING_SECONDS, acceptFor, checkFile, formatSize, readAudioDuration,
  type UploadKind,
} from '../lib/coachingUpload';
import type { CoachingProgress, CoachingStage } from '../types/portal';

/**
 * bd-7hyj7 — a teacher analyses her own lesson from the portal.
 *
 * Same pipeline as a recording sent on WhatsApp: transcription, the FICO
 * analysis, ONE reflective question, then the report (which also arrives in her
 * chat). The difference is where she does it — the files are picked here (the
 * lesson plan and photos the WhatsApp flow would ask for afterwards are picked
 * up front), and she answers her question here; nothing about the debrief is
 * sent to WhatsApp.
 *
 * Two views on one URL. Without ?session= it is the upload form; with it, the
 * progress of that session — so a reload, or coming back later, resumes.
 *
 * Copy is English like every other portal page; it lives in one place so an
 * i18n pass can lift it. Her QUESTION is generated in her own language and is
 * rendered dir="auto", so an Urdu question reads right-to-left on this page.
 */

const COPY = {
  title: 'Analyse a lesson',
  intro: 'Upload a recording of your lesson. You will get the same feedback as when you send it on WhatsApp, and you can reflect on it here.',
  recording: 'Classroom recording',
  recordingHint: 'Required. A recording from your phone (.m4a, .mp3, .ogg, .wav…), ideally the whole lesson.',
  lessonPlan: 'Lesson plan',
  lessonPlanHint: 'Optional. PDF, Word or a photo of the plan. It lets us check how the lesson followed it.',
  photos: 'Classroom photos',
  photosHint: `Optional. Up to ${MAX_PHOTOS} photos of the board or students' work — never faces.`,
  choose: 'Choose file',
  choosePhotos: 'Choose photos',
  notAudio: "This doesn't look like an audio recording. Use an .m4a, .mp3, .ogg or .wav file.",
  wrongType: "This file type isn't supported here.",
  tooLarge: 'This file is too large.',
  tooManyPhotos: `You can add up to ${MAX_PHOTOS} photos.`,
  shortWarning: 'This recording is under 10 minutes. Feedback works best on a whole lesson, so it may be thin.',
  start: 'Start analysis',
  uploading: 'Uploading…',
  uploadFailed: "The upload didn't finish. Check your connection and try again — nothing was started.",
  startFailed: "We couldn't start the analysis. Please try again.",
  alreadyRunning: 'One of your recordings is already being analysed. Here is its progress — you can start another when it finishes.',
  progressTitle: 'Your lesson analysis',
  progressIntro: 'This usually takes 10–15 minutes. You can leave this page and come back — it keeps going.',
  questionTitle: 'Your reflection',
  questionIntro: 'Take a moment to think about your lesson, then answer in your own words.',
  answerPlaceholder: 'Write your answer…',
  send: 'Send answer',
  sending: 'Sending…',
  sendFailed: "Your answer didn't send. Please try again.",
  thanks: 'Thank you for reflecting.',
  reportComing: 'Your report is being prepared.',
  viewReport: 'View your report',
  stopped: "This analysis couldn't be completed. You can try again with the same recording.",
  tryAgain: 'Start a new analysis',
  back: 'Back to coaching sessions',
};

const STAGES: { key: CoachingStage; label: string }[] = [
  { key: 'queued', label: 'Uploaded' },
  { key: 'transcribing', label: 'Listening to your lesson' },
  { key: 'analysing', label: 'Analysing' },
  { key: 'reflection', label: 'Your reflection' },
  { key: 'report', label: 'Preparing your report' },
  { key: 'done', label: 'Report ready' },
];

const POLL_MS = 5000;

/** The id of the session already running, when /start answered 409. */
function runningSessionId(err: unknown): string | null {
  const res = (err as { response?: { status?: number; data?: { coachingSessionId?: unknown } } })?.response;
  const id = res?.status === 409 ? res.data?.coachingSessionId : null;
  return typeof id === 'string' && id ? id : null;
}

function problemText(problem: 'wrong_type' | 'too_large', kind: UploadKind): string {
  if (problem === 'too_large') return COPY.tooLarge;
  return kind === 'audio' ? COPY.notAudio : COPY.wrongType;
}

const PortalCoachingUpload = () => {
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('session');
  const existing = params.get('existing') === '1';

  return (
    <PortalLayout>
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-3xl">
        <Link to="/portal/coaching" className="text-sm text-muted-foreground hover:underline">
          ← {COPY.back}
        </Link>
        {sessionId ? (
          <ProgressView sessionId={sessionId} alreadyRunning={existing} />
        ) : (
          <UploadForm onStarted={(id, wasRunning) => setParams(wasRunning ? { session: id, existing: '1' } : { session: id })} />
        )}
      </div>
    </PortalLayout>
  );
};

/* ───────────────────────────── upload form ───────────────────────────── */

function UploadForm({ onStarted }: { onStarted: (id: string, alreadyRunning: boolean) => void }) {
  const [recording, setRecording] = useState<File | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [shortWarning, setShortWarning] = useState(false);
  const [lessonPlan, setLessonPlan] = useState<File | null>(null);
  const [lessonPlanError, setLessonPlanError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const pickRecording = (file: File | undefined) => {
    setShortWarning(false);
    if (!file) return;
    const problem = checkFile(file, 'audio');
    if (problem) {
      setRecording(null);
      setRecordingError(problemText(problem, 'audio'));
      return;
    }
    setRecording(file);
    setRecordingError(null);
    readAudioDuration(file).then((seconds) => {
      setShortWarning(seconds != null && seconds > 0 && seconds < SHORT_RECORDING_SECONDS);
    });
  };

  const pickLessonPlan = (file: File | undefined) => {
    if (!file) return;
    const problem = checkFile(file, 'lesson_plan');
    setLessonPlan(problem ? null : file);
    setLessonPlanError(problem ? problemText(problem, 'lesson_plan') : null);
  };

  const pickPhotos = (list: FileList | File[] | null) => {
    const chosen = Array.from(list || []);
    const all = [...photos, ...chosen];
    if (all.length > MAX_PHOTOS) {
      setPhotosError(COPY.tooManyPhotos);
      return;
    }
    const bad = chosen.map((f) => checkFile(f, 'photo')).find(Boolean);
    if (bad) {
      setPhotosError(problemText(bad, 'photo'));
      return;
    }
    setPhotos(all);
    setPhotosError(null);
  };

  const start = async () => {
    if (!recording) return;
    setBusy(true);
    setUploadError(null);
    setPercent(0);

    const jobs: { file: File; kind: UploadKind }[] = [
      { file: recording, kind: 'audio' },
      ...(lessonPlan ? [{ file: lessonPlan, kind: 'lesson_plan' as const }] : []),
      ...photos.map((file) => ({ file, kind: 'photo' as const })),
    ];
    const total = jobs.reduce((sum, j) => sum + j.file.size, 0) || 1;
    let done = 0;
    const keys: { kind: UploadKind; key: string }[] = [];

    try {
      for (const job of jobs) {
        const signed = await portal.presignCoachingUpload({
          filename: job.file.name, sizeBytes: job.file.size, kind: job.kind,
        });
        await portal.uploadToR2(signed.uploadUrl, job.file, signed.contentType, (loaded) => {
          setPercent(Math.min(99, Math.round(((done + loaded) / total) * 100)));
        });
        done += job.file.size;
        keys.push({ kind: job.kind, key: signed.key });
      }
    } catch {
      // Nothing is started unless EVERY file arrived — a lesson analysed
      // without the plan she attached would be scored as if she had none.
      setUploadError(COPY.uploadFailed);
      setBusy(false);
      return;
    }

    setPercent(100);
    try {
      const { coachingSessionId } = await portal.startCoachingUpload({
        key: keys.find((k) => k.kind === 'audio')!.key,
        lessonPlanKey: keys.find((k) => k.kind === 'lesson_plan')?.key,
        photoKeys: keys.filter((k) => k.kind === 'photo').map((k) => k.key),
      });
      onStarted(coachingSessionId, false);
    } catch (err) {
      const running = runningSessionId(err);
      if (running) {
        onStarted(running, true);
        return;
      }
      setUploadError(COPY.startFailed);
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <h1 className="text-3xl sm:text-4xl font-light mb-2">{COPY.title}</h1>
      <p className="text-muted-foreground mb-8">{COPY.intro}</p>

      <div className="space-y-4">
        <FilePicker
          testId="recording-input"
          icon={FileAudio}
          title={COPY.recording}
          hint={COPY.recordingHint}
          accept={acceptFor('audio')}
          buttonLabel={COPY.choose}
          files={recording ? [recording] : []}
          error={recordingError}
          errorTestId="recording-error"
          disabled={busy}
          onPick={(list) => pickRecording(list?.[0])}
          onRemove={() => { setRecording(null); setShortWarning(false); }}
        />
        {shortWarning && (
          <div data-testid="short-warning" className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {COPY.shortWarning}
          </div>
        )}
        <FilePicker
          testId="lesson-plan-input"
          icon={FileText}
          title={COPY.lessonPlan}
          hint={COPY.lessonPlanHint}
          accept={acceptFor('lesson_plan')}
          buttonLabel={COPY.choose}
          files={lessonPlan ? [lessonPlan] : []}
          error={lessonPlanError}
          errorTestId="lesson-plan-error"
          disabled={busy}
          onPick={(list) => pickLessonPlan(list?.[0])}
          onRemove={() => setLessonPlan(null)}
        />
        <FilePicker
          testId="photos-input"
          icon={ImageIcon}
          title={COPY.photos}
          hint={COPY.photosHint}
          accept={acceptFor('photo')}
          buttonLabel={COPY.choosePhotos}
          multiple
          files={photos}
          error={photosError}
          errorTestId="photos-error"
          disabled={busy || photos.length >= MAX_PHOTOS}
          onPick={(list) => pickPhotos(list)}
          onRemove={(i) => { setPhotos(photos.filter((_, j) => j !== i)); setPhotosError(null); }}
        />
      </div>

      {uploadError && (
        <div data-testid="upload-error" className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {uploadError}
        </div>
      )}

      {busy && (
        <div className="mt-6">
          <div className="text-sm text-muted-foreground mb-2">{COPY.uploading} {percent}%</div>
          <Progress value={percent} />
        </div>
      )}

      <Button data-testid="start-analysis" className="mt-6 w-full sm:w-auto" disabled={!recording || busy} onClick={start}>
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
        {busy ? COPY.uploading : COPY.start}
      </Button>
    </div>
  );
}

function FilePicker(props: {
  testId: string; icon: LucideIcon; title: string; hint: string; accept: string; buttonLabel: string;
  files: File[]; error: string | null; errorTestId: string; disabled?: boolean; multiple?: boolean;
  onPick: (files: FileList | null) => void; onRemove: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = props.icon;
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-border">
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{props.title}</div>
          <div className="text-sm text-muted-foreground">{props.hint}</div>
          {props.files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {props.files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="truncate">{f.name}</span>
                  <span className="text-muted-foreground shrink-0">{formatSize(f.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => props.onRemove(i)}
                    disabled={props.disabled && !props.multiple}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {props.error && (
            <div data-testid={props.errorTestId} className="mt-2 text-sm text-destructive">{props.error}</div>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={props.disabled} onClick={() => inputRef.current?.click()}>
          {props.buttonLabel}
        </Button>
        <input
          ref={inputRef}
          data-testid={props.testId}
          type="file"
          className="sr-only"
          accept={props.accept}
          multiple={props.multiple}
          onChange={(e) => { props.onPick(e.target.files); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}

/* ───────────────────────────── progress view ───────────────────────────── */

function ProgressView({ sessionId, alreadyRunning }: { sessionId: string; alreadyRunning: boolean }) {
  const [progress, setProgress] = useState<CoachingProgress | null>(null);
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProgress(await portal.getCoachingProgress(sessionId));
    } catch {
      // A missed poll is not news; the next one will try again.
    }
  }, [sessionId]);

  const stage = progress?.stage;
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (stage === 'done' || stage === 'stopped') return undefined;
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, stage]);

  const send = async () => {
    const text = answer.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await portal.submitCoachingReflection(sessionId, text);
      setAcknowledgement(res.acknowledgement || COPY.thanks);
      refresh();
    } catch {
      setSendError(COPY.sendFailed);
    } finally {
      setSending(false);
    }
  };

  const currentIndex = Math.max(0, STAGES.findIndex((s) => s.key === stage));

  return (
    <div data-testid="progress-view" className="mt-4">
      <h1 className="text-3xl sm:text-4xl font-light mb-2">{COPY.progressTitle}</h1>
      <p className="text-muted-foreground mb-6">{COPY.progressIntro}</p>

      {alreadyRunning && (
        <div data-testid="already-running" className="mb-6 rounded-md border border-border bg-muted/40 p-3 text-sm">
          {COPY.alreadyRunning}
        </div>
      )}

      {stage === 'stopped' ? (
        <div data-testid="analysis-stopped" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {COPY.stopped}
          <div className="mt-3">
            <Button asChild variant="outline" size="sm"><Link to="/portal/coaching/new">{COPY.tryAgain}</Link></Button>
          </div>
        </div>
      ) : (
        <ol className="space-y-3 mb-8">
          {STAGES.map((s, i) => {
            const isDone = progress != null && (i < currentIndex || stage === 'done');
            const isCurrent = progress != null && i === currentIndex && stage !== 'done';
            return (
              <li key={s.key} className={cn('flex items-center gap-3', !isDone && !isCurrent && 'text-muted-foreground')}>
                {isDone ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                  : isCurrent ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <span className="w-5 h-5 rounded-full border border-border inline-block" />}
                <span className={cn(isCurrent && 'font-medium')}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {progress?.shortRecording && stage !== 'stopped' && (
        <div className="mb-6 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {COPY.shortWarning}
        </div>
      )}

      {progress?.reflection && !acknowledgement && (
        <div className="bg-white rounded-lg p-5 shadow-sm border border-border">
          <div className="text-sm text-muted-foreground mb-1">{COPY.questionTitle}</div>
          <p className="text-sm text-muted-foreground mb-3">{COPY.questionIntro}</p>
          <p data-testid="reflection-question" dir="auto" className="text-lg mb-4 whitespace-pre-line">
            {progress.reflection.question}
          </p>
          <Textarea
            data-testid="reflection-answer"
            dir="auto"
            rows={5}
            value={answer}
            placeholder={COPY.answerPlaceholder}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={sending}
          />
          {sendError && <div className="mt-2 text-sm text-destructive">{sendError}</div>}
          <Button data-testid="reflection-submit" className="mt-3" disabled={sending || !answer.trim()} onClick={send}>
            {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {sending ? COPY.sending : COPY.send}
          </Button>
        </div>
      )}

      {acknowledgement && (
        <div className="bg-white rounded-lg p-5 shadow-sm border border-border">
          <p data-testid="reflection-ack" dir="auto" className="text-lg">{acknowledgement}</p>
          {stage !== 'done' && <p className="text-sm text-muted-foreground mt-2">{COPY.reportComing}</p>}
        </div>
      )}

      {stage === 'done' && (
        <Button asChild className="mt-6">
          <Link data-testid="view-report" to={`/portal/coaching/session/${sessionId}`}>{COPY.viewReport}</Link>
        </Button>
      )}
    </div>
  );
}

export default PortalCoachingUpload;
