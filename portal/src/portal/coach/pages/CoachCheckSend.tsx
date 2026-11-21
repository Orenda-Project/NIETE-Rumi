import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, BookOpen, Camera, ChevronRight, Clock, FolderOpen, Image as ImageIcon, Library, Paperclip, RotateCcw, Send } from "lucide-react";
import { useCopy } from "../../teacher/i18n";
import { PhotoGrid, SectionHeading } from "../../teacher/coaching/parts";
import { AudioCard, ChoicePair, ChosenSoFar, ListRow, SelectField } from "../../teacher/ui";
import { LIST_CARD } from "../../teacher/ui/styles";
import { Tray } from "../../teacher/ui/Tray";
import { TimeStamp } from "../../teacher/ui/TimeStamp";
import { StatusChip } from "../../teacher/ui/StatusChip";
import { leader, type ObserveLesson, type ObserveLessonQuestion, type ObserveRecentPlan } from "../../services/api";
import { downloadsOnly, isOwnPlan } from "../../lib/observeRecentPlans";
import { planClassOf, recentForClass } from "../../lib/observePlanClass";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { PLAN_V7 } from "../flow/copyV7plan";
import { Card, Loading, Failed, useLoad } from "../ui";
import { clearDraft, getDraft, setDraft, type DraftAudio } from "../observeDraft";
import LibraryPicker, { type PickedPlan } from "../../components/coaching/LibraryPicker";
import { checkPlanFile, formatSize, MAX_PHOTOS, PLAN_FILE_EXTENSIONS, PLAN_MAX_MB, planKindOf, SHORT_RECORDING_SECONDS } from "../../lib/coachingUpload";
import type { LibraryPick } from "../../lib/coachingSend";
import { forgetRecording, recordingTeacher } from "../../lib/coachObserve";
import { deleteRecording, latestUnsent } from "../../lib/recordingStore";
import { withDuration } from "../../lib/webmDuration";
import { holdFile, isFileRefused, tellUnreadablePick } from "../../lib/pickedRead";
import { OBSERVE, type ObserveCopy } from "../observe/copy";
import { lengthShort, madeWhen, planKindLabel } from "../observe/format";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import type { TeacherUiCopy } from "../../teacher/ui/copy";
import ObservePage from "../observe/ObservePage";
import { useObserveRoutes } from "../observe/observeRoutes";
import { startSend, useSendJob } from "../observe/sender";
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
 *
 * bd-fmf24g.66 — "Their own plan" (the third tile; it was a camera-only "Plan photo"): the teacher often taught from her own
 * PDF, Word file or photo. One sheet, Camera / Gallery / Files, each its own hidden input (outside the sheet, so a pick
 * is not lost when the sheet closes). The file is checked on arrival (.pdf .docx .jpg .jpeg .png, 25 MB; no .doc) and goes
 * up with the recording as the plan; the bot reads it and scores Section B from it.
 *
 * bd-tymy1n (queue #179) — every file she picks here is READ when she picks it and the page keeps the bytes: the photos
 * (PhotoGrid readOnPick, as the teacher's Digital Coaching since bd-r2uzg1.9) and her own plan. In the Android app the
 * picked file could no longer be opened by Send (production 18 Nov: 8 sends, each stopped on photo 1). A file that will
 * not open is refused right here, with its reason in the logs.
 *
 * bd-o15qnr.33 (queue #204; the operator 21 Nov ~09:10: "when selecting a lesson plan, it should have already filtered down
 * to that subject grades Lesson Plans. In both, Recent ones or Library. Also, combine these 2 together. It should be Attach
 * Lesson Plan. Then 2 buttons, nietes lp or attach teachers lp ... On nietes lp, show in a tray their 3 last recent plans of
 * that grade subject, or give them the chapter picker to select their own. If they attach, give them the camera vs attach
 * one."), behind the v6/v7 switch (useFlowV6 true; off or still being read, the three tiles as before): ONE section,
 * Attach lesson plan, with two choices (the kit's ChoicePair).
 *   NIETE lesson plan   a Tray: the teacher's three newest plans for the class answered above (Grade 1-5 = grades 1 to 5;
 *                       a grade 9-12 the grade alone), filtered here from the same recent list (lib/observePlanClass), then
 *                       Pick a chapter: the same LibraryPicker as Library, opened on that class (its grade and subject
 *                       steps taken for her, Back straight back here). No class answered (not asked, or not yet): the
 *                       newest three, and the full picker. Sending never waits for it.
 *   Teacher's own plan  a Tray: Camera (the capture input) / Attach file (the file picker), the same hidden inputs.
 * Whatever is picked goes up exactly as before (the same `plan` to startSend). Once attached, the plan reads as plain words
 * (the kit's ChosenSoFar: which choice, its title, its line) with Change (that choice's tray again) and Remove plan.
 */

type Plan =
  | { kind: "library"; pick: LibraryPick; title: string; sub: string }
  | { kind: "file"; file: File; title: string; sub: string };

type PlanSource = "camera" | "gallery" | "files";

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

const Alert = ({ children, chips }: { children: ReactNode; chips?: string[] }) => (
  <div role="alert" className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] text-[#b45309]">
    <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1">{children}</span>
    {chips?.map((c) => <StatusChip key={c} text={c} tone="info" className="bg-white" />)}
  </div>
);

/** A row of the "Their own plan" sheet: a 64px button, a green icon disc, the word, ›. */
function SheetRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex min-h-[64px] items-center gap-3.5 rounded-2xl border border-[#e5e7eb] bg-white px-3 text-start text-[17px] font-semibold text-[#1d2025] shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#eaf6ef] text-[#48b078]" aria-hidden="true">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-5 w-5 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
    </button>
  );
}

// bd-snkn32.41 — a plan she made herself says so, and names its chapter; bd-brv7rs — and when (Pakistan time), so two
// of her plans for the same lesson read differently.
const planSub = (p: ObserveRecentPlan, C: ObserveCopy, kit: Pick<TeacherUiCopy, "am" | "pm">) => {
  const own = isOwnPlan(p);
  return [own ? C.madeByTeacher : null, p.grade != null ? C.grade(Number(p.grade)) : null, p.subject,
    own && p.chapterNumber != null ? C.chapterN(p.chapterNumber) : null,
    own ? madeWhen(p.madeAt, { ...C, am: kit.am, pm: kit.pm }) : null].filter(Boolean).join(" · ");
};

function CheckSend({ visit, audio }: { visit: CoachVisit; audio: DraftAudio }) {
  const routes = useObserveRoutes();
  const C = useCopy(OBSERVE);
  const kit = useKitCopy();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("check");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<"wrong_type" | "too_large" | "wont_open" | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  // bd-o15qnr.33 — the NIETE lesson plan tray (switch on).
  const [nieteOpen, setNieteOpen] = useState(false);
  const v7 = useFlowV6() === true;
  const P = useCopy(PLAN_V7);
  const [recent, setRecent] = useState<ObserveRecentPlan[] | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [libraryLevel, setLibraryLevel] = useState(0);
  const [libraryBack, setLibraryBack] = useState(0);
  const planPhotoInput = useRef<HTMLInputElement>(null);
  const planGalleryInput = useRef<HTMLInputElement>(null);
  const planFileInput = useRef<HTMLInputElement>(null);
  const teacherName = visit.teacherName || C.dash;
  const isShort = audio.durationMs != null && audio.durationMs < SHORT_RECORDING_SECONDS * 1000;
  // bd-ra8xu.40 — the class taught (and, for grades 6-12, its subject), asked only while FDE's tools are on for her, as
  // WhatsApp's visit planner asks after Start: it chooses the form the observation is stamped with. A question that
  // cannot be read asks nothing (today's path).
  const [question, setQuestion] = useState<ObserveLessonQuestion>({ ask: false });
  const [grade, setGrade] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [lessonProblem, setLessonProblem] = useState<"class" | "subject" | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => leader.getObserveLessonQuestion())
      .then((q) => { if (live && q && q.ask) setQuestion(q); })
      .catch(() => { /* not asked */ });
    return () => { live = false; };
  }, []);
  // bd-ra8xu.40 (operator, 12 Nov): only FDE's grades (6-8) ask the subject; grades 9-12 are FICO lessons, the class alone.
  // An older bot that does not say which grades: every grade 6-12 asks it, as before.
  const needsSubject = (g: string | null) => !!g && g !== "primary" && (question.subjectGrades ? question.subjectGrades.includes(Number(g)) : true);
  // bd-o15qnr.33 — the class answered above, as the filter for her plans and the library (null: nothing answered).
  const planClass = v7 && question.ask ? planClassOf(grade, needsSubject(grade) ? subject : null) : null;
  const classLabel = planClass
    ? [grade === "primary" ? C.gradePrimary : C.grade(Number(grade)),
      planClass.subject ? ((C.subjects as Record<string, string>)[planClass.subject] || planClass.subject) : null].filter(Boolean).join(" · ")
    : null;
  const lessonOf = (): ObserveLesson | null => {
    if (!question.ask || !grade) return null;
    if (grade === "primary") return { primary: true };
    if (!needsSubject(grade)) return { grade: Number(grade) };
    return subject ? { grade: Number(grade), subject } : null;
  };

  // The recording plays from a link to the file on this phone (AudioCard plays it for real).
  const src = useMemo(() => (typeof URL.createObjectURL === "function" ? URL.createObjectURL(audio.blob) : undefined), [audio.blob]);
  useEffect(() => () => { if (src && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(src); }, [src]);

  const redo = async () => {
    if (audio.recordingId) {
      try { await deleteRecording(audio.recordingId); } catch { /* gone */ }
      forgetRecording(audio.recordingId);
    }
    clearDraft(visit.id);
    navigate(audio.recordingId ? routes.record(visit.id) : routes.attach(visit.id), { replace: true });
  };

  const loadTheirRecent = useCallback(
    () => leader.getObserveRecentPlans(visit.teacherExtId || "", visit.schoolExtId || null),
    [visit.teacherExtId, visit.schoolExtId],
  );

  const loadRecentOnce = () => {
    if (recent == null) {
      loadTheirRecent().then((r) => setRecent((r && r.plans) || [])).catch(() => setRecent([]));
    }
  };

  const openRecent = () => {
    setRecentOpen(true);
    loadRecentOnce();
  };

  // bd-o15qnr.33 — NIETE lesson plan: the same recent list, read once, filtered to the class.
  const openNiete = () => {
    setNieteOpen(true);
    loadRecentOnce();
  };

  /** A recent plan picked (today's tray or the NIETE one): the same pick as always. */
  const pickRecent = (p: ObserveRecentPlan) => {
    setPlan({ kind: "library", pick: isOwnPlan(p) ? { ownId: p.ownId } : { assetId: p.assetId }, title: p.topic || C.lessonPlan, sub: planSub(p, C, kit) });
    setRecentOpen(false);
    setNieteOpen(false);
  };

  const openPicker = () => {
    setNieteOpen(false);
    setLibraryLevel(0);
    setStage("library");
  };

  const onPlanFile = async (picked: File | undefined, source: PlanSource) => {
    setPlanError(null);
    if (!picked) return;
    setOwnOpen(false);
    const problem = checkPlanFile(picked);
    if (problem) { setPlanError(problem); return; }
    // bd-tymy1n: read now, while the phone still opens it; the plan that goes up is these bytes.
    const out = await holdFile(picked);
    if (isFileRefused(out)) { tellUnreadablePick("lesson_plan", picked, out.errName); setPlanError("wont_open"); return; }
    const file = out.file;
    // A photo just taken has no useful name; a chosen file is shown by its own name and what it is.
    if (source === "camera") { setPlan({ kind: "file", file, title: C.planPhoto, sub: C.takenNow }); return; }
    const kind = planKindLabel(planKindOf(picked.name), C);
    setPlan({ kind: "file", file, title: picked.name, sub: [kind, formatSize(picked.size)].filter(Boolean).join(" · ") });
  };

  const onLibraryPick = useCallback((p: PickedPlan) => {
    setPlan({ kind: "library", pick: p.pick, title: p.title, sub: p.sub });
    setStage("check");
  }, []);

  const send = () => {
    if (question.ask && !grade) { setLessonProblem("class"); return; }
    if (question.ask && needsSubject(grade) && !subject) { setLessonProblem("subject"); return; }
    const lesson = lessonOf();
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
      ...(lesson ? { lesson } : {}),
      // bd-33wxxi.4 — where the strip's tap and the ready banner go (the principal app's own screens, or the coach's).
      waitHref: routes.sending(visit.id),
      observationHref: (obsId) => routes.observation(obsId),
    });
    navigate(routes.sending(visit.id), { replace: true }); // Check and send is done: Back from Sending is never this page (it would bounce straight on)
  };

  // A visit without a time (the principal app's picked teacher, bd-33wxxi.4) shows the name alone, never "Name ·".
  const crumb = <>{teacherName}{visit.scheduledSlot && <> · <TimeStamp time={visit.scheduledSlot} size={13} /></>}</>;

  if (stage === "library") {
    return (
      <ObservePage banner={false} title={v7 ? P.nietePlan : C.library} crumb={crumb}
        onBack={() => (libraryLevel > 0 ? setLibraryBack((n) => n + 1) : setStage("check"))}>
        {v7 ? (
          // bd-o15qnr.33 — Pick a chapter: the picker on the class answered above; her recent plans were in the tray.
          <LibraryPicker onPick={onLibraryPick} onStepChange={setLibraryLevel} backSignal={libraryBack}
            only={planClass} hideRecent showUsed={false} />
        ) : (
          <LibraryPicker onPick={onLibraryPick} onStepChange={setLibraryLevel} backSignal={libraryBack}
            loadRecent={() => loadTheirRecent().then(downloadsOnly)} recentTitle={C.theirRecentPlans} showUsed={false} />
        )}
      </ObservePage>
    );
  }

  const shownRecent = recent ? recentForClass(recent, planClass) : [];

  return (
    <ObservePage banner={false} title={C.checkAndSend} crumb={crumb} backTo={routes.visit(visit.id)} feature="observations"
      dock={(
        <button type="button" onClick={send}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#33374a] text-base font-semibold text-white">
          <Send className="h-5 w-5 rtl:-scale-x-100" aria-hidden="true" />{C.sendObservation}
        </button>
      )}>
      <AudioCard title={audio.label} sub={audio.sub} src={src}
        action={(
          <button type="button" onClick={redo}
            className="flex min-h-[56px] items-center justify-center gap-1.5 rounded-xl bg-[#f3f4f6] px-3.5 text-sm font-semibold text-[#33374a]">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />{C.redo}
          </button>
        )} />
      {isShort && <Alert>{C.shortWarning}</Alert>}

      {/* bd-o15qnr.29 (the operator 21 Nov ~09:00: "it asks for Grade Subject in a weird chips type way. Make it how it used
          to be"): the dropdowns for everyone, switch on or off (v7's chips are gone). */}
      {question.ask && (
        <>
          <SectionHeading>{C.classAndSubject}</SectionHeading>
          <div className="flex flex-col gap-2.5" data-testid="lesson-class">
            <SelectField label={C.classField} title={C.classField} value={grade}
              options={[{ value: "primary", label: C.gradePrimary }, ...(question.grades || []).map((g) => ({ value: String(g), label: C.grade(g) }))]}
              onChange={(v) => { setGrade(v); if (!needsSubject(v)) setSubject(null); setLessonProblem(null); }} />
            {needsSubject(grade) && (
              <SelectField label={C.subjectField} title={C.subjectField} value={subject}
                options={(question.subjects || []).map((k) => ({ value: k, label: (C.subjects as Record<string, string>)[k] || k }))}
                onChange={(v) => { setSubject(v); setLessonProblem(null); }} />
            )}
          </div>
          {lessonProblem === "class" && <Alert>{C.chooseClassFirst}</Alert>}
          {lessonProblem === "subject" && <Alert>{C.chooseSubjectFirst}</Alert>}
        </>
      )}

      {v7 ? (
        <>
          <SectionHeading chip={C.optional}>{P.attachPlan}</SectionHeading>
          {plan ? (
            <div className={`${LIST_CARD} flex flex-col px-3 py-1`} data-testid="chosen-plan">
              <ChosenSoFar heading={P.attachPlan}
                items={[{ label: plan.kind === "file" ? P.ownPlan : P.nietePlan, value: plan.title, sub: plan.sub || undefined,
                  onChange: () => (plan.kind === "file" ? setOwnOpen(true) : openNiete()) }]} />
              <div className="flex justify-end border-t border-[#e5e7eb]">
                <button type="button" onClick={() => setPlan(null)} className="flex min-h-[56px] items-center px-0.5">
                  <span className="inline-flex h-9 items-center rounded-full border-[1.5px] border-[#c7cad6] bg-white px-3.5 text-[14px] font-semibold text-[#33374a]">{C.removePlan}</span>
                </button>
              </div>
            </div>
          ) : (
            <ChoicePair compact items={[
              { key: "niete", label: P.nietePlan, art: <BookOpen className="h-[22px] w-[22px]" />, onPress: openNiete, testId: "attach-niete" },
              { key: "own", label: P.ownPlan, art: <Paperclip className="h-[22px] w-[22px]" />, onPress: () => setOwnOpen(true), testId: "attach-own" },
            ]} />
          )}
        </>
      ) : (
        <>
          <SectionHeading chip={C.optional}>{C.lessonPlan}</SectionHeading>
          {plan ? (
            <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white" data-testid="chosen-plan">
              <ListRow variant="row" first icon="file" label={plan.title} subtitle={plan.sub} chip={{ text: C.removePlan, tone: "score" }} onPress={() => setPlan(null)} />
            </div>
          ) : (
            <div className="[display:grid] grid-cols-3 gap-2.5">
              <Tile icon={<Clock className="h-[22px] w-[22px]" />} label={C.theirRecentPlans} onClick={openRecent} />
              <Tile icon={<Library className="h-[22px] w-[22px]" />} label={C.library} onClick={() => { setLibraryLevel(0); setStage("library"); }} />
              <Tile icon={<Paperclip className="h-[22px] w-[22px]" />} label={C.ownPlan} onClick={() => setOwnOpen(true)} />
            </div>
          )}
        </>
      )}
      {/* The three pickers live here, outside the sheet, so a pick still arrives after the sheet has closed.
          Camera: accept must be exactly image/* (Capacitor opens the camera only then). Gallery: the same without capture.
          Files: the extensions. The type and size are checked on arrival either way. */}
      <input ref={planPhotoInput} data-testid="plan-photo-input" type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { void onPlanFile(e.target.files?.[0], "camera"); e.target.value = ""; }} />
      <input ref={planGalleryInput} data-testid="plan-gallery-input" type="file" accept="image/*" className="hidden"
        onChange={(e) => { void onPlanFile(e.target.files?.[0], "gallery"); e.target.value = ""; }} />
      <input ref={planFileInput} data-testid="plan-file-input" type="file" accept={PLAN_FILE_EXTENSIONS.join(",")} className="hidden"
        onChange={(e) => { void onPlanFile(e.target.files?.[0], "files"); e.target.value = ""; }} />
      {planError === "wrong_type" && <Alert chips={[C.kindPdf, C.kindWord, C.kindPhoto]}>{C.notPlanFile}</Alert>}
      {planError === "too_large" && <Alert chips={[C.upToMb(PLAN_MAX_MB)]}>{C.tooLarge}</Alert>}
      {planError === "wont_open" && <Alert>{C.fileWontOpen}</Alert>}

      <SectionHeading chip={[C.upToN(MAX_PHOTOS), C.noFaces]}>{C.photos}</SectionHeading>
      <PhotoGrid photos={photos} onChange={setPhotos} testId="photos-input" readOnPick />

      <Tray open={ownOpen} title={v7 ? P.ownPlan : C.ownPlan} onClose={() => setOwnOpen(false)}>
        <SheetRow icon={<Camera className="h-[22px] w-[22px]" />} label={C.camera} onClick={() => planPhotoInput.current?.click()} />
        {v7 ? (
          // bd-o15qnr.33 — "the camera vs attach one": the file picker takes a PDF, a Word file or a photo.
          <SheetRow icon={<Paperclip className="h-[22px] w-[22px]" />} label={P.attachFile} onClick={() => planFileInput.current?.click()} />
        ) : (
          <>
            <SheetRow icon={<ImageIcon className="h-[22px] w-[22px]" />} label={C.gallery} onClick={() => planGalleryInput.current?.click()} />
            <SheetRow icon={<FolderOpen className="h-[22px] w-[22px]" />} label={C.files} onClick={() => planFileInput.current?.click()} />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {[C.kindPdf, C.kindWord, C.kindPhoto, C.upToMb(PLAN_MAX_MB)].map((t) => <StatusChip key={t} text={t} tone="info" className="bg-white" />)}
        </div>
      </Tray>

      <Tray open={recentOpen} title={C.theirRecentPlans} onClose={() => setRecentOpen(false)}>
        {recent == null && <Loading />}
        {recent && recent.length === 0 && <div className="py-4 text-center text-[15px] text-[#6b7280]">{C.noRecentPlans}</div>}
        {recent && recent.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
            {recent.map((p, i) => (
              <ListRow key={isOwnPlan(p) ? p.ownId : p.assetId} variant="row" first={i === 0} icon="file" label={p.topic || C.lessonPlan} subtitle={planSub(p, C, kit) || undefined}
                onPress={() => pickRecent(p)} />
            ))}
          </div>
        )}
      </Tray>

      {/* bd-o15qnr.33 — NIETE lesson plan: the class it is for (plain words), its three newest plans, Pick a chapter. */}
      <Tray open={nieteOpen} title={P.nietePlan} onClose={() => setNieteOpen(false)}>
        {classLabel && <p dir="auto" data-testid="niete-class" className="px-1 text-[15px] font-semibold text-[#6b7280]">{classLabel}</p>}
        <h3 dir="auto" className="px-1 text-[16px] font-semibold text-[#1d2025]">{P.recentPlans}</h3>
        {recent == null && <Loading />}
        {recent && shownRecent.length === 0 && (
          <div className="flex min-h-[64px] items-center gap-3 rounded-2xl bg-white px-3.5 text-[15px] text-[#6b7280]">
            <Clock className="h-5 w-5 shrink-0" aria-hidden="true" /><span dir="auto">{planClass ? P.noneForClass : C.noRecentPlans}</span>
          </div>
        )}
        {shownRecent.length > 0 && (
          <div className={LIST_CARD} data-testid="niete-recent">
            {shownRecent.map((p, i) => (
              <ListRow key={isOwnPlan(p) ? p.ownId : p.assetId} variant="row" first={i === 0} icon="file" label={p.topic || C.lessonPlan} subtitle={planSub(p, C, kit) || undefined}
                onPress={() => pickRecent(p)} />
            ))}
          </div>
        )}
        <SheetRow icon={<Library className="h-[22px] w-[22px]" />} label={P.pickChapter} onClick={openPicker} />
      </Tray>
    </ObservePage>
  );
}

const CoachCheckSend = () => {
  const C = useCopy(OBSERVE);
  const { id = "" } = useParams();
  const routes = useObserveRoutes();
  const { data, failed, reload } = useLoad(() => routes.loadVisit(id), [id]);
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
  if (job?.state === "sending") return <Navigate to={routes.sending(id)} replace />;
  if (visit && (visit.status !== "upcoming" || !visit.teacherExtId)) return <Navigate to={routes.visit(id)} replace />;
  if (visit && audio) return <CheckSend visit={visit} audio={audio} />;

  return (
    <ObservePage banner={false} title={C.checkAndSend} backTo={routes.visit(id)} feature="observations"
      crumb={visit ? <>{visit.teacherName || C.dash}{visit.scheduledSlot && <> · <TimeStamp time={visit.scheduledSlot} size={13} /></>}</> : undefined}>
      {failed && <Failed onRetry={reload} />}
      {(!data || !looked) && !failed && <Loading />}
      {visit && looked && !audio && (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-xl font-light">{C.noRecording}</h2>
          <div className="[display:grid] grid-cols-2 gap-2.5">
            <Link to={routes.record(id)} className="flex h-14 items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white">{C.startRecording}</Link>
            <Link to={routes.attach(id)} className="flex h-14 items-center justify-center rounded-2xl border border-[#e5e7eb] bg-white text-base font-semibold text-[#1d2025]">{C.uploadRecording}</Link>
          </div>
        </Card>
      )}
    </ObservePage>
  );
};

export default CoachCheckSend;
