import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { TEACHER_FRAME } from "../../teacher/copy";
import { useCopy, useLang, type Lang } from "../../teacher/i18n";
import { ListRow } from "../../teacher/ui";
import { FOCUS } from "../../teacher/ui/styles";
import { useLanguageSwitch } from "../../teacher/useLanguageSwitch";
import { useBack } from "../../lib/useBack";
import { takeBoot } from "@/lib/bootReads";
import { COACH_MODULES, modulePath } from "../coachTraining/modules";
import { COACH_TRAINING } from "../coachTraining/copy";
import { COACH_REPORT, type CoachReportCopy } from "./copy";
import { getCoachReport, markOpened, problemOf, type Both, type CoachReport, type ReportProblem } from "./api";

/**
 * Coach reports in the app — the coach's debrief report as a page (/portal/coach/report/:id), in the NIETE app's own
 * look: the kit's page frame (back, the Reports tile, title, the app's language pill), the indigo report card the
 * teacher's report uses (ReportBody), then white section cards on the grey page. The ICT HITL owner's CONTENT and ORDER:
 *
 *   1 the header: her debrief, the count of the eight behaviours (drawn stars), teacher · class · lesson · date
 *   2 Respect held, on its own line
 *   3 the eight behaviours as boxes (done: green edge and tick; missed: dashed edge). A tap takes her to that
 *     behaviour's entry below and marks it: nothing is said twice (her 5 Nov review)
 *   4 What you did well — every done behaviour with what she did
 *   5 What was missed — what happened in THIS debrief, why it matters, its Coach Training module
 *   6 Next focus — just one thing: the move, why this one, the ready "Try:" line (a marked placeholder until that
 *     behaviour's line is supplied), then its module
 *   7 her closing line. No reflection question, no praise banner (her 5 Nov review).
 *
 * Colours keep the app's meanings: green = done, amber = missed (never red), violet = the one action (InsightRow's
 * tones), indigo = the frame. Steady open: the frame at once, grey outlines where the report goes, then the whole report
 * in one commit (index.html starts the read at boot on this page). Fixed words come in both languages, so the language
 * pill switches the page without a second read. Opening it stamps "opened" once (no WhatsApp link follows).
 */
export default function CoachReportPage() {
  const C = useCopy(COACH_REPORT) as CoachReportCopy;
  const lang = useLang();
  const { id = "" } = useParams();
  const back = useBack("/portal/coach");
  const [report, setReport] = useState<CoachReport | null>(null);
  const [problem, setProblem] = useState<ReportProblem | null>(null);
  const [tick, setTick] = useState(0);
  const stamped = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setProblem(null);
    const boot = tick === 0 ? takeBoot<{ success?: boolean; report?: CoachReport }>("coachReport") : null;
    const read = boot
      ? boot.then((v) => (v && v.report && v.report.id === id ? v.report : getCoachReport(id)))
      : getCoachReport(id);
    read
      .then((r) => { if (live) setReport(r); })
      .catch((err) => { if (live) setProblem(problemOf(err)); });
    return () => { live = false; };
  }, [id, tick]);

  useEffect(() => {
    if (report && stamped.current !== report.id) {
      stamped.current = report.id;
      void markOpened(report.id);
    }
  }, [report]);

  return (
    <CoachGate>
      <TeacherPage feature="reports" title={C.title} crumb={C.crumb} onBack={back} action={<LanguagePill />} testId="coach-report">
        {report ? <ReportBodyView report={report} C={C} lang={lang} />
          : problem ? <Problem problem={problem} C={C} onRetry={() => setTick((n) => n + 1)} />
            : <ReportOutline />}
      </TeacherPage>
    </CoachGate>
  );
}

/** The app's language switch, on a white header: the pill names the language she is NOT on, saved through the one writer. */
export function LanguagePill() {
  const F = useCopy(TEACHER_FRAME);
  const sw = useLanguageSwitch();
  const word = F.more.switchTo[sw.target];
  return (
    <button type="button" data-testid="report-lang" aria-label={`${F.more.language}: ${word}`} disabled={sw.status === "saving"}
      onClick={() => { void sw.toggle(); }}
      className={cn("flex min-h-[56px] min-w-[44px] shrink-0 items-center justify-center disabled:opacity-70", FOCUS)}>
      <span className="flex min-h-[32px] items-center gap-1.5 rounded-full border border-[#d1d5db] bg-white px-3 text-[14px] font-semibold text-[#33374a]">
        <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{word}</span>
      </span>
    </button>
  );
}

/* ── the parts ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export const SECTION = "rounded-[18px] border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
export const LABEL = "m-0 mb-2.5 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-[.08em] text-[#6b7280] rtl:normal-case rtl:tracking-normal rtl:text-[13px]";
export const PILL = "inline-flex h-6 items-center whitespace-nowrap rounded-full px-[9px] text-[12px] font-bold normal-case tracking-normal";
export const pick = (b: Both | null | undefined, lang: Lang) => (b ? (lang === "ur" ? b.ur || b.en : b.en || b.ur) : null) || "";

function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className={on ? "text-white" : "text-white/25"}>
      <path d="M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.1l-5.62 2.96 1.07-6.27L2.9 9.4l6.3-.9z" fill="currentColor" />
    </svg>
  );
}
export function Tick({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function Spark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" />
    </svg>
  );
}

/** One entry: a round 36px tone disc, a bold name and its lines. The tones are InsightRow's: green done, amber missed. */
function Entry({ id, tone, name, marked, children }: { id: string; tone: "good" | "grow"; name: string; marked: boolean; children?: ReactNode }) {
  return (
    <div id={`report-entry-${id}`} data-entry={id} data-marked={marked ? "" : undefined}
      className={cn("-mx-2.5 flex items-start gap-3 rounded-[14px] p-2.5 transition-[background-color,box-shadow] duration-300 motion-reduce:transition-none",
        marked && "bg-[#f4f5f8] shadow-[inset_3px_0_0_#33374a] rtl:shadow-[inset_-3px_0_0_#33374a]")}>
      <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[17px] font-extrabold",
        tone === "good" ? "bg-[#eaf6ef] text-[#2f7a52]" : "bg-[#fef3c7] text-[#b45309]")}>
        {tone === "good" ? <Tick size={18} /> : "!"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="text-[16px] font-semibold leading-[1.3]">{name}</b>
        {children}
      </span>
    </div>
  );
}

/** Its Coach Training module, as the Coach Training page lists it (the same row, the same words). */
export function ModuleRow({ n, lang }: { n: number | null; lang: Lang }) {
  const T = useCopy(COACH_TRAINING);
  const m = n ? COACH_MODULES.find((x) => x.n === n) : null;
  if (!m) return null;
  return <ListRow testId="report-module" prefix={T.coachModule} number={m.n} label={lang === "ur" ? m.title.ur : m.title.en} to={modulePath(m)} className="mt-1.5" />;
}

const dayOf = (iso: string | null, lang: Lang): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "ur" ? "ur-PK" : "en-GB", { day: "numeric", month: "short", timeZone: "Asia/Karachi" }).format(d);
};
const isToday = (iso: string | null): boolean => {
  if (!iso) return false;
  const k = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
  return k(new Date(iso)) === k(new Date());
};

export function ReportBodyView({ report: r, C, lang }: { report: CoachReport; C: CoachReportCopy; lang: Lang }) {
  const [marked, setMarked] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const goTo = (key: string) => {
    const el = typeof document !== "undefined" ? document.getElementById(`report-entry-${key}`) : null;
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    setMarked(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMarked(null), 2000);
  };

  const h = r.header;
  const cls = [h.grade ? (lang === "ur" ? `جماعت ${h.grade}` : `Grade ${h.grade}`) : null, h.subject].filter(Boolean).join(" ");
  const meta = [cls || null, h.topic, dayOf(h.at, lang)].filter(Boolean);

  if (r.harmful) {
    return (
      <div className="flex flex-col gap-3" data-testid="report-concern">
        <Hero r={r} C={C} lang={lang} meta={meta} stars={false} />
        <section aria-label={C.concern} className={SECTION}>
          <h3 className={LABEL}>{C.concern}</h3>
          <div className="flex flex-col gap-1.5 text-[15px] leading-[1.45] text-[#374151]">
            {r.concern?.what_happened ? <p dir="auto" className="m-0">{r.concern.what_happened}</p> : null}
            {r.concern?.why_it_matters ? <p dir="auto" className="m-0">{r.concern.why_it_matters}</p> : null}
            {r.concern?.instead ? <p dir="auto" className="m-0"><b className="font-semibold text-[#1d2025]">{C.instead}</b> <bdi>{r.concern.instead}</bdi></p> : null}
          </div>
        </section>
        <Foot C={C} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="report-body">
      <Hero r={r} C={C} lang={lang} meta={meta} stars />

      {r.respectHeld ? (
        <p data-testid="report-respect" className="m-0 flex items-center gap-2 rounded-[14px] bg-[#eaf6ef] px-3.5 py-2.5 text-[14px] font-semibold text-[#2f7a52]">
          <Tick size={16} /><span>{C.respect}</span>
        </p>
      ) : null}

      <section aria-label={C.marks(r.total)} className={SECTION} data-testid="report-marks">
        <h3 className={LABEL}>{C.marks(r.total)} <span className={cn(PILL, "bg-[#e8e9f0] text-[#33374a]")}>{C.ofTotal(r.done, r.total)}</span></h3>
        <div className="[display:grid] grid-cols-2 gap-2">
          {r.marks.map((m) => (
            <button key={m.key} type="button" data-mark={m.done ? "done" : "missed"} onClick={() => goTo(m.key)}
              className={cn("flex min-h-[56px] items-center gap-2 rounded-[14px] bg-white px-2.5 py-1.5 text-start text-[14px] font-semibold leading-[1.25] text-[#1d2025]", FOCUS,
                m.done ? "border-[1.5px] border-[#2f7a52]" : "border-[1.5px] border-dashed border-[#c4c9d2]")}>
              <span aria-hidden="true" className={cn("flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full",
                m.done ? "bg-[#2f7a52] text-white" : "border-[1.5px] border-dashed border-[#9ca3af]")}>
                {m.done ? <Tick size={12} /> : null}
              </span>
              <span className="min-w-0 flex-1">{pick(m.name, lang)}</span>
            </button>
          ))}
        </div>
        <p className="m-0 mt-2.5 text-[13px] text-[#6b7280]">{C.tapHint}</p>
      </section>

      {r.did.length > 0 ? (
        <section aria-label={C.did} className={SECTION} data-testid="report-did">
          <h3 className={LABEL}>{C.did}</h3>
          <div className="flex flex-col gap-1">
            {r.did.map((d) => (
              <Entry key={d.key} id={d.key} tone="good" name={pick(d.name, lang)} marked={marked === d.key}>
                {d.line ? <p dir="auto" className="m-0 text-[15px] leading-[1.45] text-[#374151]">{d.line}</p> : null}
              </Entry>
            ))}
          </div>
        </section>
      ) : null}

      {r.missed.length > 0 ? (
        <section aria-label={C.missed} className={SECTION} data-testid="report-missed">
          <h3 className={LABEL}>{C.missed}</h3>
          <div className="flex flex-col gap-1">
            {r.missed.map((m) => (
              <Entry key={m.key} id={m.key} tone="grow" name={pick(m.name, lang)} marked={marked === m.key}>
                {/* <bdi>: the judge's words keep their own direction after an Urdu label (bd-enec2e.5: "'.things I want…") */}
                {m.line ? <p dir="auto" className="m-0 text-[15px] leading-[1.45] text-[#374151]"><b className="font-semibold text-[#1d2025]">{C.what}</b> <bdi>{m.line}</bdi></p> : null}
                {pick(m.why, lang) ? <p className="m-0 text-[15px] leading-[1.45] text-[#374151]"><b className="font-semibold text-[#1d2025]">{C.why}</b> {pick(m.why, lang)}</p> : null}
                <ModuleRow n={m.module} lang={lang} />
              </Entry>
            ))}
          </div>
        </section>
      ) : null}

      {r.focus ? (
        <section aria-label={C.focus} data-testid="report-focus" className={cn(SECTION, "border-2 border-[#6e52e0]")}>
          <h3 className={LABEL}>
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eeeafd] text-[#6e52e0]"><Spark /></span>
            {C.focus}
          </h3>
          {r.focus.move ? <p dir="auto" className="m-0 text-[18px] font-semibold leading-[1.35]">{r.focus.move}</p> : null}
          {r.focus.why ? (
            <p dir="auto" className="m-0 mt-2.5 border-t border-[#f0f1f3] pt-2.5 text-[15px] leading-[1.45] text-[#374151]">
              <b className="font-semibold text-[#1d2025]">{C.whyThis}</b> <bdi>{r.focus.why}</bdi>
            </p>
          ) : null}
          {r.focus.tryLine ? (
            <p data-testid="report-try" className="m-0 mt-3 rounded-[14px] bg-[#f3f4f6] px-3.5 py-3 text-[16px] font-medium leading-[1.45]">
              <b className="font-bold text-[#33374a]">{C.tryLabel}</b> {lang === "ur" ? r.focus.tryLine.ur : r.focus.tryLine.en}
            </p>
          ) : (
            <p data-testid="report-try-pending" className="m-0 mt-3 rounded-[14px] border-[1.5px] border-dashed border-[#b45309] bg-white px-3.5 py-3 text-[14px] text-[#6b7280]">
              <b className="font-bold text-[#33374a]">{C.tryLabel}</b> {C.tryPending}
            </p>
          )}
          <ModuleRow n={r.focus.module} lang={lang} />
        </section>
      ) : null}

      <Foot C={C} />
    </div>
  );
}

function Hero({ r, C, lang, meta, stars }: { r: CoachReport; C: CoachReportCopy; lang: Lang; meta: string[]; stars: boolean }) {
  return (
    <section aria-label={C.title} className="flex flex-col gap-3 rounded-[22px] bg-[#33374a] px-[18px] pb-4 pt-[18px] text-white" data-testid="report-hero">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[.08em] text-[#a9e3c4] rtl:normal-case rtl:tracking-normal rtl:text-[13px]">{C.eyebrow}</span>
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#47ba7d] text-[15px] font-black text-white">N</span>
      </div>
      <p className="m-0 text-[21px] font-semibold leading-[1.35]">{isToday(r.header.at) ? C.headlineToday : C.headline}</p>
      {stars && r.total > 0 ? (
        <>
          <div data-testid="report-score" className="flex items-baseline gap-2.5">
            <b dir="ltr" className="text-[48px] font-extrabold leading-none tracking-[-.02em]">{`${r.done}/${r.total}`}</b>
            <span className="text-[15px] font-semibold text-[#c6e9d5]">{C.behaviours}</span>
          </div>
          <div role="img" aria-label={C.ofTotal(r.done, r.total)} className="flex gap-1">
            {Array.from({ length: r.total }, (_, i) => <Star key={i} on={i < r.done} />)}
          </div>
        </>
      ) : null}
      <div className="border-t border-white/15 pt-2.5 text-[14px] leading-[1.45] text-[#e2e5ea]">
        {r.header.teacher ? <b dir="auto" className="font-bold text-white">{r.header.teacher}</b> : null}
        {meta.map((x) => <span key={x}>{" · "}<span dir="auto">{x}</span></span>)}
      </div>
    </section>
  );
}

function Foot({ C }: { C: CoachReportCopy }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-1.5 text-[13px] text-[#6b7280]">
      <span className="flex shrink-0 items-center gap-2 font-bold text-[#33374a]">
        <span aria-hidden="true" className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-[#47ba7d] text-[12px] font-black text-white">N</span>
        NIETE
      </span>
      <span className="text-end">{C.foot}</span>
    </div>
  );
}

/** Grey outlines where the report goes, at roughly its first screen's size, so the frame never jumps. */
export function ReportOutline() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true" data-testid="report-outline">
      <div className="h-[236px] rounded-[22px] bg-[#e5e7eb]" />
      <div className="h-[42px] rounded-[14px] bg-[#e5e7eb]" />
      <div className="h-[328px] rounded-[18px] bg-[#e5e7eb]" />
      <div className="h-[200px] rounded-[18px] bg-[#e5e7eb]" />
    </div>
  );
}

function Problem({ problem, C, onRetry }: { problem: ReportProblem; C: CoachReportCopy; onRetry: () => void }) {
  const text = problem === "not_ready" ? C.notReady : problem === "not_yours" ? C.notYours : C.loadFailed;
  return (
    <div className={cn(SECTION, "flex flex-col items-center gap-3 py-8 text-center")} data-testid={`report-problem-${problem}`}>
      <p className="m-0 text-[16px] font-semibold text-[#4b5563]">{text}</p>
      {problem === "failed" ? (
        <button type="button" onClick={onRetry} className={cn("flex min-h-[56px] items-center justify-center rounded-2xl border border-[#d1d5db] bg-white px-6 text-[16px] font-semibold text-[#33374a]", FOCUS)}>
          {C.tryAgain}
        </button>
      ) : null}
    </div>
  );
}
