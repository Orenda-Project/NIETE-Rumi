import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CalendarDays, FileAudio, FolderOpen, X } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Chip, Chevron, Loading, Failed, useLoad } from "../ui";
import { formatSlot } from "../time";
import { setDraft, type DraftAudio } from "../observeDraft";
import { acceptFor, checkFile, formatSize, minutesText, readAudioDuration } from "../../lib/coachingUpload";

/**
 * bd-o15qnr.9 — Upload recording, for one scheduled visit (v18 Attach.dc.html,
 * titled "Upload recording" since v21): a sheet over the visit with the visit
 * chip, Choose file, the chosen file's row with its bar, then Next → Check and
 * send. The file is checked here the way the existing pipeline checks it
 * (coachingUpload: a sound file, not too large) and its length read for the
 * short-recording warning; it is sent, with the plan and photos, from Check
 * and send.
 */

const CoachAttach = () => {
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
      sub: [durationMs != null ? minutesText(durationMs) : null, formatSize(f.size)].filter(Boolean).join(" · "),
    });
    setPct(100);
  };

  const next = () => {
    if (!file || pct < 100) return;
    setDraft(id, file);
    navigate(`/portal/coach/visit/${id}/check`);
  };

  if (visit && (visit.status !== "upcoming" || !visit.teacherExtId)) return <Navigate to={`/portal/coach/visit/${id}`} replace />;
  const time = formatSlot(visit?.scheduledSlot);

  return (
    <CoachPage banner={false} title={visit?.teacherName || C.dash} backTo={`/portal/coach/visit/${id}`}
      crumb={`${C.takeObservation} · ${visit?.scheduledFor ? new Date(`${visit.scheduledFor}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""}`}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="h-[200px] rounded-2xl border border-[#e5e7eb] bg-white" />
        <div className="grid grid-cols-2 gap-3"><div className="h-[156px] rounded-2xl border border-[#e5e7eb] bg-white" /><div className="h-[156px] rounded-2xl border border-[#e5e7eb] bg-white" /></div>
      </div>

      {visit && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(17,24,39,0.5)] md:items-center md:justify-center">
          <section role="dialog" aria-modal="true" aria-labelledby="upload-title"
            className="flex w-full flex-col gap-3.5 rounded-t-3xl bg-white px-4 pb-[22px] pt-2.5 shadow-[0_-8px_24px_rgba(17,24,39,0.18)] md:max-w-md md:rounded-3xl">
            <div className="h-1 w-10 self-center rounded-full bg-[#d1d5db]" aria-hidden="true" />
            <div className="flex items-center gap-2">
              <h2 id="upload-title" className="flex-1 text-2xl font-light tracking-[-0.01em]">{C.attachRecording}</h2>
              <Link to={`/portal/coach/visit/${id}`} aria-label={C.close} className="-me-2 flex h-14 w-14 items-center justify-center text-[#33374a]">
                <X className="h-6 w-6" aria-hidden="true" />
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip><CalendarDays className="h-[15px] w-[15px]" aria-hidden="true" />{`${visit.teacherName || C.dash} · ${time}`}</Chip>
            </div>
            <button type="button" onClick={() => input.current?.click()}
              className="flex min-h-[76px] items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white p-3 pe-3.5 text-left shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
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
                    <span className="truncate text-[17px] font-semibold">{file.filename}</span>
                    <span className="truncate text-[13px] text-[#6b7280]">{file.sub}</span>
                  </span>
                  <Chip>{`${pct}%`}</Chip>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e5e7eb]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={C.attachRecording}>
                  <span className="block h-full rounded-full bg-[#48b078] transition-[width]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
            <button type="button" onClick={next} disabled={!file || pct < 100}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white disabled:bg-[#e5e7eb] disabled:text-[#9ca3af]">{C.next}</button>
          </section>
        </div>
      )}
    </CoachPage>
  );
};

export default CoachAttach;
