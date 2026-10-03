import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { RecordStart } from '../../components/coaching/CoachingHome';
import { checkFile, MAX_PHOTOS, readAudioDuration } from '../../lib/coachingUpload';
import { sendLesson, SendError, type LibraryPick } from '../../lib/coachingSend';
import { takeHandedOffRecording } from '../../lib/lessonHandoff';
import { lessonFilename } from '../../lib/recordFlow';
import { deleteRecording, latestUnsent, type StoredRecording } from '../../lib/recordingStore';
import type { RecordingSession } from '../../lib/recordingSession';
import { portal } from '../../services/api';
import { withDuration } from '../../lib/webmDuration';

/**
 * bd-5rz1v.26 — the record-and-send flow behind the new UI's record page (RecordPage), the same
 * behaviour as today's PortalCoachingRecord, held apart from how it looks:
 *
 *   arrival    the choice Coaching made, in the route state, taken ONCE and cleared, so Back
 *              to this page never starts anything: record → recording at once; file → the
 *              recording Coaching handed over; resume → the recording left on the phone. No
 *              choice, or nothing to work on: back to Coaching with its Send a lesson sheet.
 *   recording  owned by the app-level session (bd-5rz1v.10); this page is a view onto it.
 *              Finished elsewhere (Logout's Stop & log out): back to Coaching, which offers it.
 *   check      the recording, a lesson plan (a pick from the library or recent plans, or a
 *              file / photo), up to 3 board photos; problems are CODES the page puts in words
 *   send       every file to R2, then the analysis; a recording made here is deleted from the
 *              phone only once it has arrived. A failure is a SendError kind.
 */

export const RECORD_PATH = '/portal/coaching/new';

export type Stage =
  | 'starting' | 'micBlocked' | 'recording' | 'check' | 'library' | 'sending' | 'failed' | 'busy' | 'sent';

export type Audio = {
  blob: Blob;
  filename: string;
  durationMs: number | null;
  /** Set when it was recorded here (or recovered): the phone copy to delete once sent. */
  recordingId: string | null;
  /** recorded here now, recovered from the phone, or a file she picked */
  source: 'recorded' | 'resumed' | 'file';
  size: number;
  /** When a recovered recording was started (ISO). */
  startedAt: string | null;
};

export type Plan =
  | { kind: 'library'; pick: LibraryPick; title: string; chips: string[] }
  | { kind: 'file'; file: File; asPhoto: boolean };

export type FileProblem = 'not_audio' | 'too_large' | null;
export type PlanProblem = 'not_a_plan' | null;
export type PhotosProblem = 'not_a_photo' | 'too_many' | null;

export function useSendFlow(session: RecordingSession) {
  const navigate = useNavigate();
  const location = useLocation();
  const [stage, setStage] = useState<Stage>(() => (session.active ? 'recording' : 'starting'));
  const begun = useRef(false);
  const finishingHere = useRef(false);

  const [audio, setAudio] = useState<Audio | null>(null);
  const [fileProblem, setFileProblem] = useState<FileProblem>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planProblem, setPlanProblem] = useState<PlanProblem>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photosProblem, setPhotosProblem] = useState<PhotosProblem>(null);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<SendError | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const toCoaching = useCallback(
    () => navigate('/portal/coaching', { replace: true, state: { sendSheet: true } }),
    [navigate],
  );

  const startRecording = async () => {
    const result = await session.start({ returnTo: RECORD_PATH });
    setStage(result === 'recording' ? 'recording' : 'micBlocked');
  };

  /** A recording file she picked; false when it is not one (and why, in fileProblem). */
  const chooseAudio = async (file: File | undefined): Promise<boolean> => {
    setFileProblem(null);
    if (!file) return false;
    const problem = checkFile(file, 'audio');
    if (problem) { setFileProblem(problem === 'too_large' ? 'too_large' : 'not_audio'); return false; }
    const seconds = await readAudioDuration(file);
    setAudio({
      blob: file, filename: file.name, durationMs: seconds != null ? seconds * 1000 : null,
      recordingId: null, source: 'file', size: file.size, startedAt: null,
    });
    setStage('check');
    return true;
  };

  const continueUnsent = async ({ meta, blob: raw }: { meta: StoredRecording; blob: Blob }) => {
    const blob = await withDuration(raw, meta.ext, meta.elapsedMs);
    setAudio({
      blob, filename: lessonFilename(meta.ext, new Date(meta.startedAt)), durationMs: meta.elapsedMs || null,
      recordingId: meta.id, source: 'resumed', size: blob.size, startedAt: meta.startedAt,
    });
    setStage('check');
  };

  // Arrival: what she chose on Coaching, once.
  useEffect(() => {
    if (begun.current) return;
    begun.current = true;
    const start = (location.state as Partial<RecordStart> | null)?.start;
    navigate(location.pathname, { replace: true, state: null });
    // A lesson already recording (Return, Send a lesson, Back) is shown, never a second one.
    if (session.active) { setStage('recording'); return; }
    if (start === 'record') { void startRecording(); return; }
    if (start === 'file') {
      const file = takeHandedOffRecording();
      if (!file) { toCoaching(); return; }
      void chooseAudio(file).then((ok) => { if (!ok) toCoaching(); });
      return;
    }
    if (start === 'resume') {
      latestUnsent().then((u) => (u ? continueUnsent(u) : toCoaching())).catch(toCoaching);
      return;
    }
    toCoaching();
    // Once, on arrival; the handlers are this render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePause = () => { if (session.paused) session.resume(); else session.pause(); };

  const finishRecording = async () => {
    finishingHere.current = true;
    const out = await session.finish();
    finishingHere.current = false;
    if (!out) return;
    setAudio({
      blob: out.blob, filename: lessonFilename(out.type.ext), durationMs: out.durationMs,
      recordingId: out.id, source: 'recorded', size: out.blob.size, startedAt: null,
    });
    setStage('check');
  };

  // Finished somewhere else (Logout's "Stop & log out") while this page showed it: it is on the
  // phone, and Coaching offers to Continue it.
  useEffect(() => {
    if (stage === 'recording' && !session.active && !finishingHere.current) toCoaching();
  }, [stage, session.active, toCoaching]);

  /**
   * A recording made here: delete it and go back to Coaching's sheet, to record again or upload.
   * A file: the page opens the picker (from this tap); she keeps hers unless she picks another.
   */
  const redo = async (openPicker: () => void) => {
    const id = audio?.recordingId;
    if (!id) { openPicker(); return; }
    try { await deleteRecording(id); } catch { /* gone */ }
    setAudio(null);
    toCoaching();
  };

  const choosePlanFile = (file: File | undefined, asPhoto: boolean): boolean => {
    setPlanProblem(null);
    if (!file) return false;
    if (checkFile(file, 'lesson_plan')) { setPlanProblem('not_a_plan'); return false; }
    setPlan({ kind: 'file', file, asPhoto });
    return true;
  };

  const pickPlan = (p: { pick: LibraryPick; title: string; chips: string[] }) => {
    setPlanProblem(null);
    setPlan({ kind: 'library', ...p });
  };

  const addPhotos = (list: FileList | File[] | null) => {
    setPhotosProblem(null);
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    if (chosen.some((f) => checkFile(f, 'photo'))) { setPhotosProblem('not_a_photo'); return; }
    const all = [...photos, ...chosen];
    if (all.length > MAX_PHOTOS) { setPhotosProblem('too_many'); return; }
    setPhotos(all);
  };

  const removePhoto = (i: number) => { setPhotosProblem(null); setPhotos((p) => p.filter((_, j) => j !== i)); };

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

  /** The plan was refused: drop it and go back to choose another. */
  const dropPlan = () => { setPlan(null); setStage('check'); };

  return {
    stage, setStage, audio, fileProblem, plan, planProblem, photos, photosProblem, progress, failure, sessionId,
    startRecording, chooseAudio, togglePause, finishRecording, redo, choosePlanFile, pickPlan, addPhotos, removePhoto,
    send, dropPlan, toCoaching, clearPlanProblem: () => setPlanProblem(null),
  };
}

export type SendFlow = ReturnType<typeof useSendFlow>;
