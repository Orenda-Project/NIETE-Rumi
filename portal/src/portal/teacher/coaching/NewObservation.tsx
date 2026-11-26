import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Check, ChevronDown, ImageIcon, Mic, Pause, Save, Send, Square, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clockText } from '../../lib/clockText';
import { acceptFor, AUDIO_ACCEPT, checkAudioFile, checkFile, DC_MAX_PHOTOS, DC_MIN_SECONDS, readAudioDuration } from '../../lib/coachingUpload';
import { isOffline, SendError, sendLesson } from '../../lib/coachingSend';
import { holdFile, holdPhoto, isFileRefused, isRefused, tellUnreadablePick } from '../../lib/pickedRead';
import { sha256Hex } from '../../lib/audioHash';
import { loadGradeSubjects, type GradeSubject } from '../../lib/gradeSubjects';
import { lessonFilename, useMicLevel } from '../../lib/recordFlow';
import { useRecordingClock, useRecordingSession } from '../../lib/recordingSession';
import { deleteRecording, listKept, readKept, type KeptRecording } from '../../lib/recordingStore';
import { linkOf, newAttemptId } from '../../lib/recordingLink';
import { pkTime } from '../../coach/reports/data';
import { KeptRecordingCard, teacherKeptFrom, useClassLabel, type TeacherKept } from './keptCard';
import { withDuration } from '../../lib/webmDuration';
import { useRecordingResume } from '../../lib/recordingResume';
import { tellSent } from '../../lib/recordingBeat';
import { isInAppBrowser } from '@/lib/runtime';
import { getRecentPlans, planChips, pickOf } from '../../newui/coaching/coachingApi';
import { LevelBars } from '../../newui/coaching/LevelBars';
import { LiveMovesPanel } from '../../newui/coaching/LiveMovesList';
import { PlanSheet } from '../../newui/coaching/PlanSheet';
import { useLiveMoves } from '../../newui/coaching/useLiveMoves';
import type { Audio } from '../../newui/coaching/useSendFlow';
import { lessonPlans } from '../../newui/lessons/lessonPlansApi';
import { dataOf, useLoad } from '../../newui/lessons/shared';
import { portal } from '../../services/api';
import TeacherPage from '../TeacherPage';
import { teacherPath } from '../routes';
import { ClassPicker, ConfirmTray, HistoryRow, LeaveNote, ProgressSteps, RecordUploadPair, Tray, type SubjectsByGrade } from '../ui';
import { CARD, FOCUS, LIST_CARD } from '../ui/styles';
import { useCopy } from '../i18n';
import { NOTICES } from '../notices/copy';
import { COACHING } from './copy';
import { notSentTitle } from './notSent';
import { clearDraft, holdDraft, isSavedAudio, peekDraft, planKeyOf, readPrefill, type DcAudio, type DraftClass, type DraftPlan, type SavedAudio } from './draft';
import { loadPending, sentBefore, type PendingRecording } from './api';
import { DC_PICK } from './libraryPick';
import { libraryKeyFor, sameSubjectName } from '../../lib/classKey';
import { lessonsUrl, openUrl } from '../lessons/paths';
import { micBlockedLine, micPermissionDenied } from './micBlocked';
import { Action, Dock, FlowStep, PhotoGrid, PlanPicker, RecordingCard, WaitingRecording } from './parts';
import { COACHING_HOME, COACHING_NEW, lessonPath } from './paths';
import { dcSteps } from './report';
import { ClassCheck, Reflection, stoppedLine } from './reportLive';
import { DuplicateNote } from './ReportPage';
import { useDcReport } from './useDcReport';

/**
 * Digital Coaching's one screen (design v6): Start DC observation on the main page opens it, and she never leaves it.
 * Each step opens once the one before is done:
 *
 *   1 Grade and subject   the kit's ClassPicker, as Lesson Plans and Assessment have it (every grade, the Lesson Plans
 *                         catalogue, hers starred), in the grade colours. Sent with the lesson as teacherClass.
 *   2 Lesson plan         optional: one Lesson plan button; its tray has her recent plans, the library, a photo or a file.
 *                         Before the recording (operator, 16 Oct); it opens with it, so it never holds the recording back.
 *   3 Recording           Start recording records HERE (clock, level, Pause, Stop and "Yes, finish"); the recording bar's
 *                         Return comes back here. Or Upload recording. Then Listen / Redo / Change file.
 *   4 Photos              up to ten, No faces.
 *   Submit                sends exactly that, with the class, and moves to a second screen (operator, 16 Oct): the
 *                         upload %, then the lesson's progress (Analysing → Reflection question → Report ready), the
 *                         question answered there and the leave note. Nothing on it can be changed, and the history
 *                         entry of the editable screen is replaced, so Back goes to the main page, never to the edits.
 *                         Its address is ?sent=uploading while uploading, then ?sent=<session>, so a reload finds the
 *                         lesson (a reload mid-upload has lost the upload: the main page). A send that fails comes back
 *                         to her screen with everything she chose. The main page lists it under Analysing until ready.
 *
 * Save recording         bd-bmc9a0.2 (ICT IAB row 31): under the recording once it can be sent. It sends exactly what
 *                        Submit sends, marked saveForLater, so the recording is on the server and the analysis runs —
 *                        nothing on the phone can lose it — and the screen says it is saved (?saved=<session>) instead
 *                        of walking her through the progress. The lesson is on the main page; its own page carries
 *                        the reflection and the report, and if she never comes back the bot sends the report to her
 *                        chat after 24 hours (row 32, stale-session sweep).
 *
 * What she has chosen is held in memory (draft.ts) so a trip to the library or her lesson plan, and Back, finds it.
 * Opened from a lesson plan (?grade&subject&plan) the class and the plan arrive filled in.
 */

/** bd-bsc0ox: 'wont_open' — the phone would not read the recording she picked ('File will not open'). */
type AudioProblem = 'too_large' | 'not_audio' | 'video' | 'wont_open' | null;
type RecPhase = 'idle' | 'starting' | 'recording' | 'micBlocked';
type Sending = { pct: number } | null;
const UPLOADING = 'uploading';

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
  const [audio, setAudio] = useState<DcAudio | null>(kept?.audio ?? null);
  const [audioProblem, setAudioProblem] = useState<AudioProblem>(null);
  const [plan, setPlan] = useState<DraftPlan | null>(kept?.plan ?? null);
  // bd-bsc0ox: 'wont_open' — her plan file would not open when she picked it; said on the screen, the tray is closed.
  const [planProblem, setPlanProblem] = useState<'not_a_plan' | 'wont_open' | null>(null);
  const [planSheet, setPlanSheet] = useState(() => !!(location.state as { openPlan?: boolean } | null)?.openPlan);
  const [photos, setPhotos] = useState<File[]>(kept?.photos ?? []);
  const audioInput = useRef<HTMLInputElement>(null);
  const [recordTray, setRecordTray] = useState(false);

  useEffect(() => { holdDraft({ audio, plan, photos, cls }); }, [audio, plan, photos, cls]);

  // bd-c5reix — her classroom recordings sent on WhatsApp, kept and waiting (a failed read is none). The WhatsApp link
  // lands with ?recording=whatsapp (the newest); the main page's banner with ?recording=<id>. One she has sent before
  // is never attached: the repeat note says so, with its report.
  const [pending] = useLoad(loadPending, 'dc:pending');
  const waitingList = useMemo(() => dataOf(pending) ?? [], [pending]);
  // picked: a file she chose (the note also offers another); else a waiting recording.
  const [repeat, setRepeat] = useState<{ sessionId: string; picked?: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const attachWaiting = (rec: PendingRecording) => {
    setAudioProblem(null);
    if (rec.duplicateOf) { setRepeat({ sessionId: rec.duplicateOf.sessionId }); return; }
    setRepeat(null);
    const saved: SavedAudio = {
      kind: 'saved', key: rec.key, id: rec.id, listenUrl: rec.listenUrl, durationMs: rec.seconds != null ? rec.seconds * 1000 : null,
    };
    setAudio(saved);
  };
  const wanted = useMemo(() => new URLSearchParams(location.search).get('recording'), [location.search]);
  const tookWanted = useRef(false);
  useEffect(() => {
    if (tookWanted.current || !wanted || pending.status !== 'ok') return;
    tookWanted.current = true;
    const rec = wanted === 'whatsapp' ? pending.data[0] : pending.data.find((r) => r.id === wanted);
    if (rec && !audio) attachWaiting(rec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, pending]);

  // Opened from a lesson plan: the plan's class and that plan (named from her recent plans). bd-fgj73x.10: the class
  // always comes with the plan (operator, 19 Oct) — hers when it is one of her classes (by her subject key, the
  // catalogue key or the name), else the plan's own grade and subject from the lesson catalogue (or the name the link
  // carries, from Recent / All lesson plans). It used to be filled in only when the link named one of HER classes.
  const prefilled = useRef(!!kept);
  useEffect(() => {
    if (prefilled.current || (!prefill.pick && prefill.grade == null)) return;
    if (combos.status === 'loading' || combos.status === 'idle' || recentPlans.status === 'loading' || recentPlans.status === 'idle') return;
    if (cat.status === 'loading' || cat.status === 'idle') return;
    prefilled.current = true;
    if (prefill.grade != null) {
      const g = prefill.grade;
      const book = (catalogue?.byGrade[g] ?? []).find((s) => (prefill.lpSubject != null && s.key === prefill.lpSubject)
        || (prefill.subjectName != null && sameSubjectName(s.name, prefill.subjectName)));
      const name = book?.name ?? prefill.subjectName;
      const hers = mine.find((c) => c.grade === g && (
        (prefill.subjectKey != null && norm(c.subjectKey) === norm(prefill.subjectKey))
        || (prefill.lpSubject != null && norm(c.featureKey) === norm(prefill.lpSubject))
        || (name != null && sameSubjectName(c.subject, name))));
      // bd-1p5nkt: the class keeps its catalogue key, so the library opens its own subject.
      if (hers) setCls({ grade: hers.grade, subject: hers.subject, subjectKey: hers.subjectKey ?? null, featureKey: hers.featureKey ?? null });
      else if (name) setCls({ grade: g, subject: name, subjectKey: null, featureKey: book?.key ?? null });
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
  }, [prefill, combos, recentPlans, cat, catalogue, mine, C]);

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
  // bd-v0toag.31.4 — group D: the moves for the plan she chose, while she records here (the server says who gets them).
  const live = useLiveMoves({ session, plan, recording: phase === 'recording' });
  // Finished somewhere else (Logout's "Stop & log out"): nothing is recording here any more.
  useEffect(() => { if (phase === 'recording' && session && !session.active) setPhase('idle'); }, [phase, session, session?.active]);

  const startRecording = async () => {
    if (!session) return;
    setAudioProblem(null);
    setPhase('starting');
    // bd-ma9jiy (26 Nov ~15:10): a new lesson is a new attempt — its own file, never another's.
    attemptRef.current = newAttemptId();
    const result = await session.start({
      returnTo: COACHING_NEW, beat: { kind: 'dc', attemptId: attemptRef.current },
      linkExtra: cls ? { grade: cls.grade, subject: cls.subject } : undefined,
    });
    setPhase(result === 'recording' ? 'recording' : 'micBlocked');
  };
  /** bd-ma9jiy: Resume — on a recording reopened from the phone it opens the microphone first. */
  const resumeRecording = () => {
    if (!session) return;
    const r = session.resume();
    if (r) void r.then((x) => { if (x === 'micBlocked') setPhase('micBlocked'); });
  };
  const finishRecording = async () => {
    if (!session) return;
    const out = await session.finish();
    setPhase('idle');
    if (!out) return;
    // bd-ma9jiy: one reopened from the phone shows before a class too, like a recording taken back from the phone.
    const wasKept = restored;
    setRestored(null);
    const rec: Audio = {
      blob: out.blob, filename: lessonFilename(out.type.ext, wasKept ? new Date(wasKept) : undefined), durationMs: out.durationMs,
      recordingId: out.id, source: wasKept ? 'resumed' : 'recorded', size: out.blob.size, startedAt: wasKept,
    };
    // Her ticks and taps are held with this recording (a trip to the library keeps them) and go with Submit.
    holdDraft({ audio: rec, plan, photos, cls, live: live.toRecord() });
    setAudio(rec);
  };
  /**
   * bd-bsc0ox (queue #200) — production, 18 Nov: in the Android app a teacher's picked recording would not open at
   * Submit (8 tries in 3 minutes, NotReadableError, nothing sent); it went only once she picked it again. So it is read
   * the moment she picks it and the screen keeps those bytes (lib/pickedRead holdFile, as photos since bd-r2uzg1.9 and
   * the coach's files since bd-tymy1n); one the phone will not open is refused here, "File will not open", and logged.
   */
  const pickAudio = async (picked: File | undefined) => {
    setAudioProblem(null);
    if (!picked) return;
    // bd-i0u6n2: a video is refused on its own line; a file the phone marks as audio is taken whatever its name.
    const checked = await checkAudioFile(picked);
    if (checked.problem) {
      setAudioProblem(checked.problem === 'too_large' ? 'too_large' : checked.problem === 'video' ? 'video' : 'not_audio');
      return;
    }
    const held = await holdFile(picked);
    if (isFileRefused(held)) {
      tellUnreadablePick('audio', picked, held.errName);
      setAudioProblem('wont_open');
      return;
    }
    const file = held.file;
    const seconds = await readAudioDuration(file);
    // bd-c5reix — the same bytes as a recording she sent before: said now, before anything is uploaded. The one it
    // replaces is let go first, so nothing is armed while the file is checked, nor after a repeat.
    setRepeat(null);
    setAudio(null);
    setChecking(true);
    let before: Awaited<ReturnType<typeof sentBefore>> = null;
    try {
      const sha = await sha256Hex(file);
      before = sha ? await sentBefore(sha) : null;
    } finally {
      setChecking(false);
    }
    if (before) { setRepeat({ sessionId: before.sessionId, picked: true }); return; }
    setPhase('idle');
    setAudio({
      blob: file, filename: checked.filename || picked.name, durationMs: seconds != null ? seconds * 1000 : null,
      recordingId: null, source: 'file', size: picked.size, startedAt: null,
    });
  };
  /**
   * bd-bsc0ox — her own plan (a photo or a file from the tray), read the moment she picks it like the recording. It shows
   * at once; the screen's copy takes its place when the read is done, and one the phone will not open is taken off
   * again with "File will not open" (and logged).
   */
  const pickPlanFile = (picked: File | undefined, asPhoto: boolean): boolean => {
    setPlanProblem(null);
    if (!picked) return false;
    if (checkFile(picked, 'lesson_plan')) { setPlanProblem('not_a_plan'); return false; }
    setPlan({ kind: 'file', file: picked, asPhoto });
    void holdFile(picked).then((out) => {
      const still = (p: DraftPlan | null) => !!p && p.kind === 'file' && p.file === picked;
      if (isFileRefused(out)) {
        tellUnreadablePick('lesson_plan', picked, out.errName);
        setPlan((p) => (still(p) ? null : p));
        setPlanProblem('wont_open');
        return;
      }
      setPlan((p) => (still(p) ? { kind: 'file', file: out.file, asPhoto } : p));
    });
    return true;
  };
  /**
   * bd-ma9jiy (queue #262; the operator 25 Nov: "show them the same UI that you show somebody when they pause") — with
   * portal_recording_resume on for her, the recording this phone kept is not a "Not sent" card: it IS the recording on
   * this screen, PAUSED, its clock at the saved length. Resume carries on in the same recording; Stop gives it to step 3.
   * Only a WebM one (the code joins WebM parts); anything else keeps the card. `restored`: when it was started.
   */
  const resumeOn = useRecordingResume();
  const [restored, setRestored] = useState<string | null>(null);
  // bd-ma9jiy.3 (queue #262; the operator 26 Nov ~11:10) — a lesson cut mid-way is not reopened on arrival: the screen says
  // "Your recording was paused abruptly." with ONE Continue recording on top (no Recording choices); the press reopens it
  // PAUSED (Resume / Stop, as any paused lesson). `pausedKept`: the kept recording waiting for that press.
  const [pausedKept, setPausedKept] = useState<KeptRecording | null>(null);
  // bd-ma9jiy (26 Nov ~15:10): the attempt this screen records (made at Start, or the kept one continued); the take a DC
  // page card named (?kept=); her other kept takes, each on its own card; "Record a different lesson" pressed.
  const attemptRef = useRef<string | null>(null);
  const keptParam = new URLSearchParams(location.search).get('kept');
  const [keptCards, setKeptCards] = useState<TeacherKept[]>([]);
  const [newLesson, setNewLesson] = useState(false);
  const classLabel = useClassLabel();
  /** A kept take becomes THIS screen's recording, on its own (the operator: never joined to another). */
  const attachKept = async (id: string) => {
    const k = await readKept(id);
    if (!k || !mounted.current) return;
    attemptRef.current = linkOf(k.meta)?.attemptId ?? null;
    const blob = await withDuration(k.blob, k.meta.ext, k.meta.elapsedMs);
    if (!mounted.current) return;
    setKeptCards((cards) => cards.filter((c) => c.id !== id));
    setAudioProblem(null);
    setAudio({
      blob, filename: lessonFilename(k.meta.ext, new Date(k.meta.startedAt)), durationMs: k.meta.elapsedMs || null,
      recordingId: k.meta.id, source: 'resumed', size: blob.size, startedAt: k.meta.startedAt,
    });
  };
  const recorderRef = useRef<HTMLElement | null>(null);
  // Read once, on arrival, on its own (not from the Not sent card's read): the newest recording kept on this phone.
  const triedRestore = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (resumeOn !== true || triedRestore.current || !session || session.active || audio || phase !== 'idle') return;
    triedRestore.current = true;
    // bd-ma9jiy (queue #262; the operator 26 Nov ~15:10: "note which observation is the one that's being recorded. So
    // they can also store 2 at a time") — every kept take is its own attempt. On arrival:
    //   ?kept=<id> (a card on the DC page)  THAT recording: paused → Continue recording; otherwise it is this screen's
    //   nothing named                       the newest lesson cut minutes ago (#292's rule) offers Continue for ITS attempt;
    //                                       every other kept take is a card of its own (Add details & send attaches it)
    // Never one appended to another; an unlinked take (kept before attempts) is never reopened.
    Promise.resolve().then(() => listKept()).then(async (all) => {
      if (!mounted.current || session.active) return;
      const mine = teacherKeptFrom(all, Date.now());
      const named = keptParam ? mine.find((it) => it.id === keptParam) ?? null : null;
      const resumable = (it: TeacherKept | null | undefined) => !!it && it.offer === 'resume' && !it.unlinked;
      const pick = keptParam ? named : mine.find(resumable) ?? null;
      if (pick && resumable(pick)) {
        const k = await readKept(pick.id);
        if (!mounted.current) return;
        if (k && k.meta.ext === '.webm') setPausedKept(k);
        else if (k) await attachKept(pick.id);
      } else if (named) {
        await attachKept(named.id);
      }
      if (mounted.current) setKeptCards(mine.filter((it) => it.id !== pick?.id));
    }).catch(() => { /* nothing kept: the screen as before */ });
  }, [resumeOn, session, audio, phase]);
  const continueKept = (chosen?: KeptRecording) => {
    const k = chosen ?? pausedKept;
    if (!k || !session || session.active) return;
    setPausedKept(null);
    setNewLesson(false);
    // bd-ma9jiy (26 Nov ~15:10): THAT attempt's recording, and its attempt carried on.
    attemptRef.current = linkOf(k.meta)?.attemptId ?? null;
    session.restore({ returnTo: COACHING_NEW, kept: k, beat: { kind: 'dc', ...(attemptRef.current ? { attemptId: attemptRef.current } : {}) } });
    setRestored(k.meta.startedAt);
    setPhase('recording');
    setTimeout(() => { try { recorderRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); } catch { /* fine */ } }, 50);
  };
  /** bd-ma9jiy: another paused lesson's card — read that file and continue IT (the one on the block stays kept). */
  const continueById = async (id: string) => {
    const k = await readKept(id);
    if (!k || !mounted.current) return;
    if (k.meta.ext !== '.webm') { await attachKept(id); return; }
    setKeptCards((cards) => {
      const rest = cards.filter((c) => c.id !== id);
      const prev = pausedKept;
      if (!prev || prev.meta.id === id) return rest;
      const l = linkOf(prev.meta);
      return [{ id: prev.meta.id, offer: 'resume', unlinked: false, attemptId: l?.attemptId ?? null, grade: l?.grade ?? null,
        subject: l?.subject ?? null, startedAt: prev.meta.startedAt, elapsedMs: prev.meta.elapsedMs }, ...rest];
    });
    continueKept(k);
  };
  const redo = async () => {
    const id = isSavedAudio(audio) ? null : audio?.recordingId;
    if (id) { try { await deleteRecording(id); } catch { /* gone */ } }
    setAudio(null);
    setAudioProblem(null);
  };

  // Submit, and what came of it — on this screen.
  const [sending, setSending] = useState<Sending>(null);
  const [failure, setFailure] = useState<SendError | null>(null);
  // The second screen (after Submit) is ?sent=uploading, then ?sent=<session>.
  const sentParam = new URLSearchParams(location.search).get('sent');
  const [sessionId, setSessionId] = useState<string | null>(() => (sentParam && sentParam !== UPLOADING ? sentParam : null));
  // bd-bmc9a0.2 — saved for later: ?saved=<session>. Nothing is polled; the lesson's own page carries it on.
  const [savedId, setSavedId] = useState<string | null>(() => new URLSearchParams(location.search).get('saved'));
  const report = useDcReport(sessionId);
  // bd-bmc9a0.1 — what already arrived from this screen, by file: Try again sends only the part that did not go.
  const uploaded = useRef(new WeakMap<Blob, string>());
  // bd-bmc9a0.2 — Try again repeats what she asked for: a failed Save is saved again, never turned into a Submit.
  const lastSave = useRef(false);
  /**
   * bd-r2uzg1.9 (ICT IAB row 29) — `photos`: what to send when it is not the grid as drawn — "Send without it" sends
   * the grid less the photo that would not open, at once, before the state has caught up.
   */
  const submit = async ({ saveForLater = false, photos: these = photos }: { saveForLater?: boolean; photos?: File[] } = {}) => {
    if (!audio || !cls) return;
    lastSave.current = saveForLater;
    setFailure(null);
    setSending({ pct: 0 });
    navigate(`${COACHING_NEW}?sent=${UPLOADING}`, { replace: true });
    try {
      const { coachingSessionId } = await sendLesson({
        audio: isSavedAudio(audio) ? { key: audio.key } : { blob: audio.blob, filename: audio.filename },
        plan: plan ? (plan.kind === 'library' ? { kind: 'library', pick: plan.pick } : { kind: 'file', file: plan.file }) : null,
        photos: these,
        teacherClass: { grade: cls.grade, subject: cls.subject, ...(cls.subjectKey ? { subjectKey: cls.subjectKey } : {}) },
        liveMoves: peekDraft()?.live ?? null,
        uploaded: uploaded.current,
        ...(saveForLater ? { saveForLater: true } : {}),
      }, portal, (pct) => setSending({ pct }));
      if (!isSavedAudio(audio) && audio.recordingId) {
        // bd-ma9jiy: the heartbeat's recording joined to the coaching session it became.
        tellSent(audio.recordingId, { kind: 'dc', ...(attemptRef.current ? { attemptId: attemptRef.current } : {}) }, coachingSessionId);
        try { await deleteRecording(audio.recordingId); } catch { /* gone */ }
      }
      clearDraft();
      if (saveForLater) {
        setSavedId(coachingSessionId);
        navigate(`${COACHING_NEW}?saved=${encodeURIComponent(coachingSessionId)}`, { replace: true });
        return;
      }
      setSessionId(coachingSessionId);
      navigate(`${COACHING_NEW}?sent=${encodeURIComponent(coachingSessionId)}`, { replace: true });
    } catch (err) {
      setFailure(err instanceof SendError ? err : new SendError('network', undefined, undefined, { part: null, offline: isOffline(), unreadable: false }));
      navigate(COACHING_NEW, { replace: true });
    } finally {
      setSending(null);
    }
  };

  /**
   * bd-r2uzg1.9 — ICT IAB row 29: photo N would not open at Submit (the phone had lost the photo it picked; she pressed
   * Submit up to 94 times on one). Change photo picks one in its place, read at once like any photo; Send without it
   * sends the rest now. Either way one photo never holds the lesson back.
   */
  const changeInput = useRef<HTMLInputElement>(null);
  const [changeProblem, setChangeProblem] = useState<'not_a_photo' | 'wont_open' | null>(null);
  useEffect(() => { setChangeProblem(null); }, [failure]);
  const badPhoto = failure?.kind === 'network' && failure.detail?.unreadable && failure.detail.part?.kind === 'photo'
    ? failure.detail.part.photo : 0;
  const changePhoto = async (picked: File | undefined) => {
    setChangeProblem(null);
    if (!picked || !badPhoto) return;
    if (checkFile(picked, 'photo')) { setChangeProblem('not_a_photo'); return; }
    const out = await holdPhoto(picked);
    if (isRefused(out)) { setChangeProblem(out.problem); return; }
    const held = out.file;
    setPhotos((now) => now.map((p, i) => (i === badPhoto - 1 ? held : p)));
    setFailure(null);
  };
  const sendWithout = () => {
    if (!badPhoto) return;
    const rest = photos.filter((_, i) => i !== badPhoto - 1);
    setPhotos(rest);
    setChangeProblem(null);
    void submit({ saveForLater: lastSave.current, photos: rest });
  };

  // From the library (bd-fgj73x.5): her class's chapters, to CHOOSE a plan (lessons/ pages with pick=dc; a tap attaches it
  // and comes back here). The class is named in the library's own subject key; one it does not know: Lesson Plans.
  const libraryHref = () => {
    // bd-1p5nkt (ICT DC rows 146, 147): by the class's catalogue key — never an Urdu name cleaned to nothing.
    const key = cls ? libraryKeyFor(cls, catalogue?.byGrade[cls.grade]) : null;
    return cls && key
      ? lessonsUrl('chapters', { grade: cls.grade, subject: key, key: cls.subjectKey, pick: DC_PICK })
      : teacherPath('lessons');
  };
  // The eye on her attached library plan: open it to read; Back comes back here (the draft is held).
  const viewPlan = plan && plan.kind === 'library' && planKeyOf(plan.pick)
    ? () => {
      holdDraft({ audio, plan, photos, cls });
      navigate(openUrl({
        plan: planKeyOf(plan.pick) as string,
        lang: 'lang' in plan.pick ? plan.pick.lang : null,
        title: plan.title,
        grade: cls?.grade ?? null,
        from: 'dc',
      }));
    }
    : undefined;

  // At least 15 minutes (bd-fgj73x.7): a shorter recording cannot be submitted. An unknown length is not held back.
  const tooShort = !!audio && audio.durationMs != null && audio.durationMs < DC_MIN_SECONDS * 1000;
  const ready = !!cls && !!audio && !tooShort;
  const after = !!sessionId || !!sending || !!savedId;
  // Reloaded mid-upload: that upload is gone, and there is nothing to show; the main page lists what did arrive.
  const reloadedMidUpload = useRef(sentParam === UPLOADING);
  useEffect(() => {
    if (reloadedMidUpload.current) navigate(COACHING_HOME, { replace: true });
  }, [navigate]);
  const s1 = cls ? 'done' : 'now';
  // Lesson plan before the recording (operator, 16 Oct): both open once a class is picked; the plan is optional, so it
  // never holds the recording back.
  const s2 = !cls ? 'upcoming' : plan ? 'done' : 'now';
  const s3 = !cls ? 'upcoming' : audio && !tooShort ? 'done' : 'now';
  const s4 = !ready ? 'upcoming' : photos.length ? 'done' : 'now';
  const micLine = micBlockedLine({ browserBlocked, retried: micTries > 0, inApp: isInAppBrowser() }, C);
  const progress = report.state.progress;
  // bd-aqotzx — "No, record again": that session is closed; this screen comes back with her class, plan and photos.
  const recordAgain = () => {
    setSessionId(null);
    setAudio(null);
    setAudioProblem(null);
    navigate(COACHING_NEW, { replace: true });
  };

  const dock = after || sending
    ? undefined
    : phase === 'recording'
      ? (
        <Dock>
          <Action tone="outline" icon={session?.paused ? Mic : Pause} onClick={() => { if (session?.paused) resumeRecording(); else session?.pause(); }}>
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
        accept={AUDIO_ACCEPT}
        onChange={(e) => { void pickAudio(e.target.files?.[0]); e.target.value = ''; }}
      />

      {!after ? (
        <>
          {/* bd-ma9jiy (26 Nov ~15:10): the lesson cut minutes ago, with ITS class — Continue reopens that one only; a
              different lesson is its own new recording (the paused one stays kept, on its card). */}
          {pausedKept && !newLesson && !audio && phase === 'idle' ? (
            <>
              <RecordUploadPair paused={{
                onPress: () => continueKept(), testId: 'dc-continue-kept',
                label: [classLabel({ grade: linkOf(pausedKept.meta)?.grade ?? null, subject: linkOf(pausedKept.meta)?.subject ?? null }), pkTime(pausedKept.meta.startedAt)].filter(Boolean).join(' · ') || undefined,
              }} />
              <button type="button" data-testid="dc-different-lesson" onClick={() => setNewLesson(true)}
                className={cn('mx-auto flex min-h-[48px] items-center justify-center rounded-full border border-[#d1d5db] bg-white px-5 text-[15px] font-medium text-[#4b5563]', FOCUS)}>
                {C.differentLesson}
              </button>
            </>
          ) : null}
          {/* Her other kept takes, each its own card (and the paused one, once she chose a different lesson). */}
          {resumeOn === true && !audio && phase === 'idle' ? (
            <>
              {pausedKept && newLesson ? (
                <KeptRecordingCard item={{ id: pausedKept.meta.id, offer: 'resume', unlinked: false, attemptId: linkOf(pausedKept.meta)?.attemptId ?? null,
                  grade: linkOf(pausedKept.meta)?.grade ?? null, subject: linkOf(pausedKept.meta)?.subject ?? null,
                  startedAt: pausedKept.meta.startedAt, elapsedMs: pausedKept.meta.elapsedMs }} onPress={() => continueKept()} />
              ) : null}
              {keptCards.map((it) => (
                <KeptRecordingCard key={it.id} item={it} onPress={() => {
                  // A paused lesson's own card reopens THAT one (never as a finished take); any other attaches on its own.
                  if (it.offer === 'resume' && !it.unlinked) void continueById(it.id); else void attachKept(it.id);
                }} />
              ))}
            </>
          ) : null}
          <FlowStep n={1} state={s1}>{C.gradeAndSubject}</FlowStep>
          <ClassPicker
            label={C.gradeAndSubject}
            combos={mine}
            subjectsByGrade={byGrade}
            value={cls ? { grade: cls.grade, subject: cls.subject } : null}
            onChange={(v, pick) => {
              const key = pick.combo && typeof pick.combo.subjectKey === 'string' ? pick.combo.subjectKey : null;
              // bd-1p5nkt: one of her classes carries its lesson-plan catalogue key; any other pick is found by its exact name.
              const featureKey = pick.combo && typeof pick.combo.featureKey === 'string' ? pick.combo.featureKey : null;
              setCls({ grade: v.grade, subject: v.subject, subjectKey: key, featureKey });
              setPlan((p) => (p && p.kind === 'library' && cls && (cls.grade !== v.grade || cls.subject !== v.subject) ? null : p));
            }}
            gradeColours
          />

          <FlowStep n={2} state={s2} chips={[C.optional]}>{C.lessonPlan}</FlowStep>
          {/* While she records, the plan she picked stays in sight, to read with the eye (operator, 16 Oct); no Change
              mid-lesson. The recording goes on in the background while the plan is open (the frame's recording bar). */}
          {cls && phase === 'recording' && plan ? <PlanPicker plan={plan} readOnly onOpen={() => {}} onView={viewPlan} /> : null}
          {cls && phase !== 'recording' ? (
            <>
              {/* Her recent plans, the library, a photo or a file are all in the Lesson plan tray (operator, 16 Oct). */}
              <PlanPicker plan={plan} onOpen={() => { setPlanProblem(null); setPlanSheet(true); }} onView={viewPlan} />
              {planProblem === 'wont_open' ? <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{C.fileWontOpen}</p> : null}
            </>
          ) : null}

          <FlowStep n={3} state={s3} chips={[C.atLeastMinutes]}>{C.stepRecording}</FlowStep>
          {(cls || restored || session?.active) && !audio && phase === 'recording' ? (
            <section ref={recorderRef} aria-label={C.recording} className={cn(CARD, 'flex flex-col items-center gap-4 border-2 border-[#c8331f] px-4 py-5')}>
              <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold', session?.paused ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#fee4e2] text-[#c8331f]')}>
                {session?.paused ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <i aria-hidden="true" className="h-2 w-2 rounded-full bg-[#c8331f] motion-safe:animate-pulse" />}
                {session?.paused ? C.paused : C.recording}
              </span>
              <span role="timer" data-testid="dc-record-clock" className="text-[48px] font-light leading-none tracking-[-0.02em] tabular-nums">{clockText(elapsed)}</span>
              <LevelBars live={!session?.paused} level={level} />
              <span className="text-[13px] font-medium text-[#6b7280]">{C.keepAppOpen}</span>
              {live.state ? <div className="w-full"><LiveMovesPanel live={live} /></div> : null}
            </section>
          ) : null}
          {cls && !audio && phase === 'starting' ? (
            <p aria-live="polite" className="mx-1 text-[15px] font-semibold text-[#6b7280]">{C.starting}</p>
          ) : null}
          {(cls || restored) && !audio && phase === 'micBlocked' ? (
            <section className={cn(CARD, 'flex flex-col gap-3 p-4')}>
              <span className="text-[17px] font-semibold text-[#c8331f]">{C.micBlocked}</span>
              <p className="m-0 text-[15px] leading-[1.5] text-[#4b5563]">{micLine}</p>
              <Dock>
                <Action onClick={() => {
                  setMicTries((n) => n + 1);
                  // bd-ma9jiy: a reopened recording tries its Resume again (it is still the session, paused).
                  if (restored && session?.active) { setPhase('recording'); resumeRecording(); } else void startRecording();
                }}>{C.tryAgain}</Action>
                <Action tone="outline" icon={Upload} onClick={() => audioInput.current?.click()}>{C.uploadRecording}</Action>
              </Dock>
            </section>
          ) : null}
          {repeat ? (
            <section data-testid="dc-repeat" className="flex flex-col gap-3">
              <DuplicateNote lead={C.duplicateBeforeLead} next={C.duplicateRecordingNext} />
              <div className="flex gap-3">
                <Action to={lessonPath(repeat.sessionId)}>{C.openReport}</Action>
                {repeat.picked ? (
                  <Action tone="outline" icon={Upload} onClick={() => audioInput.current?.click()}>{C.selectAnother}</Action>
                ) : null}
              </div>
            </section>
          ) : null}
          {checking ? <p aria-live="polite" className="mx-1 text-[15px] font-semibold text-[#6b7280]">{C.checking}</p> : null}
          {cls && !audio && !checking && phase === 'idle' ? waitingList.map((rec) => (
            <WaitingRecording key={rec.key} rec={rec} onPress={() => attachWaiting(rec)} />
          )) : null}
          {cls && !audio && !checking && phase === 'idle' && !(pausedKept && !newLesson) ? (
            <>
              {/* Recording is one card that opens a tray with the two choices, as Grade and subject does (operator,
                  16 Oct). A choice closes the tray. */}
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={recordTray}
                onClick={() => setRecordTray(true)}
                className={cn(
                  'flex w-full min-h-[76px] items-center gap-3 rounded-2xl bg-white px-3 py-2.5 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)]',
                  recordTray ? 'border-2 border-[#33374a]' : 'border border-[#e5e7eb]',
                  FOCUS,
                )}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-dashed border-[#c7cad6] bg-[#f9fafb] text-[#6b7280]">
                  <Mic className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-[17px] font-semibold leading-[1.3]">{C.recording}</span>
                <ChevronDown className="h-[22px] w-[22px] shrink-0 text-[#6b7280]" strokeWidth={2.4} aria-hidden="true" />
              </button>
              <Tray open={recordTray} title={C.recording} onClose={() => setRecordTray(false)}>
                <RecordUploadPair
                  onRecord={() => { setRecordTray(false); void startRecording(); }}
                  onUpload={() => { setRecordTray(false); audioInput.current?.click(); }}
                  copy={{ startRecording: C.recordTitle, uploadRecording: C.uploadRecording }}
                />
              </Tray>
            </>
          ) : null}
          {/* A recording kept from WhatsApp, or one taken back from the phone (bd-r2uzg1.18.8), shows before a class too. */}
          {audio && (cls || isSavedAudio(audio) || audio.source === 'resumed') ? (
            <RecordingCard audio={audio} onRedo={() => { void redo(); }} onChangeFile={() => audioInput.current?.click()} full={resumeOn === true} />
          ) : null}
          {/* bd-bmc9a0.2 — ICT IAB row 31: Save recording, under the recording, once it could be sent (the same rule as
              Submit: a class and at least 15 minutes). */}
          {ready && phase !== 'recording' ? (
            <button
              type="button"
              onClick={() => { void submit({ saveForLater: true }); }}
              className={cn('flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#2f7a52] bg-white text-[17px] font-semibold text-[#2f7a52]', FOCUS)}
            >
              <Save className="h-5 w-5" aria-hidden="true" />
              {C.saveRecording}
            </button>
          ) : null}
          {audio && cls && tooShort ? (
            <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{C.tooShort}</p>
          ) : null}
          {audioProblem ? (
            <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{audioProblem === 'too_large' ? C.tooLarge : audioProblem === 'video' ? C.notVideo : audioProblem === 'wont_open' ? C.fileWontOpen : C.notAudio}</p>
          ) : null}

          <FlowStep n={4} state={s4} chips={[C.upToPhotos(DC_MAX_PHOTOS), C.noFaces]}>{C.photos}</FlowStep>
          {ready ? (
            <>
              <p className="mx-1 -mt-1 whitespace-pre-line text-[14px] text-[#6b7280]">{C.photosHint}</p>
              <PhotoGrid photos={photos} onChange={setPhotos} testId="dc-photos-input" max={DC_MAX_PHOTOS} camera readOnPick />
            </>
          ) : null}

          {failure ? (
            <section role="alert" className={cn(CARD, 'flex flex-col gap-3 p-4')}>
              <span className="text-[17px] font-semibold text-[#c8331f]">
                {failure.kind === 'network' ? notSentTitle(failure, C)
                  : failure.kind === 'in_progress' ? C.busy
                    : failure.kind === 'already_sent' ? C.alreadySent
                    : failure.kind === 'plan_not_ready' || failure.kind === 'plan_not_found' ? C.planNotUsed
                      : failure.kind === 'empty_recording' ? C.recordingEmpty
                      : C.notAccepted}
              </span>
              {failure.kind === 'network' && failure.detail?.unreadable ? (
                <>
                  {/* bd-bmc9a0.1: the phone could not read the file she picked; sending it again would not help. */}
                  <p className="m-0 text-[15px] leading-[1.5] text-[#4b5563]">{C.fileWontOpen}</p>
                  {failure.detail.part?.kind === 'audio' ? (
                    <Action tone="outline" icon={Upload} onClick={() => { setFailure(null); audioInput.current?.click(); }}>{C.changeFile}</Action>
                  ) : null}
                  {badPhoto ? (
                    <>
                      {changeProblem ? (
                        <p className="m-0 text-[14px] font-semibold text-[#c8331f]">{changeProblem === 'wont_open' ? C.photoWontOpen : C.notAPhoto}</p>
                      ) : null}
                      <Action icon={ImageIcon} onClick={() => changeInput.current?.click()}>{C.changePhoto}</Action>
                      <Action tone="outline" icon={Send} onClick={sendWithout}>{C.sendWithoutPhoto}</Action>
                      <input
                        ref={changeInput}
                        hidden
                        type="file"
                        data-testid="dc-photo-change-input"
                        accept={`${acceptFor('photo')},image/jpeg,image/png`}
                        onChange={(e) => { void changePhoto(e.target.files?.[0]); e.target.value = ''; }}
                      />
                    </>
                  ) : null}
                </>
              ) : failure.kind === 'network' ? (
                /* bd-bmc9a0.1: what already arrived is not sent again (`uploaded`). */
                <Action onClick={() => { void submit({ saveForLater: lastSave.current }); }}>{C.tryAgain}</Action>
              ) : (failure.kind === 'in_progress' || failure.kind === 'already_sent') && failure.coachingSessionId ? (
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
                chip={{ text: savedId ? C.saved : C.sent, tone: 'done' }}
                action="none"
              />
            </section>
          ) : null}
          {sending ? (
            <section aria-live="polite" className={cn(CARD, 'flex flex-col items-center gap-2 px-4 py-6 text-center')}>
              <span className="text-[18px] font-semibold">{C.sending}</span>
              <span className="text-[44px] font-light tabular-nums">{`${sending.pct}%`}</span>
              <span className="text-[13px] font-medium text-[#6b7280]">{C.keepAppOpen}</span>
            </section>
          ) : savedId ? (
            /* bd-bmc9a0.2 — ICT IAB row 31: saved; she comes back for the reflection and feedback (the lesson is on the
               main page). No progress here, and nothing polled. */
            <section role="status" className="flex items-start gap-3 rounded-2xl border border-[#cfe6d8] bg-[#eaf6ef] px-4 py-3.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2f7a52] text-white">
                <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
              </span>
              <span className="text-[16px] font-semibold leading-[1.5] text-[#2f7a52]">{C.recordingSaved}</span>
            </section>
          ) : progress?.stage === 'confirm_class' && sessionId ? (
            /* bd-aqotzx — ICT IAB row 16: the recording did not sound like a class. No: back to this screen with her
               class, plan and photos kept, to record or upload again. */
            <ClassCheck sessionId={sessionId} onYes={report.recheck} onNo={recordAgain} />
          ) : progress?.stage === 'stopped' ? (
            <section aria-live="polite" className={cn(CARD, 'px-4 py-5 text-center text-[16px] font-semibold text-[#c8331f]')}>
              {/* bd-fgj73x.7: closed by the server as under 15 minutes (a length the browser could not read).
                  bd-aqotzx: closed because it did not sound like a class — the note says why. */}
              {stoppedLine(progress, C)}
            </section>
          ) : (
            <ProgressSteps
              heading={C.progress}
              steps={dcSteps(progress?.stage ?? 'queued', !!report.sent, C)}
              done={report.ready}
              doneLabel={C.reportReady}
            />
          )}
          {/* While it uploads she keeps the app open (the card says so); the leave note comes once it has arrived. */}
          {!sending && !savedId && progress?.stage !== 'stopped' && progress?.stage !== 'confirm_class' ? (
            <>
              {/* bd-z3cadk — ICT IAB row 23: the same recording sent again; the bot's own message, as on WhatsApp. */}
              {progress?.duplicate && report.ready ? <DuplicateNote lead={C.duplicateRecordingLead} next={C.duplicateRecordingNext} /> : null}
              <Reflection r={report} />
              {report.ready && sessionId ? <Action to={lessonPath(sessionId)} icon={Check}>{C.openLesson}</Action> : <LeaveNote text={leave} />}
            </>
          ) : null}
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
        forClass={cls}
        onLibrary={() => { setPlanSheet(false); holdDraft({ audio, plan, photos, cls }); navigate(libraryHref()); }}
        onFile={pickPlanFile}
        problem={planProblem === 'not_a_plan' ? 'not_a_plan' : null}
      />
    </TeacherPage>
  );
}
