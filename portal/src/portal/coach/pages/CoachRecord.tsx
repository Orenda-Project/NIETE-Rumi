import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CalendarDays, Check, MicOff, Pause, Play, Square } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { ConfirmTray } from "../../teacher/ui/ConfirmTray";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { Card, Loading, Failed, useLoad } from "../ui";
import { OBSERVE } from "../observe/copy";
import { lengthShort } from "../observe/format";
import ObservePage from "../observe/ObservePage";
import { useObserveRoutes } from "../observe/observeRoutes";
import { setDraft } from "../observeDraft";
import { useCoachRecording, useMicLevel } from "../../lib/useCoachRecording";
import { useRecordingClock, useRecordingSession, type RecordingSession } from "../../lib/recordingSession";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { FLOW_V6 } from "../flow/copy";
import { useRecordingBackGuard } from "../../lib/useRecordingBackGuard";
import { rememberRecording } from "../../lib/coachObserve";
import { SHORT_RECORDING_SECONDS } from "../../lib/coachingUpload";
import { clockText } from "../../components/coaching/coach/CoachRecorder";
import type { CoachVisit } from "../types";
import { useUploadOnly } from "../observe/uploadOnly";
import PhoneRecord from "../observe/PhoneRecord";
import { keptForVisit, keptState, useKept } from "../observe/keptRecording";
import type { KeptRecording } from "../../lib/recordingStore";
import type { BeatContext } from "../../lib/recordingBeat";

/** bd-ma9jiy — the heartbeat's context for this visit's recording. */
const beatOf = (visit: CoachVisit): BeatContext => ({ kind: "obs", visitId: visit.id, teacherExtId: visit.teacherExtId || null });

/**
 * bd-4404s7.4 — Record observation, for one scheduled visit (Blueprint: Coach_Record; it was Record live): a
 * timer ring with the Recording chip, the level meter, the teacher and school
 * with "Visit · 11:30 AM" and a Linked chip, then Pause and Stop. Stop asks
 * once, then Check and send has the recording.
 *
 * The engine is the coach recorder's own (useCoachRecording: LessonRecorder,
 * kept on the phone as it records, the screen held on). The recording is
 * remembered as this teacher's, so a reload can still send it. No menu while
 * recording; Back asks first. A refused microphone offers Try again, or Upload
 * recording instead. The words are the Observe copy's (English and Urdu), "observation" and "Start recording".
 */

const BARS = 24;

export function lessonFilename(ext: string, at = new Date()): string {
  const d = at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const t = `${String(at.getHours()).padStart(2, "0")}.${String(at.getMinutes()).padStart(2, "0")}`;
  return `Observation ${d} ${t}${ext}`;
}

/** The v18 meter: 24 bars, the newest on the right; red while the class is loud. */
function LevelMeter({ level, live }: { level: number | null; live: boolean }) {
  const [history, setHistory] = useState<number[]>(() => Array(BARS).fill(0.2));
  const [last, setLast] = useState<number | null>(null);
  if (live && level != null && level !== last) {
    setLast(level);
    setHistory((h) => [...h.slice(1), Math.min(1, level * 4)]);
  }
  return (
    <div data-testid="level-meter" className="flex h-14 items-center gap-1" aria-hidden="true">
      {history.map((v, i) => (
        <span key={i} className="w-1.5 rounded-[3px]"
          style={{ height: `${Math.round(12 + v * 40)}px`, background: live && i >= BARS - 7 ? "#c8331f" : "#f5b9b0" }} />
      ))}
    </div>
  );
}

function Recorder({ visit, onBlocked, kept = null }: { visit: CoachVisit; onBlocked: () => void; kept?: KeptRecording | null }) {
  const routes = useObserveRoutes();
  const C = useCopy(OBSERVE);
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const { recording, paused, elapsed, level, screenWentOff, micBlocked, togglePause, finish, elapsedNow } = useCoachRecording({
    onStarted: (recordingId) => rememberRecording(recordingId, {
      teacherExtId: visit.teacherExtId || "", schoolExtId: visit.schoolExtId || null, teacherName: visit.teacherName || "",
      kind: "obs", visitId: visit.id,
    }),
    // bd-ma9jiy: a kept recording opens paused (Resume continues it), and every save is sampled.
    kept,
    beat: beatOf(visit),
  });
  useRecordingBackGuard(recording, () => setAsking(true));
  useEffect(() => { if (micBlocked) onBlocked(); }, [micBlocked, onBlocked]);

  const stop = async () => {
    setAsking(false);
    const out = await finish();
    if (!out) return;
    setDraft(visit.id, {
      blob: out.blob, filename: lessonFilename(out.type.ext), durationMs: out.durationMs, recordingId: out.id,
      label: C.observationOf(visit.teacherName || C.dash), sub: [lengthShort(out.durationMs, C), C.justNow].filter(Boolean).join(" · "),
    });
    navigate(routes.check(visit.id), { replace: true }); // a finished recording is not a screen to go Back to
  };

  if (micBlocked) return null;
  const now = elapsedNow();

  return (
    <ObservePage bare banner={false} title={C.recordTitle} onBack={() => (recording ? setAsking(true) : navigate(routes.visit(visit.id)))}
      crumb={<><span className="me-1.5 inline-block h-2 w-2 rounded-full bg-[#c8331f] align-middle" aria-hidden="true" />{visit.teacherName || C.dash}{visit.scheduledSlot && <> · <TimeStamp time={visit.scheduledSlot} size={13} /></>}</>}
      dock={(
        <>
          <button type="button" onClick={togglePause} disabled={!recording}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025] disabled:opacity-60">
            {paused ? <Play className="h-5 w-5 fill-current" aria-hidden="true" /> : <Pause className="h-5 w-5 fill-current" aria-hidden="true" />}{paused ? C.resume : C.pause}
          </button>
          <button type="button" onClick={() => setAsking(true)} disabled={!recording}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#c8331f] text-base font-semibold text-white disabled:opacity-60">
            <Square className="h-5 w-5 fill-current" aria-hidden="true" />{C.stop}
          </button>
        </>
      )}>
      <div className="flex flex-col items-center gap-6 pt-3">
        <div role="timer" aria-label={C.recordingTime}
          className="flex h-60 w-60 flex-col items-center justify-center gap-2.5 rounded-full border-[12px] border-[#fee4e2] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          {paused
            ? <StatusChip text={C.paused} tone="info" />
            : <StatusChip text={C.recording} tone="error" />}
          <span className="text-[54px] font-light leading-none tracking-[-0.02em] tabular-nums">{clockText(elapsed)}</span>
        </div>
        <LevelMeter level={level} live={recording && !paused} />
        {screenWentOff && (
          <div className="flex w-full gap-2.5 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><span>{C.screenOff}</span>
          </div>
        )}
        <Card className="w-full overflow-hidden" data-testid="linked-visit">
          <HistoryRow lead="person" title={visit.teacherName || C.dash} extra={visit.schoolName || undefined} action="none" />
          <div className="flex min-h-[56px] items-center gap-2.5 border-t border-[#e5e7eb] px-4 py-3">
            <CalendarDays className="h-5 w-5 text-[#6b7280]" aria-hidden="true" />
            <span className="flex flex-1 items-center gap-2 text-[15px] font-medium">{C.visitAt("")}<TimeStamp time={visit.scheduledSlot} tone="next" size={15} /></span>
            <StatusChip text={C.linked} tone="done" tick />
          </div>
        </Card>
      </div>

      {/* bd-fmf24g.41: the kit's ConfirmTray, as every recording's Finish / Stop asks. */}
      <ConfirmTray
        open={asking}
        title={C.stopAsk}
        onClose={() => setAsking(false)}
        line={C.recordedFor(lengthShort(now, C) || C.underMinute)}
        warning={now < SHORT_RECORDING_SECONDS * 1000 ? C.shortNote : undefined}
        confirmLabel={C.yesStop}
        confirmIcon={Check}
        onConfirm={() => { void stop(); }}
        cancelLabel={C.keepRecording}
      />
    </ObservePage>
  );
}

/**
 * bd-o15qnr.27 (queue #204, v6; the operator 20 Nov ~13:32: "In the observation recording screen the user should be able
 * to neviaget around the app if they want.") — with portal_coach_flow_v2 on, the recording is the app's recording
 * session (lib/recordingSession, the provider above every route; the teacher app's lessons have used it since
 * bd-5rz1v.10), not this page's: the screen keeps the app's menu, leaving it does NOT stop the recording, and every other
 * page shows the Recording bar (PortalLayout → RecordingBar: "Recording · 12:34", back here). Coming back finds it
 * running. Stop asks once, then Check and send has the recording, as before.
 *
 * One recording at a time: while another observation records, this screen says so and goes back to that one (a second
 * start would hand the running recording to this visit). The chunks are on the phone as they record
 * (LessonRecorder, unchanged), and the recording is remembered as this teacher's, so a reload can still send it.
 * Switch off: the Recorder below, exactly as on production (no menu; leaving stops it, so Back asks).
 */
function SessionRecorder({ visit, session, onBlocked, kept = null }: {
  visit: CoachVisit; session: RecordingSession; onBlocked: () => void; kept?: KeptRecording | null;
}) {
  const routes = useObserveRoutes();
  const C = useCopy(OBSERVE);
  const F = useCopy(FLOW_V6);
  const navigate = useNavigate();
  const here = routes.record(visit.id);
  const [asking, setAsking] = useState(false);
  const elsewhere = session.active && !!session.returnTo && session.returnTo !== here;
  const mine = session.active && session.returnTo === here;
  const asked = useRef(false);
  const remembered = useRef<string | null>(null);
  const ms = useRecordingClock(session);
  const level = useMicLevel(session.stream, mine && !session.paused);

  // Decide ONCE, on arrival: start only when nothing is recording (coming back finds it running; another one running is
  // never taken over). Never again on this screen: when Stop ends the session, "nothing is recording" must not start a
  // second one (seen on sandbox, 20 Nov: back via the Recording bar, Stop, and a new recording began).
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if (session.active) return;
    // bd-ma9jiy (queue #262; the operator 25 Nov: "simulate as in the observation got paused in the middle") — a recording
    // this phone kept for this teacher comes back as this recording, PAUSED: Resume carries on in the same recording.
    if (kept) { session.restore({ returnTo: here, kept, beat: beatOf(visit) }); return; }
    void session.start({ returnTo: here, beat: beatOf(visit) }).then((r) => { if (r === "micBlocked") onBlocked(); });
  }, [session, here, onBlocked, kept, visit]);
  const resumeOrPause = () => {
    if (!session.paused) { session.pause(); return; }
    const r = session.resume();
    if (r) void r.then((x) => { if (x === "micBlocked") onBlocked(); });
  };

  // Whose recording this is, the moment it has an id (a reload can still send it).
  useEffect(() => {
    if (!mine || !session.recordingId || remembered.current === session.recordingId) return;
    remembered.current = session.recordingId;
    rememberRecording(session.recordingId, {
      teacherExtId: visit.teacherExtId || "", schoolExtId: visit.schoolExtId || null, teacherName: visit.teacherName || "",
      kind: "obs", visitId: visit.id,
    });
  }, [mine, session.recordingId, visit.teacherExtId, visit.schoolExtId, visit.teacherName]);

  const stop = async () => {
    setAsking(false);
    const out = await session.finish();
    if (!out) return;
    setDraft(visit.id, {
      blob: out.blob, filename: lessonFilename(out.type.ext), durationMs: out.durationMs, recordingId: out.id,
      label: C.observationOf(visit.teacherName || C.dash), sub: [lengthShort(out.durationMs, C), C.justNow].filter(Boolean).join(" · "),
    });
    navigate(routes.check(visit.id), { replace: true });
  };

  const crumb = <><span className="me-1.5 inline-block h-2 w-2 rounded-full bg-[#c8331f] align-middle" aria-hidden="true" />{visit.teacherName || C.dash}{visit.scheduledSlot && <> · <TimeStamp time={visit.scheduledSlot} size={13} /></>}</>;

  if (elsewhere) {
    return (
      <ObservePage banner={false} title={C.recordTitle} backTo={routes.visit(visit.id)} crumb={crumb}>
        <Card className="flex flex-col items-center gap-4 p-5 text-center" data-testid="recording-elsewhere">
          <StatusChip text={C.recording} tone="error" />
          <h2 className="text-xl font-semibold">{F.recordingElsewhere}</h2>
          <Link to={session.returnTo as string}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{F.backToRecording}</Link>
        </Card>
      </ObservePage>
    );
  }

  const live = mine && !session.paused;
  return (
    <ObservePage banner={false} title={C.recordTitle} backTo={routes.visit(visit.id)} crumb={crumb}
      dock={(
        <>
          <button type="button" onClick={resumeOrPause} disabled={!mine}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025] disabled:opacity-60">
            {session.paused ? <Play className="h-5 w-5 fill-current" aria-hidden="true" /> : <Pause className="h-5 w-5 fill-current" aria-hidden="true" />}{session.paused ? C.resume : C.pause}
          </button>
          <button type="button" onClick={() => setAsking(true)} disabled={!mine}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#c8331f] text-base font-semibold text-white disabled:opacity-60">
            <Square className="h-5 w-5 fill-current" aria-hidden="true" />{C.stop}
          </button>
        </>
      )}>
      <div className="flex flex-col items-center gap-6 pt-3">
        <div role="timer" aria-label={C.recordingTime}
          className="flex h-60 w-60 flex-col items-center justify-center gap-2.5 rounded-full border-[12px] border-[#fee4e2] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          {session.paused ? <StatusChip text={C.paused} tone="info" /> : <StatusChip text={C.recording} tone="error" />}
          <span className="text-[54px] font-light leading-none tracking-[-0.02em] tabular-nums">{clockText(ms)}</span>
        </div>
        <LevelMeter level={level} live={live} />
        <p className="m-0 text-center text-[15px] text-[#4b5563]" data-testid="keeps-recording">{F.keepsRecording}</p>
        {session.screenWentOff && (
          <div className="flex w-full gap-2.5 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><span>{C.screenOff}</span>
          </div>
        )}
        <Card className="w-full overflow-hidden" data-testid="linked-visit">
          <HistoryRow lead="person" title={visit.teacherName || C.dash} extra={visit.schoolName || undefined} action="none" />
          <div className="flex min-h-[56px] items-center gap-2.5 border-t border-[#e5e7eb] px-4 py-3">
            <CalendarDays className="h-5 w-5 text-[#6b7280]" aria-hidden="true" />
            <span className="flex flex-1 items-center gap-2 text-[15px] font-medium">{C.visitAt("")}<TimeStamp time={visit.scheduledSlot} tone="next" size={15} /></span>
            <StatusChip text={C.linked} tone="done" tick />
          </div>
        </Card>
      </div>

      <ConfirmTray
        open={asking}
        title={C.stopAsk}
        onClose={() => setAsking(false)}
        line={C.recordedFor(lengthShort(ms, C) || C.underMinute)}
        warning={ms < SHORT_RECORDING_SECONDS * 1000 ? C.shortNote : undefined}
        confirmLabel={C.yesStop}
        confirmIcon={Check}
        onConfirm={() => { void stop(); }}
        cancelLabel={C.keepRecording}
      />
    </ObservePage>
  );
}

const CoachRecord = () => {
  const C = useCopy(OBSERVE);
  const { id = "" } = useParams();
  const routes = useObserveRoutes();
  // Read before any recorder starts: while the switch is read (null), the page waits (never the old recorder first).
  const flowRead = useFlowV6(); // a coach on the flow switch, or a principal on the principal app it names
  const v6 = flowRead === true;
  const session = useRecordingSession();
  // bd-oe6r47 (queue #278) — upload-only (a person portal_observe_upload_only names): ONE button, Upload recording, never
  // the in-app recorder. Read before any recorder starts, like the flow switch: while it is read (null) the page waits. A
  // recording the app is ALREADY making when she arrives (the v6 session) keeps its screen, so it can be stopped.
  const uploadOnly = useUploadOnly();
  const [arrivedRecording] = useState(() => !!session?.active);
  const { data, failed, reload } = useLoad(() => routes.loadVisit(id), [id]);
  // bd-ih6cej — the in-app recorder is the default again, but a recording this phone keeps for THIS teacher (cut or never
  // sent) is offered first (PhoneRecord "kept"): starting a new one would hide it. Asked once, on arrival, unless a
  // recording is already running (that one is the session's, not a kept copy). Start recording there sets `startNew`.
  const keptAsk = !arrivedRecording && uploadOnly === false;
  // bd-ma9jiy (queue #262) — the kept recording itself: a WebM one opens as the paused recorder (Resume / Stop), not as
  // "Send saved recording". One the code cannot continue (an MP4 from an iPhone) keeps the saved-copy screen.
  // bd-ma9jiy (26 Nov ~15:10): THIS visit's recording only (its link); another visit of the same teacher records afresh.
  const keptTeacher = data?.visit?.teacherExtId ? data.visit.id : "";
  const keptRec = useKept(keptAsk && keptTeacher ? () => keptForVisit(keptTeacher) : null, [keptTeacher, keptAsk]);
  const kept = keptRec === undefined ? null : !!keptRec;
  // bd-ma9jiy.3 (#292's rule): only one cut mid-way within the hour reopens paused; a stopped or older one is sent, never
  // joined onto a new lesson (PhoneRecord "kept": Send saved recording).
  const resumable = !!keptRec && keptState(keptRec) === "paused";
  const [startNew, setStartNew] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const block = useCallback(() => setBlocked(true), []);
  const visit = data?.visit;

  if (!visit || blocked || flowRead === null || uploadOnly === null || (keptAsk && !!visit.teacherExtId && keptRec === undefined)) {
    return (
      <ObservePage banner={false} title={C.recordTitle} backTo={routes.visit(id)}
        crumb={visit ? <>{visit.teacherName || C.dash}{visit.scheduledSlot && <> · <TimeStamp time={visit.scheduledSlot} size={13} /></>}</> : undefined}>
        {failed && <Failed onRetry={reload} />}
        {!data && !failed && <Loading />}
        {blocked && (
          <Card className="flex flex-col items-center gap-4 p-5 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#fee4e2] text-[#c8331f]"><MicOff className="h-9 w-9" aria-hidden="true" /></span>
            <h2 className="text-xl font-semibold">{C.micBlocked}</h2>
            <p className="text-[15px] text-[#4b5563]">{C.micAllow}</p>
            <button type="button" onClick={() => { setBlocked(false); setAttempt((n) => n + 1); }}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.tryAgain}</button>
            <Link to={routes.attach(id)}
              className="flex h-14 w-full items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025]">{C.uploadRecording}</Link>
          </Card>
        )}
      </ObservePage>
    );
  }
  // Only an upcoming visit is recorded; a done or cancelled one goes back to its page.
  if (visit.status !== "upcoming" || !visit.teacherExtId) return <Navigate to={routes.visit(id)} replace />;
  if (uploadOnly && !(v6 && session && arrivedRecording)) return <PhoneRecord visit={visit} mode="upload" />;
  if (keptAsk && kept && !resumable && !startNew) return <PhoneRecord visit={visit} mode="kept" onRecord={() => setStartNew(true)} />;
  const resumeFrom = keptAsk && resumable && !startNew ? keptRec : null;
  // bd-o15qnr.27 (v6): the recording that keeps going while she moves round the app; switch off, production's Recorder.
  if (v6 && session) return <SessionRecorder key={attempt} visit={visit} session={session} onBlocked={block} kept={resumeFrom} />;
  return <Recorder key={attempt} visit={visit} onBlocked={block} kept={resumeFrom} />;
};

export default CoachRecord;
