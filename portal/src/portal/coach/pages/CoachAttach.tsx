import { useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { CalendarDays, FileAudio, FolderOpen } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { Tray } from "../../teacher/ui/Tray";
import { coach } from "../../services/api";
import { Chevron, Loading, Failed, useLoad } from "../ui";
import { OBSERVE } from "../observe/copy";
import { dayShort, lengthShort } from "../observe/format";
import ObservePage from "../observe/ObservePage";
import { setDraft, type DraftAudio } from "../observeDraft";
import { acceptFor, checkFile, formatSize, readAudioDuration } from "../../lib/coachingUpload";

/**
 * bd-4404s7.4 — Upload recording, for one scheduled visit (Blueprint: Coach_Upload):
 * the kit's Tray over the visit with the visit chip, Select file, the chosen file's row with its bar, then Next → Check and
 * send. The file is checked here the way the existing pipeline checks it
 * (coachingUpload: a sound file, not too large) and its length read for the
 * short-recording warning; it is sent, with the plan and photos, from Check
 * and send.
 */

const CoachAttach = () => {
  const C = useCopy(OBSERVE);
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, failed, reload } = useLoad(() => coach.getVisit(id), [id]);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<DraftAudio | null>(null);
  const [pct, setPct] = useState(0);
  const visit = data?.visit;

  const onChosen = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    const problem = checkFile(f, "audio");
    if (problem) { setFile(null); setError(problem === "too_large" ? C.tooLarge : C.notAudio); return; }
    setPct(0);
    setFile({ blob: f, filename: f.name, durationMs: null, recordingId: null, label: f.name, sub: formatSize(f.size) });
    const seconds = await readAudioDuration(f);
    const durationMs = seconds != null ? seconds * 1000 : null;
    setFile({
      blob: f, filename: f.name, durationMs, recordingId: null, label: f.name,
      sub: [lengthShort(durationMs, C), formatSize(f.size)].filter(Boolean).join(" · "),
    });
    setPct(100);
  };

  const next = () => {
    if (!file || pct < 100) return;
    setDraft(id, file);
    navigate(`/portal/coach/visit/${id}/check`);
  };

  if (visit && (visit.status !== "upcoming" || !visit.teacherExtId)) return <Navigate to={`/portal/coach/visit/${id}`} replace />;

  return (
    <ObservePage banner={false} title={visit?.teacherName || C.dash} backTo={`/portal/coach/visit/${id}`} feature="observations"
      crumb={`${C.takeObservation} · ${visit?.scheduledFor ? dayShort(visit.scheduledFor, C) : ""}`}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="h-[200px] rounded-2xl border border-[#e5e7eb] bg-white" />
        <div className="[display:grid] grid-cols-2 gap-3"><div className="h-[156px] rounded-2xl border border-[#e5e7eb] bg-white" /><div className="h-[156px] rounded-2xl border border-[#e5e7eb] bg-white" /></div>
      </div>

      <Tray open={!!visit} title={C.uploadRecording} onClose={() => navigate(`/portal/coach/visit/${id}`)}>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 text-[13px] font-semibold text-[#4b5563]">
            <CalendarDays className="h-[15px] w-[15px]" aria-hidden="true" />{visit?.teacherName || C.dash} · <TimeStamp time={visit?.scheduledSlot} size={13} />
          </span>
        </div>
        <button type="button" onClick={() => input.current?.click()}
          className="flex min-h-[76px] items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white p-3 pe-3.5 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]" aria-hidden="true"><FolderOpen className="h-[22px] w-[22px]" /></span>
          <span className="flex-1 truncate text-[17px] font-semibold">{C.chooseFile}</span>
          <Chevron />
        </button>
        <input ref={input} data-testid="audio-input" type="file" accept={`${acceptFor("audio")},audio/*`} className="hidden"
          onChange={(e) => { void onChosen(e.target.files?.[0]); e.target.value = ""; }} />
        {error && <div role="alert" className="rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">{error}</div>}
        {file && (
          <div className="flex flex-col gap-3 rounded-2xl border border-[#e5e7eb] bg-[#f9fafb] p-3.5">
            <div className="flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]" aria-hidden="true"><FileAudio className="h-[22px] w-[22px]" /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[17px] font-semibold" dir="auto">{file.filename}</span>
                <span className="truncate text-[13px] text-[#6b7280]">{file.sub}</span>
              </span>
              <StatusChip text={`${pct}%`} tone="info" />
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#e5e7eb]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={C.uploadRecording}>
              <span className="block h-full rounded-full bg-[#48b078] transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        <button type="button" onClick={next} disabled={!file || pct < 100}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white disabled:bg-[#e5e7eb] disabled:text-[#9ca3af]">{C.next2}</button>
      </Tray>
    </ObservePage>
  );
};

export default CoachAttach;
