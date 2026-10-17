import { useMemo, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { ChevronDown, FileText, Layers, Library, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy } from "../../teacher/i18n";
import { StatusChip } from "../../teacher/ui";
import { CARD, FOCUS } from "../../teacher/ui/styles";
import { V2Row } from "../../teacher/training/parts";
import { LoadState, ProviderMark } from "../../teacher/training/TrainingFrame";
import { AudioPlayer } from "../../newui/AudioPlayer";
import { courseName, providerInitials, providerLabel, sortVendors, statusOf, type ReadingItem, type Vendor } from "../../newui/training/trainingApi";
import { COACH_LIBRARY } from "./copy";
import { coachTrainingPaths as paths } from "./appReady";
import {
  useCourseReadings, useLibrary, useLibraryModule, usePreview,
  type LibraryVendor, type PreviewQuestion,
} from "./libraryApi";

/**
 * bd-s42dye.2 — the coach Training Library: every provider, level, course and part, all open; no locks, progress,
 * grades, certificates or "Mark done". Questions are a read-only preview. Reads only the library endpoints.
 */

/** A big outline link to a preview (never a Start: nothing starts). */
function PreviewLink({ to, testId, children }: { to: string; testId: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={cn("flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] font-semibold text-[#1d2025]", FOCUS)}
    >
      <ListChecks className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
      {children}
    </Link>
  );
}

const sortedVendors = (vendors: LibraryVendor[]) => sortVendors(vendors as unknown as Vendor[]) as unknown as LibraryVendor[];

/* ── providers ────────────────────────────────────────────────────────────── */

export function LibraryHome() {
  const C = useCopy(COACH_LIBRARY);
  const lib = useLibrary();
  const loading = lib.loading;
  const failed = !loading && !!lib.error;
  const vendors = lib.data ? sortedVendors(lib.data.vendors) : [];
  return (
    <CoachGate>
      <TeacherPage testId="coach-library" title={C.title}>
        <LoadState loading={loading} failed={failed} onRetry={lib.reload} />
        {!loading && !failed && vendors.length === 0 ? (
          <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.nothingYet}</p>
        ) : null}
        <div className="flex flex-col gap-2.5" data-testid="library-providers">
          {vendors.map((v) => {
            const courses = v.levels.reduce((n, l) => n + l.courses.length, 0);
            return (
              <Link key={v.vendor_key} to={paths.provider(v.vendor_key)} data-testid={`provider-${v.vendor_key}`} className={cn(CARD, "flex min-h-[76px] items-center gap-3.5 py-2.5 pe-3.5 ps-3 text-start text-[#1d2025]", FOCUS)}>
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6]">
                  <ProviderMark logo={null} initials={providerInitials(v.vendor_key, v.vendor_name)} size={40} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span dir="auto" className="line-clamp-2 text-[16px] font-semibold leading-snug">{providerLabel(v.vendor_key, [v])}</span>
                  <span className="text-[13px] text-[#6b7280]">{C.courses(courses)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </TeacherPage>
    </CoachGate>
  );
}

/* ── one provider: levels, courses, parts ─────────────────────────────────── */

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
      <TeacherPage testId="coach-library-provider" crumb={C.title} title={vendor ? providerLabel(vendorKey, [vendor]) : ""} backTo={paths.home}>
        <LoadState loading={loading} failed={failed} onRetry={lib.reload} />
        {missing ? <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.nothingYet}</p> : null}
        {levels.map((l, i) => (
          <details key={String(l.id)} open={levels.length === 1 || i === 0} data-testid={`level-${String(l.id)}`} className={cn(CARD, "group")}>
            <summary className={cn("flex min-h-[64px] cursor-pointer list-none items-center gap-3 px-3.5 py-2", FOCUS)}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]"><Layers className="h-5 w-5" aria-hidden="true" /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span dir="auto" className="text-[17px] font-semibold leading-snug">{l.name}</span>
                <span className="text-[13px] text-[#6b7280]">{C.courses(l.courses.length)}</span>
              </span>
              <ChevronDown className="h-5 w-5 shrink-0 text-[#9ca3af] transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="flex flex-col gap-3 px-3 pb-3">
              {l.has_level_exam ? <PreviewLink to={paths.previewLevel(l.id)} testId={`preview-level-${String(l.id)}`}>{C.previewLevelExam}</PreviewLink> : null}
              {[...l.courses].sort((a, b) => a.order_index - b.order_index).map((c) => (
                <section key={String(c.id)} data-testid={`course-${String(c.id)}`} className="flex flex-col gap-2">
                  <h2 dir="auto" className="mx-1 mt-1 text-[18px] font-semibold leading-snug">{courseName(c.title)}</h2>
                  {[...c.modules].sort((a, b) => a.order_index - b.order_index).map((m) => (
                    <V2Row
                      key={String(m.id)}
                      icon={m.has_video || m.has_audio ? Library : FileText}
                      title={m.title}
                      sub={m.duration_seconds > 0 ? C.minutes(Math.max(1, Math.round(m.duration_seconds / 60))) : undefined}
                      to={paths.module(m.id)}
                      testId={`module-${String(m.id)}`}
                    />
                  ))}
                  {c.has_module_exam ? <PreviewLink to={paths.previewCourseExam(c.id)} testId={`preview-course-${String(c.id)}`}>{C.previewCourseExam}</PreviewLink> : null}
                </section>
              ))}
            </div>
          </details>
        ))}
      </TeacherPage>
    </CoachGate>
  );
}

/* ── a part ───────────────────────────────────────────────────────────────── */

function Readings({ courseId }: { courseId: string | number }) {
  const C = useCopy(COACH_LIBRARY);
  const r = useCourseReadings(courseId);
  const item = (x: ReadingItem, off: boolean) => (
    <li key={`${x.title}-${x.author}`} className={cn(CARD, "flex flex-col gap-1.5 p-3.5", off && "opacity-[.6]")}>
      <p dir="auto" className="text-[16px] font-semibold leading-snug">{x.title}</p>
      {x.author ? <p dir="auto" className="text-[13px] text-[#6b7280]">{C.by(x.author)}</p> : null}
      {x.description ? <p dir="auto" className="text-[14px] text-[#374151]">{x.description}</p> : null}
      {off ? <span className="flex"><StatusChip text={C.notAvailable} tone="info" /></span>
        : x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex min-h-[56px] items-center text-[15px] font-semibold text-[#33374a] underline", FOCUS)}>{C.open}</a> : null}
    </li>
  );
  const all = [...(r.data?.available || []), ...(r.data?.unavailable || [])];
  if (!r.loading && all.length === 0) return null;
  return (
    <section data-testid="library-readings" className="flex flex-col gap-2">
      <h2 className="mx-1 mt-2 text-[20px] font-light">{C.requiredReading}</h2>
      <LoadState loading={r.loading} failed={!r.loading && !!r.error} onRetry={r.reload} />
      <ul className="flex flex-col gap-2.5">
        {(r.data?.available || []).map((x) => item(x, false))}
        {(r.data?.unavailable || []).map((x) => item(x, true))}
      </ul>
    </section>
  );
}

export function LibraryModulePage() {
  const C = useCopy(COACH_LIBRARY);
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
  return (
    <CoachGate>
      <TeacherPage testId="coach-library-module" crumb={course ? courseName(course.title) : C.title} title={d?.title ?? ""} backTo={back}>
        <LoadState loading={detail.loading} failed={!detail.loading && !!detail.error} onRetry={detail.reload} />
        {d ? (
          <>
            {d.video_url ? <video controls preload="metadata" src={d.video_url} aria-label={C.video} className="aspect-video w-full rounded-2xl bg-[#1d2025]" data-testid="library-video" /> : null}
            {d.audio_url ? <AudioPlayer src={d.audio_url} label={C.audio} testId="library-audio" /> : null}
            {d.pdf_url ? (
              <a href={d.pdf_url} target="_blank" rel="noopener noreferrer" data-testid="library-handout" className={cn(CARD, "flex min-h-[76px] items-center gap-3.5 px-3 py-2.5 text-[16px] font-semibold text-[#1d2025]", FOCUS)}>
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]"><FileText className="h-6 w-6" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">{C.handout}</span>
                <StatusChip text={C.pdf} tone="info" />
              </a>
            ) : null}
            {d.body_html && d.body_html.trim() ? (
              <div dir="auto" data-testid="library-body" className={cn(CARD, "prose prose-sm max-w-none p-4 text-[#374151]")} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(d.body_html) }} />
            ) : null}
            {course?.has_readings ? <Readings courseId={d.course_id} /> : null}
            {d.has_questions ? <PreviewLink to={paths.previewModule(d.id)} testId="preview-module">{C.previewQuestions}</PreviewLink> : null}
          </>
        ) : null}
      </TeacherPage>
    </CoachGate>
  );
}

/* ── the question preview ─────────────────────────────────────────────────── */

const LETTER = "ABCDEFGH";

function QuestionCard({ q, n }: { q: PreviewQuestion; n: number }) {
  const C = useCopy(COACH_LIBRARY);
  const written = q.type === "crq" || q.type === "open";
  const type = written ? C.typeWritten : q.type === "msq" ? C.typeMany : C.typeOne;
  return (
    <li data-testid={`question-${n}`} className={cn(CARD, "flex flex-col gap-2.5 p-3.5")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-[#6b7280]">{C.question(n)}</span>
        <StatusChip text={type} tone="score" />
      </div>
      <p dir="auto" className="whitespace-pre-line text-[16px] font-semibold leading-snug">{q.text}</p>
      {q.image_url ? <img src={q.image_url} alt="" className="max-h-48 rounded-lg object-contain" /> : null}
      {!written && q.options.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {q.options.map((o, i) => (
            <li key={i} className="flex min-h-[48px] items-center gap-3 rounded-xl bg-[#f9fafb] px-2.5 py-2 text-[15px]">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f3f4f6] text-[14px] font-extrabold text-[#33374a]">{LETTER[i] ?? i + 1}</span>
              {q.option_image_urls?.[i] ? <img src={q.option_image_urls[i] as string} alt="" className="max-h-16 rounded-md object-contain" /> : null}
              <span dir="auto" className="min-w-0 flex-1">{o}</span>
            </li>
          ))}
        </ol>
      ) : null}
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
      <TeacherPage testId="coach-library-preview" crumb={C.title} title={pv.data?.title ?? ""} backTo={back}>
        <p role="note" data-testid="preview-banner" className="rounded-2xl bg-[#fef3c7] px-4 py-3 text-[14px] font-semibold text-[#b45309]">{C.previewBanner}</p>
        <LoadState loading={loading} failed={failed} onRetry={pv.reload} />
        {!loading && !failed && qs.length === 0 ? <p className="rounded-2xl border border-[#e5e7eb] bg-white p-5 text-center text-[15px] text-[#6b7280]">{C.noQuestions}</p> : null}
        {qs.length > 0 ? <span className="flex px-1"><StatusChip text={C.questions(qs.length)} tone="info" /></span> : null}
        <ol className="flex flex-col gap-2.5" data-testid="preview-questions">
          {qs.map((q, i) => <QuestionCard key={String(q.id)} q={q} n={i + 1} />)}
        </ol>
      </TeacherPage>
    </CoachGate>
  );
}
