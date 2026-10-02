import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  AlertTriangle, BookOpen, Camera, Check, ChevronLeft, ChevronRight, Clock, FileText, MicOff, Search, Smartphone,
  Upload, WifiOff, X,
} from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import BottomSheet from '../components/coaching/BottomSheet';
import LibraryPicker, { type PickedPlan } from '../components/coaching/LibraryPicker';
import CoachRecorder, { minutesText } from '../components/coaching/coach/CoachRecorder';
import SendLessonSheet from '../components/coaching/SendLessonSheet';
import { leader, portal } from '../services/api';
import type { LeaderPatchTeacher, LeaderScheduledObservation } from '../types/portal';
import { acceptFor, checkFile, formatSize, MAX_PHOTOS, readAudioDuration, SHORT_RECORDING_SECONDS } from '../lib/coachingUpload';
import { canRecordHere } from '../lib/recordingSupport';
import { deleteRecording, latestUnsent, type StoredRecording } from '../lib/recordingStore';
import { withDuration } from '../lib/webmDuration';
import { SendError, type LibraryPick } from '../lib/coachingSend';
import type { FinishedRecording } from '../lib/lessonRecorder';
import {
  entryCopy, firstName, forgetRecording, recordingTeacher, rememberRecording, sendObservation, type UnsentFor,
} from '../lib/coachObserve';

/**
 * bd-5rz1v.6 — "Send a lesson to your Digital Coach", for a COACH observing one
 * of her teachers. Reached from the button on Observations (Option B: the button
 * names the goal; this page offers the ways).
 *
 *   who        today's visits first, then her teachers (her patch), with a search
 *   sheet      the two ways: record it now in her class | choose a recording
 *   recording  the teacher's recorder, naming whose lesson it is
 *   check      listen, redo, HER lesson plan (her recent plans, the library, a
 *              photo of her plan), photos of the board
 *   sending    → sent → the observation page
 *
 * The lesson joins the same /observe pipeline as a WhatsApp recording; the draft,
 * the talk with the teacher and her report then all happen in the portal.
 */

const COPY = {
  title: 'Record your Teacher’s Lesson',
  notAvailable: "Sending a lesson from the portal isn't available on your account yet. You can still use /observe on WhatsApp.",
  who: 'Who are you observing?',
  today: 'Today',
  yourTeachers: 'Your teachers',
  search: 'Search by name or school',
  noTeachers: 'No teachers in your schools yet.',
  noMatch: 'No teacher matches that.',
  visitAt: (slot: string | null) => (slot ? `Your visit at ${slot}` : 'Your visit today'),
  cancel: 'Cancel',
  micBlocked: "We can't use the microphone",
  micAllow: 'When your phone asks, tap Allow.',
  micHelpApp: 'If you tapped Block before: open phone Settings → Apps → NIETE → Permissions → Microphone → Allow.',
  micHelpWeb: 'If you tapped Block before: tap the lock next to the web address, then allow the microphone.',
  tryAgain: 'Try again',
  chooseInstead: 'Choose a recording instead',
  observing: (name: string) => `Observing: ${name}`,
  hearing: 'We can hear the class.',
  keepOpen: 'Keep this screen open. Put the phone face up, near the teacher.',
  thatIsShort: 'That is short. The report works best on a whole lesson.',
  checkTitle: 'Check and send',
  lessonOf: (name: string) => `${name}’s lesson`,
  justNow: 'recorded just now',
  recordAgain: 'Delete and record again',
  chooseAnother: 'Choose a different file',
  shortWarning: 'This is under 10 minutes. You can still send it, but the report may be thin.',
  addMore: 'Add more',
  canSkip: '(you can skip this)',
  planOf: (name: string) => `${name}’s lesson plan`,
  planSub: 'Their recent plans, our library, or a photo of their plan.',
  add: '+ Add',
  change: 'Change',
  photosTitle: 'Photos of the board',
  photosSub: `Up to ${MAX_PHOTOS}. No faces.`,
  tooManyPhotos: `You can add up to ${MAX_PHOTOS} photos.`,
  notAPhoto: 'That is not a photo. Choose a JPG or PNG.',
  notAudio: 'That is not a recording. Choose a sound file from your phone.',
  tooLarge: 'That recording is too large to send.',
  send: 'Send to Digital Coach',
  planSheet: (name: string) => `${name}’s lesson plan`,
  fromLibrary: 'Their recent plans and our library',
  fromLibrarySub: 'Grade → subject → chapter → lesson',
  takePhoto: 'Take a photo of their plan',
  takePhotoSub: 'Their written or printed plan.',
  orFile: 'Or choose a file (PDF or Word)',
  photoOfPlan: 'Photo of their plan',
  takenNow: 'Taken just now',
  planNotOk: 'That is not a lesson plan file. Choose a PDF, Word file or photo.',
  libraryTitle: 'The teacher’s lesson plan',
  recentTitle: (name: string) => `${name}’s recent plans`,
  sending: (name: string) => `Sending ${name}’s lesson…`,
  keepOpenSending: 'Keep this screen open until it is done.',
  netTitle: 'The internet stopped',
  netRecorded: "Don't worry. The recording is safe on this phone.",
  netFile: "Don't worry. Nothing was lost.",
  planProblem: 'That lesson plan could not be used. Pick another, or take a photo of their plan.',
  changePlan: 'Change the lesson plan',
  notYourTeacher: 'That teacher is not in your schools any more. Pick the teacher again from your teachers.',
  refused: 'Something was not accepted. Please try again.',
  sent: 'Sent!',
  sentSub: (name: string) => `Your Digital Coach is listening to ${name}’s lesson. In about 10 minutes the draft report is ready here.`,
  sentNext: (name: string) => `You check the draft, talk with ${name}, then send ${name} the report. ${name} gets nothing until you do.`,
  openObservation: 'Open this observation',
  backToObservations: 'Back to Observations',
  unsentTitle: (name: string) => `${name}’s lesson was not sent`,
  sendIt: 'Send it',
  delete: 'Delete',
};

type Teacher = { teacherExtId: string; schoolExtId: string | null; name: string; school: string | null; visitSlot?: string | null };

type Audio = { blob: Blob; filename: string; durationMs: number | null; recordingId: string | null; label: string; sub: string };

type Plan =
  | { kind: 'library'; pick: LibraryPick; title: string; sub: string }
  | { kind: 'file'; file: File; title: string; sub: string };

type Stage = 'who' | 'micBlocked' | 'recording' | 'check' | 'library' | 'sending' | 'failed' | 'sent';

function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lessonFilename(ext: string, at = new Date()): string {
  const d = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const t = `${String(at.getHours()).padStart(2, '0')}.${String(at.getMinutes()).padStart(2, '0')}`;
  return `Observation ${d} ${t}${ext}`;
}

const Warning = ({ children }: { children: ReactNode }) => (
  <div className="flex gap-2.5 rounded-xl bg-[#fff6e0] px-3.5 py-3 text-[15px] leading-snug text-[#7a5600]">
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

const TeacherRow = ({ t, today, onPick }: { t: Teacher; today?: boolean; onPick: (t: Teacher) => void }) => (
  <button type="button" onClick={() => onPick(t)}
    className={`flex min-h-[64px] items-center gap-3 rounded-xl bg-white px-3.5 py-2.5 text-left ${today ? 'border-2 border-accent' : 'border border-[#d6d9de]'}`}>
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eef0f4] font-bold text-primary" aria-hidden="true">
      {(t.name || '?').trim().charAt(0).toUpperCase()}
    </span>
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate text-[17px] font-semibold" dir="auto">{t.name}</span>
      {t.school && <span className="truncate text-[13px] text-[#5b6170]" dir="auto">{t.school}</span>}
      {today && <span className="text-[13px] font-semibold text-[#1b6b43]">{COPY.visitAt(t.visitSlot || null)}</span>}
    </span>
    <ChevronRight className="h-5 w-5 shrink-0 text-[#9aa0aa]" aria-hidden="true" />
  </button>
);

const LeaderObserveRecord = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const copy = entryCopy();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const [teachers, setTeachers] = useState<LeaderPatchTeacher[]>([]);
  const [upcoming, setUpcoming] = useState<LeaderScheduledObservation[]>([]);
  const [query, setQuery] = useState('');
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [waysSheet, setWaysSheet] = useState(false);
  const [stage, setStage] = useState<Stage>('who');
  const [unsent, setUnsent] = useState<{ meta: StoredRecording; blob: Blob; teacher: UnsentFor } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [audio, setAudio] = useState<Audio | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planSheet, setPlanSheet] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [libraryLevel, setLibraryLevel] = useState(0);
  const [libraryBack, setLibraryBack] = useState(0);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<SendError | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const audioInput = useRef<HTMLInputElement>(null);
  const planPhotoInput = useRef<HTMLInputElement>(null);
  const planFileInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => portal.getConfig())
      .then((cfg) => { if (live) setEnabled(cfg?.features?.coachObservation === true); })
      .catch(() => { if (live) setEnabled(false); });
    canRecordHere().then((ok) => { if (live) setCanRecord(ok); }).catch(() => {});
    leader.getTeachers().then((d) => { if (live) setTeachers(d.teachers || []); }).catch(() => {});
    leader.getObservations().then((d) => { if (live) setUpcoming((d.observations && d.observations.upcoming) || []); }).catch(() => {});
    latestUnsent().then((u) => {
      if (!live || !u) return;
      const who = recordingTeacher(u.meta.id);
      // Only a recording this page made: a teacher's own lesson is not offered here.
      if (who) setUnsent({ ...u, teacher: who });
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const today = localDay();
  const todays: Teacher[] = useMemo(() => upcoming
    .filter((s) => s.teacherExtId && s.scheduledFor === today)
    .map((s) => ({
      teacherExtId: s.teacherExtId as string, schoolExtId: s.schoolExtId, name: s.teacherName || 'Unnamed teacher',
      school: s.schoolName, visitSlot: s.scheduledSlot,
    })), [upcoming, today]);

  const all: Teacher[] = useMemo(() => teachers
    .filter((t) => t.teacherExtId)
    .map((t) => ({ teacherExtId: t.teacherExtId as string, schoolExtId: null, name: t.name || 'Unnamed teacher', school: t.schoolName })), [teachers]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((t) => `${t.name} ${t.school || ''}`.toLowerCase().includes(q));
  }, [all, query]);

  // A visit opened from the schedule arrives with the teacher already chosen.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current) return;
    const ext = params.get('teacher');
    if (!ext) return;
    const hit = todays.find((t) => t.teacherExtId === ext) || all.find((t) => t.teacherExtId === ext);
    if (!hit) return;
    preselected.current = true;
    const school = params.get('school');
    setTeacher({ ...hit, schoolExtId: school || hit.schoolExtId });
    setWaysSheet(true);
  }, [params, todays, all]);

  const pickTeacher = (t: Teacher) => { setTeacher(t); setWaysSheet(true); };

  // ── the two ways ─────────────────────────────────────────────────────────
  const recordNow = () => { setWaysSheet(false); setStage('recording'); };

  const onAudioChosen = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    const problem = checkFile(file, 'audio');
    if (problem) { setFileError(problem === 'too_large' ? COPY.tooLarge : COPY.notAudio); return; }
    const seconds = await readAudioDuration(file);
    const durationMs = seconds != null ? seconds * 1000 : null;
    setAudio({
      blob: file, filename: file.name, durationMs, recordingId: null, label: file.name,
      sub: [durationMs != null ? minutesText(durationMs) : null, formatSize(file.size)].filter(Boolean).join(' · '),
    });
    setStage('check');
  };

  const onRecorded = (out: FinishedRecording) => {
    setAudio({
      blob: out.blob, filename: lessonFilename(out.type.ext), durationMs: out.durationMs, recordingId: out.id,
      label: teacher ? COPY.lessonOf(teacher.name) : 'The lesson', sub: `${minutesText(out.durationMs)} · ${COPY.justNow}`,
    });
    setStage('check');
  };

  const sendUnsent = async () => {
    if (!unsent) return;
    const { meta, teacher: who } = unsent;
    const blob = await withDuration(unsent.blob, meta.ext, meta.elapsedMs);
    setTeacher({ teacherExtId: who.teacherExtId, schoolExtId: who.schoolExtId, name: who.teacherName, school: null });
    setAudio({
      blob, filename: lessonFilename(meta.ext, new Date(meta.startedAt)), durationMs: meta.elapsedMs || null,
      recordingId: meta.id, label: COPY.lessonOf(who.teacherName),
      sub: [meta.elapsedMs ? minutesText(meta.elapsedMs) : null,
        new Date(meta.startedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })]
        .filter(Boolean).join(' · '),
    });
    setUnsent(null);
    setStage('check');
  };

  const deleteUnsent = async () => {
    if (!unsent) return;
    try { await deleteRecording(unsent.meta.id); } catch { /* gone */ }
    forgetRecording(unsent.meta.id);
    setUnsent(null);
  };

  // ── check ────────────────────────────────────────────────────────────────
  const redo = async () => {
    const wasRecorded = audio?.recordingId;
    if (wasRecorded) {
      try { await deleteRecording(wasRecorded); } catch { /* gone */ }
      forgetRecording(wasRecorded);
    }
    setAudio(null);
    setStage('who');
    setWaysSheet(true);
  };

  const onPlanFile = (file: File | undefined, asPhoto: boolean) => {
    setPlanError(null);
    if (!file) return;
    if (checkFile(file, 'lesson_plan')) { setPlanError(COPY.planNotOk); return; }
    setPlan({ kind: 'file', file, title: asPhoto ? COPY.photoOfPlan : file.name, sub: asPhoto ? COPY.takenNow : `File · ${formatSize(file.size)}` });
    setPlanSheet(false);
  };

  const onPhotos = (list: FileList | null) => {
    setPhotosError(null);
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    if (chosen.some((f) => checkFile(f, 'photo'))) { setPhotosError(COPY.notAPhoto); return; }
    const next = [...photos, ...chosen];
    if (next.length > MAX_PHOTOS) { setPhotosError(COPY.tooManyPhotos); return; }
    setPhotos(next);
  };

  const onLibraryPick = useCallback((p: PickedPlan) => {
    setPlan({ kind: 'library', pick: p.pick, title: p.title, sub: p.sub });
    setStage('check');
  }, []);

  const loadHerRecent = useCallback(
    () => (teacher ? leader.getObserveRecentPlans(teacher.teacherExtId, teacher.schoolExtId) : Promise.resolve({ plans: [] })),
    [teacher],
  );

  // ── send ─────────────────────────────────────────────────────────────────
  const send = async () => {
    if (!audio || !teacher) return;
    setFailure(null);
    setProgress(0);
    setStage('sending');
    try {
      const { coachingSessionId } = await sendObservation({
        teacherExtId: teacher.teacherExtId,
        schoolExtId: teacher.schoolExtId,
        audio: { blob: audio.blob, filename: audio.filename },
        plan: plan ? (plan.kind === 'library' ? { kind: 'library', pick: plan.pick } : { kind: 'file', file: plan.file }) : null,
        photos,
      }, leader, portal, setProgress);
      if (audio.recordingId) {
        try { await deleteRecording(audio.recordingId); } catch { /* gone */ }
        forgetRecording(audio.recordingId);
      }
      setSessionId(coachingSessionId);
      setStage('sent');
    } catch (err) {
      setFailure(err instanceof SendError ? err : new SendError('network'));
      setStage('failed');
    }
  };

  const recordingNow = stage === 'recording';
  const back = () => {
    if (stage === 'library') {
      if (libraryLevel > 0) setLibraryBack((n) => n + 1); else setStage('check');
      return;
    }
    if (stage === 'check' || stage === 'micBlocked' || stage === 'failed') { setStage('who'); return; }
    navigate('/portal/leader/observations');
  };

  if (enabled === null) return <PortalLayout><LoadingState type="full" /></PortalLayout>;
  if (!enabled) {
    return (
      <PortalLayout>
        <div className="mx-auto max-w-md py-10 text-center text-muted-foreground">{COPY.notAvailable}</div>
      </PortalLayout>
    );
  }

  const name = teacher ? teacher.name : '';
  const first = firstName(name);
  const isShort = audio?.durationMs != null && audio.durationMs < SHORT_RECORDING_SECONDS * 1000;
  const title = stage === 'library' ? COPY.libraryTitle : stage === 'check' ? COPY.checkTitle : COPY.title;

  return (
    <PortalLayout bare={recordingNow || stage === 'sending'}>
      <div className="mx-auto flex w-full max-w-md flex-col pb-6">
        <div className="mb-3 flex h-12 items-center gap-1">
          {!recordingNow && stage !== 'sending' && stage !== 'sent' && (
            <button type="button" onClick={back} aria-label="Back" className="flex h-11 w-11 items-center justify-center rounded-lg text-primary">
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          <h1 className={`text-lg font-bold text-primary ${recordingNow || stage === 'sending' || stage === 'sent' ? 'pl-2' : ''}`}>{title}</h1>
        </div>

        {/* 1. who are you observing? */}
        {stage === 'who' && (
          <div className="flex flex-col gap-2.5">
            {unsent && (
              <div className="flex flex-col gap-3 rounded-2xl border-2 border-[#f0c36d] bg-[#fff6e0] p-4">
                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 h-6 w-6 shrink-0 text-[#7a5600]" aria-hidden="true" />
                  <div className="flex flex-col gap-1">
                    <span className="text-[17px] font-bold text-[#5c4100]" dir="auto">{COPY.unsentTitle(unsent.teacher.teacherName)}</span>
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

            <h2 className="text-[22px] font-bold">{COPY.who}</h2>
            {todays.length > 0 && (
              <>
                <div className="text-[15px] font-bold text-[#1b6b43]">{COPY.today}</div>
                {todays.map((t) => <TeacherRow key={`today-${t.teacherExtId}`} t={t} today onPick={pickTeacher} />)}
              </>
            )}
            <div className="mt-1 text-[15px] font-bold text-primary">{COPY.yourTeachers}</div>
            <label className="flex h-12 items-center gap-2 rounded-[10px] border border-[#d6d9de] bg-white px-3">
              <Search className="h-5 w-5 shrink-0 text-[#9aa0aa]" aria-hidden="true" />
              <span className="sr-only">{COPY.search}</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={COPY.search}
                className="h-full w-full bg-transparent text-[16px] outline-none" />
            </label>
            {all.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">{COPY.noTeachers}</p>
            ) : shown.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">{COPY.noMatch}</p>
            ) : shown.map((t) => <TeacherRow key={t.teacherExtId} t={t} onPick={pickTeacher} />)}
            <input ref={audioInput} data-testid="audio-input" type="file" accept={`${acceptFor('audio')},audio/*`} className="hidden"
              onChange={(e) => { void onAudioChosen(e.target.files?.[0]); e.target.value = ''; }} />
            {fileError && <Warning>{fileError}</Warning>}
          </div>
        )}

        {waysSheet && teacher && (
          <SendLessonSheet
            canRecord={canRecord}
            onRecord={recordNow}
            onFile={(f) => { setWaysSheet(false); void onAudioChosen(f); }}
            onClose={() => setWaysSheet(false)}
            copy={{ title: copy.sheet(first), record: copy.rec, recordSub: copy.recSub, upload: copy.file, uploadSub: copy.fileSub }}
          />
        )}

        {/* 1b. microphone refused */}
        {stage === 'micBlocked' && (
          <div className="flex flex-col items-center gap-4 px-1 pt-4 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#fdecea]"><MicOff className="h-11 w-11 text-[#c62828]" aria-hidden="true" /></span>
            <h2 className="text-[23px] font-bold">{COPY.micBlocked}</h2>
            <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{COPY.micAllow}</p>
            <p className="w-full rounded-xl bg-white p-3.5 text-left text-[15px] leading-relaxed text-[#5b6170]">
              {Capacitor.isNativePlatform() ? COPY.micHelpApp : COPY.micHelpWeb}
            </p>
            <button type="button" onClick={() => setStage('recording')} className="h-14 w-full rounded-xl bg-primary text-lg font-bold text-white">{COPY.tryAgain}</button>
            <button type="button" onClick={() => { setStage('who'); setTimeout(() => audioInput.current?.click(), 0); }}
              className="h-[52px] w-full rounded-xl border-2 border-primary bg-white text-[17px] font-bold text-primary">{COPY.chooseInstead}</button>
          </div>
        )}

        {/* 2. recording */}
        {stage === 'recording' && teacher && (
          <CoachRecorder
            label={COPY.observing(name)}
            copy={{ hearing: COPY.hearing, keepOpen: COPY.keepOpen, shortNote: COPY.thatIsShort }}
            shortMs={SHORT_RECORDING_SECONDS * 1000}
            onStarted={(id) => rememberRecording(id, { teacherExtId: teacher.teacherExtId, schoolExtId: teacher.schoolExtId, teacherName: teacher.name })}
            onFinished={onRecorded}
            onMicBlocked={() => setStage('micBlocked')}
          />
        )}

        {/* 3. check and send */}
        {stage === 'check' && audio && teacher && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3.5 rounded-2xl border-2 border-accent bg-white p-4">
              <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent"><Check className="h-7 w-7 text-white" strokeWidth={2.6} aria-hidden="true" /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[19px] font-bold" dir="auto">{audio.label}</span>
                <span className="text-[15px] text-[#5b6170]">{audio.sub}</span>
              </span>
            </div>
            <button type="button" onClick={redo} className="-mt-1 h-10 text-[15px] font-semibold text-[#5b6170] underline">
              {audio.recordingId ? COPY.recordAgain : COPY.chooseAnother}
            </button>
            {isShort && <Warning>{COPY.shortWarning}</Warning>}

            <div className="mt-1 text-base font-bold text-primary">{COPY.addMore} <span className="font-normal text-muted-foreground">{COPY.canSkip}</span></div>

            <div className={`flex items-center gap-3 rounded-[14px] bg-white p-3.5 ${plan ? 'border-2 border-accent' : 'border border-[#e5e7eb]'}`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] ${plan ? 'bg-[#e3f4ea] text-[#1b6b43]' : 'bg-[#eef0f4] text-primary'}`}>
                {plan?.kind === 'library' ? <BookOpen className="h-[22px] w-[22px]" aria-hidden="true" />
                  : plan?.kind === 'file' && plan.title === COPY.photoOfPlan ? <Camera className="h-[22px] w-[22px]" aria-hidden="true" />
                    : <FileText className="h-[22px] w-[22px]" aria-hidden="true" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[17px] font-semibold" dir="auto">{plan ? plan.title : COPY.planOf(first)}</span>
                <span className={`text-sm ${plan ? 'text-[#1b6b43]' : 'text-muted-foreground'}`}>{plan ? plan.sub : COPY.planSub}</span>
              </span>
              <button type="button" onClick={() => { setPlanError(null); setPlanSheet(true); }}
                aria-label={plan ? 'Change the lesson plan' : 'Add the lesson plan'}
                className="h-11 shrink-0 rounded-[10px] border-2 border-primary bg-white px-4 text-base font-bold text-primary">
                {plan ? COPY.change : COPY.add}
              </button>
            </div>
            {planError && <Warning>{planError}</Warning>}

            <div className="flex flex-col gap-3 rounded-[14px] border border-[#e5e7eb] bg-white p-3.5">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#eef0f4] text-primary"><Camera className="h-[22px] w-[22px]" aria-hidden="true" /></span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[17px] font-semibold">{COPY.photosTitle}</span>
                  <span className="text-sm text-muted-foreground">{COPY.photosSub}</span>
                </span>
                <button type="button" onClick={() => photosInput.current?.click()} disabled={photos.length >= MAX_PHOTOS} aria-label="Add photos of the board"
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
            </div>

            <button type="button" onClick={send} className="mt-1.5 flex h-16 items-center justify-center rounded-[14px] bg-primary text-xl font-bold text-white">{COPY.send}</button>
          </div>
        )}

        {planSheet && teacher && (
          <BottomSheet label={COPY.planSheet(first)} onClose={() => setPlanSheet(false)}>
            <div className="text-[22px] font-bold" dir="auto">{COPY.planSheet(first)}</div>
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
            <input ref={planPhotoInput} data-testid="plan-photo-input" type="file" accept="image/jpeg,image/png" capture="environment" className="hidden"
              onChange={(e) => { onPlanFile(e.target.files?.[0], true); e.target.value = ''; }} />
            <button type="button" onClick={() => planFileInput.current?.click()} className="h-11 text-base font-semibold text-primary underline">{COPY.orFile}</button>
            <input ref={planFileInput} data-testid="plan-file-input" type="file" accept={acceptFor('lesson_plan')} className="hidden"
              onChange={(e) => { onPlanFile(e.target.files?.[0], false); e.target.value = ''; }} />
            <button type="button" onClick={() => setPlanSheet(false)}
              className="h-[52px] rounded-xl border border-[#d6d9de] bg-white text-[17px] font-semibold text-[#5b6170]">{COPY.cancel}</button>
          </BottomSheet>
        )}

        {/* 3c. her plan, from the library — her recent plans first */}
        {stage === 'library' && (
          <LibraryPicker onPick={onLibraryPick} onStepChange={setLibraryLevel} backSignal={libraryBack}
            loadRecent={loadHerRecent} recentTitle={COPY.recentTitle(first)} showUsed={false} />
        )}

        {/* 4. sending */}
        {stage === 'sending' && (
          <div className="flex flex-col items-center gap-4 px-1 pt-10 text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#e3f4ea]"><Upload className="h-11 w-11 text-[#1b6b43]" aria-hidden="true" /></span>
            <h2 className="text-[23px] font-bold" dir="auto">{COPY.sending(first)}</h2>
            <div className="relative h-4 w-full overflow-hidden rounded-full bg-[#e5e7eb]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
            <div className="text-xl font-bold text-[#1b6b43]">{progress}%</div>
            <div className="flex w-full items-center gap-3 rounded-xl bg-white p-3.5 text-left text-[15px] leading-snug text-[#3a3f4b]">
              <Smartphone className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /><span>{COPY.keepOpenSending}</span>
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
            {(failure.kind === 'refused' || failure.kind === 'in_progress') && (
              <>
                <p className="text-[17px] leading-relaxed text-[#3a3f4b]">{failure.message === 'not_your_teacher' ? COPY.notYourTeacher : COPY.refused}</p>
                <button type="button" onClick={() => setStage(failure.message === 'not_your_teacher' ? 'who' : 'check')}
                  className="mt-2 h-[60px] w-full rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.tryAgain}</button>
              </>
            )}
          </div>
        )}

        {/* 5. sent */}
        {stage === 'sent' && sessionId && (
          <div className="flex flex-col items-center gap-4 px-1 pt-10 text-center">
            <span className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-accent"><Check className="h-14 w-14 text-white" strokeWidth={2.6} aria-hidden="true" /></span>
            <h2 className="text-[26px] font-bold">{COPY.sent}</h2>
            <p className="text-[17px] leading-relaxed text-[#3a3f4b]" dir="auto">{COPY.sentSub(first)}</p>
            <p className="flex items-start gap-2.5 rounded-xl bg-white p-3.5 text-left text-[15px] leading-snug text-[#3a3f4b]" dir="auto">
              <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />{COPY.sentNext(first)}
            </p>
            <Link to={`/portal/leader/observe/${sessionId}`}
              className="mt-2 flex h-[60px] w-full items-center justify-center rounded-[14px] bg-primary text-[19px] font-bold text-white">{COPY.openObservation}</Link>
            <Link to="/portal/leader/observations"
              className="flex h-14 w-full items-center justify-center rounded-[14px] border-2 border-primary bg-white text-lg font-bold text-primary">{COPY.backToObservations}</Link>
          </div>
        )}
      </div>
    </PortalLayout>
  );
};

export default LeaderObserveRecord;
