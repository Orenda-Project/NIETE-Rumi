import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, BookOpen, Camera, Clock, ImagePlus, Library, Pause, Play, RotateCcw, Send, Upload, WifiOff, X } from "lucide-react";
import { coach, leader, type RecentLessonPlan } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, Chip, SectionLabel, Loading, Failed, useLoad, Chevron } from "../ui";
import { formatSlot } from "../time";
import { clearDraft, getDraft, setDraft, type DraftAudio } from "../observeDraft";
import LibraryPicker, { type PickedPlan } from "../../components/coaching/LibraryPicker";
import { acceptFor, checkFile, MAX_PHOTOS, minutesText, SHORT_RECORDING_SECONDS } from "../../lib/coachingUpload";
import { SendError, type LibraryPick } from "../../lib/coachingSend";
import { forgetRecording, recordingTeacher, sendObservation } from "../../lib/coachObserve";
import { deleteRecording, latestUnsent } from "../../lib/recordingStore";
import { withDuration } from "../../lib/webmDuration";
import { lessonFilename } from "./CoachRecord";
import type { CoachVisit } from "../types";

/**
 * bd-o15qnr.9 — Check and send, for one scheduled visit (v18 CheckSend.dc.html):
 * the recording (play, Redo), the lesson plan — optional: their recent plans,
 * the library, or a photo of the plan — then up to three board photos (no
 * faces), and Send. Sent, it goes to Reports, where the observation shows as
 * being analysed.
 *
 * Sending is the existing pipeline's: coachObserve.sendObservation (every file
 * to R2 first, then the start) with THIS visit's teacher and school, so
 * portal-observe's markDone ties the session to the schedule entry. The checks
 * are coachingUpload's (MAX_PHOTOS, file types, the short-recording rule). The
 * library browse is the existing LibraryPicker inside the v2 page (the canvas
 * has no screen for it). Words about the teacher stay neutral.
 */

type Plan =
  | { kind: "library"; pick: LibraryPick; title: string; sub: string }
  | { kind: "file"; file: File; title: string; sub: string };

type Stage = "check" | "library" | "sending" | "failed";

function useObjectUrls(files: File[]): string[] {
  const urls = useMemo(
    () => files.map((f) => (typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : "")),
    [files],
  );
  useEffect(() => () => { urls.forEach((u) => { if (u && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(u); }); }, [urls]);
  return urls;
}

function Tile({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-[112px] flex-col items-start justify-between gap-2.5 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-left text-sm font-semibold leading-tight text-[#1d2025] shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
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

function CheckSend({ visit, audio }: { visit: CoachVisit; audio: DraftAudio }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("check");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<RecentLessonPlan[] | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [libraryLevel, setLibraryLevel] = useState(0);
  const [libraryBack, setLibraryBack] = useState(0);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<SendError | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const planPhotoInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const thumbs = useObjectUrls(photos);
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
    setPlan({ kind: "file", file, title: C.photoOfPlan, sub: C.takenNow });
  };

  const onPhotos = (list: FileList | File[] | null) => {
    setPhotosError(null);
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    if (chosen.some((f) => checkFile(f, "photo"))) { setPhotosError(C.notAPhoto); return; }
    const next = [...photos, ...chosen];
    if (next.length > MAX_PHOTOS) { setPhotosError(C.tooManyPhotos(MAX_PHOTOS)); return; }
    setPhotos(next);
  };

  const onLibraryPick = useCallback((p: PickedPlan) => {
    setPlan({ kind: "library", pick: p.pick, title: p.title, sub: p.sub });
    setStage("check");
  }, []);

  const send = async () => {
    setFailure(null);
    setProgress(0);
    setStage("sending");
    try {
      await sendObservation({
        teacherExtId: visit.teacherExtId || "",
        schoolExtId: visit.schoolExtId || null,
        audio: { blob: audio.blob, filename: audio.filename },
        plan: plan ? (plan.kind === "library" ? { kind: "library", pick: plan.pick } : { kind: "file", file: plan.file }) : null,
        photos,
      }, undefined, undefined, setProgress);
      if (audio.recordingId) {
        try { await deleteRecording(audio.recordingId); } catch { /* gone */ }
        forgetRecording(audio.recordingId);
      }
      clearDraft(visit.id);
      navigate("/portal/coach/reports");
    } catch (err) {
      setFailure(err instanceof SendError ? err : new SendError("network"));
      setStage("failed");
    }
  };

  const crumb = `${teacherName} · ${formatSlot(visit.scheduledSlot)}`;

  if (stage === "library") {
    return (
      <CoachPage title={C.library} crumb={crumb}
        onBack={() => (libraryLevel > 0 ? setLibraryBack((n) => n + 1) : setStage("check"))}>
        <LibraryPicker onPick={onLibraryPick} onStepChange={setLibraryLevel} backSignal={libraryBack}
          loadRecent={loadTheirRecent} recentTitle={C.theirRecentPlans} showUsed={false} />
      </CoachPage>
    );
  }

  if (stage === "sending") {
    return (
      <CoachPage bare title={C.checkAndSend} crumb={crumb}>
        <Card className="flex flex-col items-center gap-4 p-6 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]"><Upload className="h-9 w-9" aria-hidden="true" /></span>
          <h2 className="text-xl font-semibold">{C.sending(teacherName)}</h2>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#e5e7eb]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span className="block h-full rounded-full bg-[#48b078] transition-[width]" style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
          <div className="text-lg font-bold text-[#2f7a52]">{progress}%</div>
          <p className="text-[15px] text-[#4b5563]">{C.keepOpenSending}</p>
        </Card>
      </CoachPage>
    );
  }

  if (stage === "failed" && failure) {
    const planIssue = failure.kind === "plan_not_ready" || failure.kind === "plan_not_found";
    const notMine = failure.message === "not_your_teacher";
    return (
      <CoachPage title={C.checkAndSend} crumb={crumb} onBack={() => setStage("check")}>
        <Card className="flex flex-col items-center gap-4 p-6 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#fef3c7] text-[#b45309]">
            {failure.kind === "network" ? <WifiOff className="h-9 w-9" aria-hidden="true" /> : <AlertTriangle className="h-9 w-9" aria-hidden="true" />}
          </span>
          {failure.kind === "network" && (
            <>
              <h2 className="text-xl font-semibold">{C.netTitle}</h2>
              <p className="text-[15px] text-[#4b5563]">{C.netSafe}</p>
              <button type="button" onClick={send} className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.tryAgain}</button>
            </>
          )}
          {planIssue && (
            <>
              <p className="text-[15px] text-[#4b5563]">{C.planProblem}</p>
              <button type="button" onClick={() => { setPlan(null); setStage("check"); }} className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.lessonPlan}</button>
            </>
          )}
          {!planIssue && failure.kind !== "network" && (
            <>
              <p className="text-[15px] text-[#4b5563]">{notMine ? C.notYourTeacher : C.refused}</p>
              <button type="button" onClick={() => (notMine ? navigate(`/portal/coach/visit/${visit.id}`) : setStage("check"))}
                className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.tryAgain}</button>
            </>
          )}
        </Card>
      </CoachPage>
    );
  }

  return (
    <CoachPage title={C.checkAndSend} crumb={crumb} backTo={`/portal/coach/visit/${visit.id}`}
      dock={(
        <button type="button" onClick={send}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white">
          <Send className="h-5 w-5" aria-hidden="true" />{C.send}
        </button>
      )}>
      <Card className="flex min-h-[84px] items-center gap-3 p-3">
        <button type="button" onClick={togglePlay} aria-label={playing ? C.stopPlaying : C.play}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#48b078] bg-white text-[#48b078]">
          {playing ? <Pause className="h-6 w-6" aria-hidden="true" /> : <Play className="h-6 w-6 fill-current" aria-hidden="true" />}
        </button>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[17px] font-semibold">{audio.label}</span>
          <span className="truncate text-[13px] text-[#6b7280]">{audio.sub}</span>
        </span>
        <button type="button" onClick={redo}
          className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-[#f3f4f6] px-3.5 text-sm font-semibold text-[#33374a]">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />{C.redo}
        </button>
      </Card>
      {isShort && <Alert>{C.shortWarning}</Alert>}

      <SectionLabel>{C.lessonPlan} <span className="ms-1 align-middle"><Chip>{C.optional}</Chip></span></SectionLabel>
      {plan ? (
        <Card className="flex min-h-[72px] items-center gap-3 p-3" data-testid="chosen-plan">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]" aria-hidden="true">
            {plan.kind === "library" ? <BookOpen className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[17px] font-semibold">{plan.title}</span>
            <span className="truncate text-[13px] text-[#6b7280]">{plan.sub}</span>
          </span>
          <button type="button" onClick={() => setPlan(null)} aria-label={C.removePlan}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]"><X className="h-5 w-5" aria-hidden="true" /></button>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-2.5">
          <Tile icon={<Clock className="h-[22px] w-[22px]" />} label={C.theirRecentPlans} onClick={openRecent} />
          <Tile icon={<Library className="h-[22px] w-[22px]" />} label={C.library} onClick={() => { setLibraryLevel(0); setStage("library"); }} />
          <Tile icon={<Camera className="h-[22px] w-[22px]" />} label={C.photoOfPlan} onClick={() => planPhotoInput.current?.click()} />
        </div>
      )}
      {/* accept must be exactly image/*: Capacitor opens the camera only then. The type is still checked on arrival. */}
      <input ref={planPhotoInput} data-testid="plan-photo-input" type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { onPlanPhoto(e.target.files?.[0]); e.target.value = ""; }} />
      {planError && <Alert>{planError}</Alert>}

      <SectionLabel>
        {C.boardPhotos} <span className="ms-1 inline-flex gap-1.5 align-middle"><Chip>{C.upToN(MAX_PHOTOS)}</Chip><Chip>{C.noFaces}</Chip></span>
      </SectionLabel>
      <div className="grid grid-cols-3 gap-2.5">
        {photos.map((p, i) => (
          <div key={`${p.name}-${i}`} data-testid="board-photo" className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[14px] bg-[#dfe3ea] text-xs text-[#6b7280]">
            {thumbs[i] ? <img src={thumbs[i]} alt="" className="h-full w-full object-cover" /> : <span className="truncate px-2">{p.name}</span>}
            <button type="button" aria-label={C.removePhoto(p.name)} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
              className="absolute end-1 top-1 flex h-11 w-11 items-center justify-center">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(17,24,39,0.6)] text-white"><X className="h-4 w-4" aria-hidden="true" /></span>
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <button type="button" onClick={() => photosInput.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-[#c7cad6] bg-white text-sm font-semibold text-[#33374a]">
            <ImagePlus className="h-6 w-6" aria-hidden="true" />{C.addPhoto}
          </button>
        )}
        {Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length - 1) }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square rounded-[14px] border-[1.5px] border-dashed border-[#e5e7eb]" aria-hidden="true" />
        ))}
      </div>
      <input ref={photosInput} data-testid="photos-input" type="file" multiple accept={`${acceptFor("photo")},image/jpeg,image/png`} className="hidden"
        onChange={(e) => { onPhotos(e.target.files); e.target.value = ""; }} />
      {photosError && <Alert>{photosError}</Alert>}

      {recentOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(17,24,39,0.5)] md:items-center md:justify-center">
          <section role="dialog" aria-modal="true" aria-label={C.theirRecentPlans}
            className="flex max-h-[80vh] w-full flex-col gap-3 overflow-y-auto rounded-t-3xl bg-white px-4 pb-6 pt-2.5 md:max-w-md md:rounded-3xl">
            <div className="h-1 w-10 self-center rounded-full bg-[#d1d5db]" aria-hidden="true" />
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-2xl font-light">{C.theirRecentPlans}</h2>
              <button type="button" onClick={() => setRecentOpen(false)} aria-label={C.close} className="-me-2 flex h-14 w-14 items-center justify-center text-[#33374a]"><X className="h-6 w-6" aria-hidden="true" /></button>
            </div>
            {recent == null && <Loading />}
            {recent && recent.length === 0 && <div className="py-4 text-center text-[15px] text-[#6b7280]">{C.noRecentPlans}</div>}
            {recent && recent.map((p) => (
              <button key={p.assetId} type="button"
                onClick={() => {
                  setPlan({ kind: "library", pick: { assetId: p.assetId }, title: p.topic || C.lessonPlan, sub: [p.grade != null ? `Grade ${p.grade}` : null, p.subject].filter(Boolean).join(" · ") });
                  setRecentOpen(false);
                }}
                className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white p-3 text-left">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]" aria-hidden="true"><BookOpen className="h-5 w-5" /></span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-base font-semibold">{p.topic || C.lessonPlan}</span>
                  <span className="truncate text-[13px] text-[#6b7280]">{[p.grade != null ? `Grade ${p.grade}` : null, p.subject].filter(Boolean).join(" · ")}</span>
                </span>
                <Chevron />
              </button>
            ))}
          </section>
        </div>
      )}
    </CoachPage>
  );
}

const CoachCheckSend = () => {
  const { id = "" } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getVisit(id), [id]);
  const [audio, setAudio] = useState<DraftAudio | null>(() => getDraft(id));
  const [looked, setLooked] = useState(() => getDraft(id) != null);
  const visit = data?.visit;

  // A reload: a lesson recorded for this teacher is still on the phone.
  useEffect(() => {
    if (audio || !visit) return undefined;
    let live = true;
    latestUnsent().then(async (u) => {
      const who = u ? recordingTeacher(u.meta.id) : null;
      if (live && u && who && who.teacherExtId === visit.teacherExtId) {
        const blob = await withDuration(u.blob, u.meta.ext, u.meta.elapsedMs);
        const found: DraftAudio = {
          blob, filename: lessonFilename(u.meta.ext, new Date(u.meta.startedAt)), durationMs: u.meta.elapsedMs || null,
          recordingId: u.meta.id, label: C.lessonOf(visit.teacherName || C.dash),
          sub: [u.meta.elapsedMs ? minutesText(u.meta.elapsedMs) : null,
            new Date(u.meta.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · "),
        };
        setDraft(id, found);
        if (live) setAudio(found);
      }
    }).catch(() => {}).finally(() => { if (live) setLooked(true); });
    return () => { live = false; };
  }, [audio, visit, id]);

  if (visit && (visit.status !== "upcoming" || !visit.teacherExtId)) return <Navigate to={`/portal/coach/visit/${id}`} replace />;
  if (visit && audio) return <CheckSend visit={visit} audio={audio} />;

  return (
    <CoachPage title={C.checkAndSend} backTo={`/portal/coach/visit/${id}`}
      crumb={visit ? `${visit.teacherName || C.dash} · ${formatSlot(visit.scheduledSlot)}` : undefined}>
      {failed && <Failed onRetry={reload} />}
      {(!data || !looked) && !failed && <Loading />}
      {visit && looked && !audio && (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-xl font-light">{C.noRecording}</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <Link to={`/portal/coach/visit/${id}/record`} className="flex h-14 items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.recordLive}</Link>
            <Link to={`/portal/coach/visit/${id}/attach`} className="flex h-14 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025]">{C.attachRecording}</Link>
          </div>
        </Card>
      )}
    </CoachPage>
  );
};

export default CoachCheckSend;
