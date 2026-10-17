import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { ChevronDown, ClipboardCheck, Eye, FileText, GraduationCap, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/useAuth";
import CoachGate from "../CoachGate";
import { SectionLabel } from "../ui";
import TeacherPage from "../../teacher/TeacherPage";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang } from "../../teacher/i18n";
import { fullName, todayLabel } from "../../teacher/format";
import { HomeGreeting, LeaveNote, ListRow, StatusChip } from "../../teacher/ui";
import { CARD, FOCUS } from "../../teacher/ui/styles";
import { TRAINING, TRAINING_INNER } from "../../teacher/training/copy";
import { providerLogo } from "../../teacher/training/model";
import { ChoiceList, QuestionPrompt, readingIcon, V2Row } from "../../teacher/training/parts";
import { EmptyNote, LoadState, ProviderTile, TrainingPageV2 } from "../../teacher/training/TrainingFrame";
import { AudioPlayer } from "../../newui/AudioPlayer";
import { courseName, providerInitials, providerLabel, sortVendors, statusOf, type Vendor } from "../../newui/training/trainingApi";
import { COACH_LIBRARY } from "./copy";
import { coachTrainingPaths as paths } from "./appReady";
import {
  useCourseReadings, useLibrary, useLibraryModule, usePreview,
  type LibraryLevel, type LibraryVendor, type PreviewQuestion,
} from "./libraryApi";

/**
 * bd-s42dye.2 / bd-s42dye.6 — the coach Training Library, drawn with the teacher app v2's kit so a coach's /training
 * looks like a teacher's: every provider, level, course and part, all open; no locks, progress, grades, certificates or
 * "Mark done". Questions are a read-only preview. Reads only the library endpoints (libraryApi).
 *
 *   landing   the coach Home's NIETE band (the kit's HomeGreeting), then the teacher Training hub's provider tiles
 *   provider  the teacher's page frame (the Training tile, crumb, title); levels, then each course's Part rows
 *   a part    the teacher's part page: chips (Part n/m, length), the player, Handout and question-preview rows, the text
 *   preview   the quick check's question and big answer rows, read only
 */

const sortedVendors = (vendors: LibraryVendor[]) => sortVendors(vendors as unknown as Vendor[]) as unknown as LibraryVendor[];

/* ── landing: the Home pattern, then the hub's provider tiles ─────────────── */

export function LibraryHome() {
  const C = useCopy(COACH_LIBRARY);
  const F = useCopy(TEACHER_FRAME);
  const lang = useLang();
  const { user } = useAuth();
  const lib = useLibrary();
  const loading = lib.loading;
  const failed = !loading && !!lib.error;
  const vendors = lib.data ? sortedVendors(lib.data.vendors) : [];
  return (
    <CoachGate>
      <TeacherPage
        testId="coach-library"
        hero={(
          // The coach Home's band: her name and the date, no school row, rounded foot (nothing climbs into it).
          <HomeGreeting
            title={F.home.greeting(fullName(user))}
            date={todayLabel(new Date(), lang)}
            school={null}
            brand={F.brand}
            logoAlt={F.logoAlt}
            className="rounded-b-[28px] pb-6"
          />
        )}
      >
        <SectionLabel count={loading || failed ? undefined : vendors.length}>{C.title}</SectionLabel>
        <LoadState loading={loading} failed={failed} onRetry={lib.reload} />
        {!loading && !failed && vendors.length === 0 ? <EmptyNote>{C.nothingYet}</EmptyNote> : null}
        <div className="[display:grid] grid-cols-2 gap-3" data-testid="library-providers">
          {vendors.map((v, i) => {
            const courses = v.levels.reduce((n, l) => n + l.courses.length, 0);
            return (
              <ProviderTile
                key={v.vendor_key}
                to={paths.provider(v.vendor_key)}
                testId={`provider-${v.vendor_key}`}
                label={providerLabel(v.vendor_key, [v])}
                logo={providerLogo(v.vendor_key)}
                initials={providerInitials(v.vendor_key, v.vendor_name)}
                ring={null}
                // an odd one out spans both columns, as Home's last tile does
                className={vendors.length % 2 === 1 && i === vendors.length - 1 ? "col-span-2" : undefined}
              >
                <span className="text-[13px] text-[#6b7280]">{C.courses(courses)}</span>
              </ProviderTile>
            );
          })}
        </div>
      </TeacherPage>
    </CoachGate>
  );
}

/* ── one provider: levels, courses, parts ─────────────────────────────────── */

function LevelBody({ level }: { level: LibraryLevel }) {
  const C = useCopy(COACH_LIBRARY);
  const T = useCopy(TRAINING_INNER);
  const W = useCopy(TRAINING);
  return (
    <>
      {level.has_level_exam ? <V2Row icon={Trophy} title={C.previewLevelExam} to={paths.previewLevel(level.id)} testId={`preview-level-${String(level.id)}`} /> : null}
      {[...level.courses].sort((a, b) => a.order_index - b.order_index).map((c) => (
        <section key={String(c.id)} data-testid={`course-${String(c.id)}`} className="flex flex-col gap-2.5">
          <h3 dir="auto" className="mx-1 mt-2 flex items-center gap-2 text-[17px] font-semibold leading-snug">
            <span className="min-w-0">{courseName(c.title)}</span>
            <StatusChip text={C.parts(c.modules.length)} tone="info" />
          </h3>
          {[...c.modules].sort((a, b) => a.order_index - b.order_index).map((m, i) => (
            <ListRow
              key={String(m.id)}
              prefix={W.partPrefix}
              number={i + 1}
              label={m.title}
              subtitle={m.duration_seconds > 0 ? T.minutes(m.duration_seconds) : undefined}
              to={paths.module(m.id)}
              testId={`module-${String(m.id)}`}
            />
          ))}
          {c.has_module_exam ? <V2Row icon={GraduationCap} title={C.previewCourseExam} to={paths.previewCourseExam(c.id)} testId={`preview-course-${String(c.id)}`} /> : null}
        </section>
      ))}
    </>
  );
}

export function LibraryProvider() {
  const C = useCopy(COACH_LIBRARY);
  const { vendorKey = "" } = useParams();
  const lib = useLibrary();
  const loading = lib.loading;
  const failed = !loading && !!lib.error;
  const vendor = lib.data?.vendors.find((v) => v.vendor_key === vendorKey) ?? null;
  const levels = vendor ? [...vendor.levels].sort((a, b) => a.order_index - b.order_index) : [];
  const missing = !loading && !failed && !vendor;
  return (
    <CoachGate>
      <TrainingPageV2 testId="coach-library-provider" crumb={C.title} title={vendor ? providerLabel(vendorKey, [vendor]) : ""} backTo={paths.home}>
        <LoadState loading={loading} failed={failed} onRetry={lib.reload} />
        {missing ? <EmptyNote>{C.nothingYet}</EmptyNote> : null}
        {levels.map((l, i) => {
          const head = (
            <>
              <h2 dir="auto" className="min-w-0 flex-1 text-[20px] font-light leading-snug">{l.name}</h2>
              <StatusChip text={C.courses(l.courses.length)} tone="info" />
            </>
          );
          // One level (most providers): its name is the heading and the courses follow. Several: each folds, the first open.
          return levels.length === 1 ? (
            <section key={String(l.id)} data-testid={`level-${String(l.id)}`} className="flex flex-col gap-2.5">
              <div className="mx-1 mt-1 flex items-center gap-2">{head}</div>
              <LevelBody level={l} />
            </section>
          ) : (
            <details key={String(l.id)} open={i === 0} data-testid={`level-${String(l.id)}`} className="group">
              <summary className={cn("flex min-h-[56px] cursor-pointer list-none items-center gap-2 rounded-xl px-1", FOCUS)}>
                {head}
                <ChevronDown className="h-5 w-5 shrink-0 text-[#9ca3af] transition-transform motion-reduce:transition-none group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="flex flex-col gap-2.5 pb-3 pt-1">
                <LevelBody level={l} />
              </div>
            </details>
          );
        })}
      </TrainingPageV2>
    </CoachGate>
  );
}

/* ── a part ───────────────────────────────────────────────────────────────── */

function Readings({ courseId }: { courseId: string | number }) {
  const C = useCopy(COACH_LIBRARY);
  const r = useCourseReadings(courseId);
  const on = r.data?.available || [];
  const off = r.data?.unavailable || [];
  if (!r.loading && on.length + off.length === 0) return null;
  return (
    <section data-testid="library-readings" className="flex flex-col gap-2.5">
      <h2 className="mx-1 mt-2 text-[20px] font-light">{C.requiredReading}</h2>
      <LoadState loading={r.loading} failed={!r.loading && !!r.error} onRetry={r.reload} />
      {on.map((x) => (
        <V2Row key={`${x.title}-${x.author}`} icon={readingIcon(x)} title={x.title} sub={[x.section, x.author].filter(Boolean).join(" · ") || undefined} href={x.url ?? undefined} end="external" />
      ))}
      {off.map((x) => (
        <V2Row key={`off-${x.title}-${x.author}`} icon={readingIcon(x)} title={x.title} sub={x.author || undefined} chip={{ text: C.notAvailable, tone: "info" }} end="none" />
      ))}
    </section>
  );
}

export function LibraryModulePage() {
  const C = useCopy(COACH_LIBRARY);
  const T = useCopy(TRAINING_INNER);
  const W = useCopy(TRAINING);
  const { id = "" } = useParams();
  const detail = useLibraryModule(id);
  const lib = useLibrary();
  const d = detail.data;
  const course = useMemo(() => {
    if (!d || !lib.data) return null;
    for (const v of lib.data.vendors) for (const l of v.levels) for (const c of l.courses) if (String(c.id) === String(d.course_id)) return c;
    return null;
  }, [d, lib.data]);
  const back = d?.vendor_key ? paths.provider(d.vendor_key) : paths.home;
  const parts = course ? [...course.modules].sort((a, b) => a.order_index - b.order_index) : [];
  const at = d ? parts.findIndex((m) => String(m.id) === String(d.id)) : -1;
  const chips = d ? (
    <>
      {at >= 0 ? <StatusChip text={T.part(at + 1, parts.length)} tone="info" /> : null}
      {d.duration_seconds > 0 ? <StatusChip text={T.minutes(d.duration_seconds)} tone="info" /> : null}
    </>
  ) : undefined;
  return (
    <CoachGate>
      <TrainingPageV2 testId="coach-library-module" crumb={C.crumb(course ? courseName(course.title) : null)} title={d?.title ?? ""} backTo={back} context={chips}>
        <LoadState loading={detail.loading} failed={!detail.loading && !!detail.error} onRetry={detail.reload} />
        {d ? (
          <>
            {d.video_url ? <video controls preload="metadata" src={d.video_url} aria-label={W.video} className="aspect-video w-full rounded-2xl bg-[#1d2025]" data-testid="library-video" /> : null}
            {d.audio_url ? <AudioPlayer src={d.audio_url} label={W.audio} testId="library-audio" /> : null}
            {d.pdf_url ? <V2Row icon={FileText} title={T.handout} chip={{ text: T.pdf, tone: "info" }} href={d.pdf_url} end="external" testId="library-handout" /> : null}
            {d.has_questions ? <V2Row icon={ClipboardCheck} title={C.previewQuestions} to={paths.previewModule(d.id)} testId="preview-module" /> : null}
            {d.body_html && d.body_html.trim() ? (
              <div dir="auto" data-testid="library-body" className={cn(CARD, "prose prose-sm max-w-none p-4 text-[#374151]")} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(d.body_html) }} />
            ) : null}
            {course?.has_readings ? <Readings courseId={d.course_id} /> : null}
          </>
        ) : null}
      </TrainingPageV2>
    </CoachGate>
  );
}

/* ── the question preview ─────────────────────────────────────────────────── */

function QuestionBlock({ q, n }: { q: PreviewQuestion; n: number }) {
  const C = useCopy(COACH_LIBRARY);
  const T = useCopy(TRAINING_INNER);
  const written = q.type === "crq" || q.type === "open";
  const type = written ? C.typeWritten : q.type === "msq" ? C.typeMany : C.typeOne;
  return (
    <li data-testid={`question-${n}`} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[13px] font-bold text-[#6b7280]">{C.question(n)}</span>
        <StatusChip text={type} tone="score" />
      </div>
      <QuestionPrompt>{q.text}</QuestionPrompt>
      {q.image_url ? <img src={q.image_url} alt="" className="max-h-48 rounded-lg object-contain" /> : null}
      {!written && q.options.length > 0 ? <ChoiceList label={T.answers} options={q.options} images={q.option_image_urls} /> : null}
    </li>
  );
}

export function LibraryPreview() {
  const C = useCopy(COACH_LIBRARY);
  const [sp] = useSearchParams();
  const params = useMemo(() => {
    const m = sp.get("module_id"); const l = sp.get("level_id"); const c = sp.get("course_id");
    if (m) return { module_id: m };
    if (l) return { level_id: l };
    if (c) return { course_id: c, kind: sp.get("kind") || "module_exam" };
    return null;
  }, [sp]);
  const pv = usePreview(params);
  const loading = pv.loading;
  const noExam = statusOf(pv.error) === 404;
  const failed = !loading && !!pv.error && !noExam;
  const qs = pv.data?.questions ?? [];
  const back = sp.get("module_id") ? paths.module(sp.get("module_id") as string) : paths.home;
  return (
    <CoachGate>
      <TrainingPageV2
        testId="coach-library-preview"
        crumb={C.title}
        title={pv.data?.title ?? ""}
        backTo={back}
        context={qs.length > 0 ? <StatusChip text={C.questions(qs.length)} tone="info" /> : undefined}
      >
        <LeaveNote icon={Eye} text={C.previewBanner} testId="preview-banner" />
        <LoadState loading={loading} failed={failed} onRetry={pv.reload} />
        {!loading && !failed && qs.length === 0 ? <EmptyNote>{C.noQuestions}</EmptyNote> : null}
        <ol className="flex flex-col gap-7" data-testid="preview-questions">
          {qs.map((q, i) => <QuestionBlock key={String(q.id)} q={q} n={i + 1} />)}
        </ol>
      </TrainingPageV2>
    </CoachGate>
  );
}
