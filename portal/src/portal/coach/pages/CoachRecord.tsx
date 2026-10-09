import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CalendarDays, MicOff, Pause, Play, Square } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { HistoryRow } from "../../teacher/ui";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { Tray } from "../../teacher/ui/Tray";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { coach } from "../../services/api";
import { Card, Loading, Failed, useLoad } from "../ui";
import { OBSERVE } from "../observe/copy";
import { lengthShort } from "../observe/format";
import ObservePage from "../observe/ObservePage";
import { setDraft } from "../observeDraft";
import { useCoachRecording } from "../../lib/useCoachRecording";
import { useRecordingBackGuard } from "../../lib/useRecordingBackGuard";
import { rememberRecording } from "../../lib/coachObserve";
import { SHORT_RECORDING_SECONDS } from "../../lib/coachingUpload";
import { clockText } from "../../components/coaching/coach/CoachRecorder";
import type { CoachVisit } from "../types";

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

function Recorder({ visit, onBlocked }: { visit: CoachVisit; onBlocked: () => void }) {
  const C = useCopy(OBSERVE);
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const { recording, paused, elapsed, level, screenWentOff, micBlocked, togglePause, finish, elapsedNow } = useCoachRecording({
    onStarted: (recordingId) => rememberRecording(recordingId, {
      teacherExtId: visit.teacherExtId || "", schoolExtId: visit.schoolExtId || null, teacherName: visit.teacherName || "",
    }),
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
    navigate(`/portal/coach/visit/${visit.id}/check`);
  };

  if (micBlocked) return null;
  const now = elapsedNow();

  return (
    <ObservePage bare banner={false} title={C.recordTitle} onBack={() => (recording ? setAsking(true) : navigate(`/portal/coach/visit/${visit.id}`))}
      crumb={<><span className="me-1.5 inline-block h-2 w-2 rounded-full bg-[#c8331f] align-middle" aria-hidden="true" />{visit.teacherName || C.dash} · <TimeStamp time={visit.scheduledSlot} size={13} /></>}
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

      <Tray open={asking} title={C.stopAsk} onClose={() => setAsking(false)}>
        <div className="text-[15px]">{C.recordedFor(lengthShort(now, C) || C.underMinute)}</div>
        {now < SHORT_RECORDING_SECONDS * 1000 && (
          <div className="rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">{C.shortNote}</div>
        )}
        <div className="flex gap-2.5">
          <button type="button" onClick={() => setAsking(false)} className="flex h-14 flex-1 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold">{C.keepRecording}</button>
          <button type="button" onClick={stop} className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-[#c8331f] text-base font-semibold text-white">{C.yesStop}</button>
        </div>
      </Tray>
    </ObservePage>
  );
}

const CoachRecord = () => {
  const C = useCopy(OBSERVE);
  const { id = "" } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getVisit(id), [id]);
  const [attempt, setAttempt] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const block = useCallback(() => setBlocked(true), []);
  const visit = data?.visit;

  if (!visit || blocked) {
    return (
      <ObservePage banner={false} title={C.recordTitle} backTo={`/portal/coach/visit/${id}`}
        crumb={visit ? <>{visit.teacherName || C.dash} · <TimeStamp time={visit.scheduledSlot} size={13} /></> : undefined}>
        {failed && <Failed onRetry={reload} />}
        {!data && !failed && <Loading />}
        {blocked && (
          <Card className="flex flex-col items-center gap-4 p-5 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#fee4e2] text-[#c8331f]"><MicOff className="h-9 w-9" aria-hidden="true" /></span>
            <h2 className="text-xl font-semibold">{C.micBlocked}</h2>
            <p className="text-[15px] text-[#4b5563]">{C.micAllow}</p>
            <button type="button" onClick={() => { setBlocked(false); setAttempt((n) => n + 1); }}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.tryAgain}</button>
            <Link to={`/portal/coach/visit/${id}/attach`}
              className="flex h-14 w-full items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025]">{C.uploadRecording}</Link>
          </Card>
        )}
      </ObservePage>
    );
  }
  // Only an upcoming visit is recorded; a done or cancelled one goes back to its page.
  if (visit.status !== "upcoming" || !visit.teacherExtId) return <Navigate to={`/portal/coach/visit/${id}`} replace />;
  return <Recorder key={attempt} visit={visit} onBlocked={block} />;
};

export default CoachRecord;
