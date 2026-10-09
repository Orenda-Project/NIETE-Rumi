import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Camera, Clock, Library, Pause, Play, RotateCcw, Send } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { PhotoGrid, SectionHeading } from "../../teacher/coaching/parts";
import { ListRow } from "../../teacher/ui";
import { Tray } from "../../teacher/ui/Tray";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { coach, leader, type RecentLessonPlan } from "../../services/api";
import { Card, Loading, Failed, useLoad } from "../ui";
import { clearDraft, getDraft, setDraft, type DraftAudio } from "../observeDraft";
import LibraryPicker, { type PickedPlan } from "../../components/coaching/LibraryPicker";
import { checkFile, MAX_PHOTOS, SHORT_RECORDING_SECONDS } from "../../lib/coachingUpload";
import type { LibraryPick } from "../../lib/coachingSend";
import { forgetRecording, recordingTeacher } from "../../lib/coachObserve";
import { deleteRecording, latestUnsent } from "../../lib/recordingStore";
import { withDuration } from "../../lib/webmDuration";
import { OBSERVE, type ObserveCopy } from "../observe/copy";
import { lengthShort } from "../observe/format";
import ObservePage from "../observe/ObservePage";
import { sendingPath, startSend, useSendJob } from "../observe/sender";
import { lessonFilename } from "./CoachRecord";
import type { CoachVisit } from "../types";

/**
 * bd-4404s7.4 — Check and send, for one scheduled visit (Blueprint: Coach_Check): the recording (play, Redo), the
 * lesson plan — optional: their recent plans, the library, or a photo of the plan — then up to three photos (no faces),
 * and Send observation.
 *
 * SENDING IS IN THE BACKGROUND. Send observation hands the files to the sender (observe/sender.ts), which runs the
 * existing pipeline with THIS visit's teacher and school (coachObserve.sendObservation: every file to R2, then the
 * start, so portal-observe's markDone ties the session to the schedule entry), and moves her to the Sending page: she
 * can leave from there ("You can leave. We'll tell you here."). A failure is told there and by the notices, with the real
 * reason and Try again; it is never a WhatsApp message.
 *
 * Reused from the teacher's Digital Coaching: the Photos grid and its heading (the same Photos, no faces, up to three),
 * and ListRow for the chosen plan and the recent plans. The library browse is the existing LibraryPicker inside the page.
 * Words about the teacher stay neutral.
 */

type Plan =
  | { kind: "library"; pick: LibraryPick; title: string; sub: string }
  | { kind: "file"; file: File; title: string; sub: string };

type Stage = "check" | "library";

function Tile({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-[112px] flex-col items-start justify-between gap-2.5 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-start text-sm font-semibold leading-tight text-[#1d2025] shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]" aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

const Alert = ({ children }: { children: ReactNode }) => (
  <div role="alert" className="flex gap-2.5 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">
    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /><span>{children}</span>
  </div>
);

const planSub = (p: RecentLessonPlan, C: ObserveCopy) => [p.grade != null ? C.grade(Number(p.grade)) : null, p.subject].filter(Boolean).join(" · ");

function CheckSend({ visit, audio }: { visit: CoachVisit; audio: DraftAudio }) {
  const C = useCopy(OBSERVE);
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("check");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<RecentLessonPlan[] | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [libraryLevel, setLibraryLevel] = useState(0);
  const [libraryBack, setLibraryBack] = useState(0);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const planPhotoInput = useRef<HTMLInputElement>(null);
  const teacherName = visit.teacherName || C.dash;
  const isShort = audio.durationMs != null && audio.durationMs < SHORT_RECORDING_SECONDS * 1000;

  useEffect(() => () => {
    if (player.current) {
      player.current.pause();
      if (typeof URL.revokeObjectURL === "function" && player.current.src) URL.revokeObjectURL(player.current.src);
    }
  }, []);

  const togglePlay = () => {
    try {
      if (!player.current) {
        if (typeof URL.createObjectURL !== "function") return;
        player.current = new Audio(URL.createObjectURL(audio.blob));
        player.current.onended = () => setPlaying(false);
      }
      if (playing) { player.current.pause(); setPlaying(false); } else { void player.current.play(); setPlaying(true); }
    } catch { setPlaying(false); }
  };

  const redo = async () => {
    if (audio.recordingId) {
      try { await deleteRecording(audio.recordingId); } catch { /* gone */ }
      forgetRecording(audio.recordingId);
    }
    clearDraft(visit.id);
    navigate(`/portal/coach/visit/${visit.id}/${audio.recordingId ? "record" : "attach"}`);
  };

  const loadTheirRecent = useCallback(
    () => leader.getObserveRecentPlans(visit.teacherExtId || "", visit.schoolExtId || null),
    [visit.teacherExtId, visit.schoolExtId],
  );

  const openRecent = () => {
    setRecentOpen(true);
    if (recent == null) {
      loadTheirRecent().then((r) => setRecent((r && r.plans) || [])).catch(() => setRecent([]));
    }
  };

  const onPlanPhoto = (file: File | undefined) => {
    setPlanError(null);
    if (!file) return;
    if (checkFile(file, "lesson_plan")) { setPlanError(C.planNotOk); return; }
    setPlan({ kind: "file", file, title: C.planPhoto, sub: C.takenNow });
  };

  const onLibraryPick = useCallback((p: PickedPlan) => {
    setPlan({ kind: "library", pick: p.pick, title: p.title, sub: p.sub });
    setStage("check");
  }, []);

  const send = () => {
    startSend({
      visitId: visit.id,
      teacherExtId: visit.teacherExtId || "",
      schoolExtId: visit.schoolExtId || null,
      teacherName,
      visitDay: visit.scheduledFor,
      durationMs: audio.durationMs,
      recordingId: audio.recordingId,
      audio: { blob: audio.blob, filename: audio.filename },
      plan: plan ? (plan.kind === "library" ? { kind: "library", pick: plan.pick } : { kind: "file", file: plan.file }) : null,
      photos,
    });
    navigate(sendingPath(visit.id));
  };

  const crumb = <>{teacherName} · <TimeStamp time={visit.scheduledSlot} size={13} /></>;

  if (stage === "library") {
    return (
      <ObservePage banner={false} title={C.library} crumb={crumb}
        onBack={() => (libraryLevel > 0 ? setLibraryBack((n) => n + 1) : setStage("check"))}>
        <LibraryPicker onPick={onLibraryPick} onStepChange={setLibraryLevel} backSignal={libraryBack}
          loadRecent={loadTheirRecent} recentTitle={C.theirRecentPlans} showUsed={false} />
      </ObservePage>
    );
  }

  return (
    <ObservePage banner={false} title={C.checkAndSend} crumb={crumb} backTo={`/portal/coach/visit/${visit.id}`} feature="observations"
      dock={(
        <button type="button" onClick={send}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white">
          <Send className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />{C.sendObservation}
        </button>
      )}>
      <Card className="flex min-h-[84px] items-center gap-3 p-3">
        <button type="button" onClick={togglePlay} aria-label={playing ? C.stopPlaying : C.play}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#48b078] bg-white text-[#48b078]">
          {playing ? <Pause className="h-6 w-6" aria-hidden="true" /> : <Play className="h-6 w-6 fill-current" aria-hidden="true" />}
        </button>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[17px] font-semibold" dir="auto">{audio.label}</span>
          <span className="truncate text-[13px] text-[#6b7280]" dir="auto">{audio.sub}</span>
        </span>
        <button type="button" onClick={redo}
          className="flex min-h-[56px] items-center justify-center gap-1.5 rounded-xl bg-[#f3f4f6] px-3.5 text-sm font-semibold text-[#33374a]">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />{C.redo}
        </button>
      </Card>
      {isShort && <Alert>{C.shortWarning}</Alert>}

      <SectionHeading chip={C.optional}>{C.lessonPlan}</SectionHeading>
      {plan ? (
        <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white" data-testid="chosen-plan">
          <ListRow variant="row" first icon="file" label={plan.title} subtitle={plan.sub} chip={{ text: C.removePlan, tone: "score" }} onPress={() => setPlan(null)} />
        </div>
      ) : (
        <div className="[display:grid] grid-cols-3 gap-2.5">
          <Tile icon={<Clock className="h-[22px] w-[22px]" />} label={C.theirRecentPlans} onClick={openRecent} />
          <Tile icon={<Library className="h-[22px] w-[22px]" />} label={C.library} onClick={() => { setLibraryLevel(0); setStage("library"); }} />
          <Tile icon={<Camera className="h-[22px] w-[22px]" />} label={C.planPhoto} onClick={() => planPhotoInput.current?.click()} />
        </div>
      )}
      {/* accept must be exactly image/*: Capacitor opens the camera only then. The type is still checked on arrival. */}
      <input ref={planPhotoInput} data-testid="plan-photo-input" type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { onPlanPhoto(e.target.files?.[0]); e.target.value = ""; }} />
      {planError && <Alert>{planError}</Alert>}

      <SectionHeading chip={[C.upToN(MAX_PHOTOS), C.noFaces]}>{C.photos}</SectionHeading>
      <PhotoGrid photos={photos} onChange={setPhotos} testId="photos-input" />

      <Tray open={recentOpen} title={C.theirRecentPlans} onClose={() => setRecentOpen(false)}>
        {recent == null && <Loading />}
        {recent && recent.length === 0 && <div className="py-4 text-center text-[15px] text-[#6b7280]">{C.noRecentPlans}</div>}
        {recent && recent.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
            {recent.map((p, i) => (
              <ListRow key={p.assetId} variant="row" first={i === 0} icon="file" label={p.topic || C.lessonPlan} subtitle={planSub(p, C) || undefined}
                onPress={() => {
                  setPlan({ kind: "library", pick: { assetId: p.assetId }, title: p.topic || C.lessonPlan, sub: planSub(p, C) });
                  setRecentOpen(false);
                }} />
            ))}
          </div>
        )}
      </Tray>
    </ObservePage>
  );
}

const CoachCheckSend = () => {
  const C = useCopy(OBSERVE);
  const { id = "" } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getVisit(id), [id]);
  const [audio, setAudio] = useState<DraftAudio | null>(() => getDraft(id));
  const [looked, setLooked] = useState(() => getDraft(id) != null);
  const job = useSendJob(id);
  const visit = data?.visit;

  // A reload: a recording made for this teacher is still on the phone.
  useEffect(() => {
    if (audio || !visit) return undefined;
    let live = true;
    latestUnsent().then(async (u) => {
      const who = u ? recordingTeacher(u.meta.id) : null;
      if (live && u && who && who.teacherExtId === visit.teacherExtId) {
        const blob = await withDuration(u.blob, u.meta.ext, u.meta.elapsedMs);
        const found: DraftAudio = {
          blob, filename: lessonFilename(u.meta.ext, new Date(u.meta.startedAt)), durationMs: u.meta.elapsedMs || null,
          recordingId: u.meta.id, label: C.observationOf(visit.teacherName || C.dash),
          sub: [lengthShort(u.meta.elapsedMs, C),
            new Date(u.meta.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · "),
        };
        setDraft(id, found);
        if (live) setAudio(found);
      }
    }).catch(() => {}).finally(() => { if (live) setLooked(true); });
    return () => { live = false; };
  }, [audio, visit, id, C]);

  // Being sent already: that is the page to be on.
  if (job?.state === "sending") return <Navigate to={sendingPath(id)} replace />;
  if (visit && (visit.status !== "upcoming" || !visit.teacherExtId)) return <Navigate to={`/portal/coach/visit/${id}`} replace />;
  if (visit && audio) return <CheckSend visit={visit} audio={audio} />;

  return (
    <ObservePage banner={false} title={C.checkAndSend} backTo={`/portal/coach/visit/${id}`} feature="observations"
      crumb={visit ? <>{visit.teacherName || C.dash} · <TimeStamp time={visit.scheduledSlot} size={13} /></> : undefined}>
      {failed && <Failed onRetry={reload} />}
      {(!data || !looked) && !failed && <Loading />}
      {visit && looked && !audio && (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-xl font-light">{C.noRecording}</h2>
          <div className="[display:grid] grid-cols-2 gap-2.5">
            <Link to={`/portal/coach/visit/${id}/record`} className="flex h-14 items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.startRecording}</Link>
            <Link to={`/portal/coach/visit/${id}/attach`} className="flex h-14 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025]">{C.uploadRecording}</Link>
          </div>
        </Card>
      )}
    </ObservePage>
  );
};

export default CoachCheckSend;
