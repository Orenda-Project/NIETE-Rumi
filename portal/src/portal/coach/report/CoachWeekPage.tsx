import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import CoachGate from "../CoachGate";
import TeacherPage from "../../teacher/TeacherPage";
import { useCopy, useLang, type Lang } from "../../teacher/i18n";
import { FOCUS, OUTLINE_WIDE, PRIMARY_WIDE } from "../../teacher/ui/styles";
import { useBack } from "../../lib/useBack";
import { COACH_MODULES, COACH_TRAINING_PATH, modulePath } from "../coachTraining/modules";
import { COACH_REPORT, type CoachReportCopy } from "./copy";
import { getCoachWeek, markWeek, problemOf, type CoachWeek, type ReportProblem } from "./api";
import { LABEL, LanguagePill, ModuleRow, PILL, ReportOutline, SECTION, Spark, Tick, pick } from "./CoachReportPage";

/**
 * Coach reports in the app, phase 3 — her WEEK as a page (/portal/coach/week/:monday), in the same app look as the debrief
 * report, with the ICT HITL owner's content and order: complete observations against 12 (never red) → the ONE focus,
 * counts day by day against her own last week → steady strengths → at most two misses to keep in mind → next week (where
 * she is, the four steps, the module, what comes next) → Respect → the full table of all 8, folded → "just for you".
 * Counts only, never a percentage, never a quote. Fewer than 4 debriefs: the counts only. Every number comes from the
 * server (computed from the judge's booleans). Opening it stamps "opened" once (no WhatsApp link follows).
 */
const span = (monday: string, friday: string, lang: Lang) => {
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang === "ur" ? "ur-PK" : "en-GB", { ...o, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return `${f(monday, { day: "numeric" })}–${f(friday, { day: "numeric", month: "short" })}`;
};
const dayWord = (date: string, lang: Lang) => new Intl.DateTimeFormat(lang === "ur" ? "ur-PK" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export default function CoachWeekPage() {
  const C = useCopy(COACH_REPORT) as CoachReportCopy;
  const lang = useLang();
  const { monday = "" } = useParams();
  const back = useBack("/portal/coach");
  const [week, setWeek] = useState<CoachWeek | null>(null);
  const [problem, setProblem] = useState<ReportProblem | null>(null);
  const stamped = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    getCoachWeek(monday).then((w) => { if (live) setWeek(w); }).catch((err) => { if (live) setProblem(problemOf(err)); });
    return () => { live = false; };
  }, [monday]);
  useEffect(() => {
    if (week && stamped.current !== week.monday) { stamped.current = week.monday; void markWeek(week.monday, "opened"); }
  }, [week]);

  return (
    <CoachGate>
      <TeacherPage feature="reports" title={C.weekTitle} crumb={week ? `${C.crumb} · ${span(week.monday, week.friday, lang)}` : C.crumb}
        onBack={back} action={<LanguagePill />} testId="coach-week">
        {week ? <WeekBody w={week} C={C} lang={lang} />
          : problem ? <p data-testid={`week-problem-${problem}`} className={cn(SECTION, "m-0 py-8 text-center text-[16px] font-semibold text-[#4b5563]")}>{problem === "not_ready" ? C.notReady : problem === "not_yours" ? C.notYours : C.loadFailed}</p>
            : <ReportOutline />}
      </TeacherPage>
    </CoachGate>
  );
}

export function WeekBody({ w, C, lang }: { w: CoachWeek; C: CoachReportCopy; lang: Lang }) {
  const f = w.focus;
  const firstPicked = f ? Math.max(0, f.days.findIndex((d) => d.items.length > 0)) : 0;
  const [day, setDay] = useState(firstPicked);
  const [open, setOpen] = useState(false);
  const delta = f && f.last ? f.week.done - f.last.done : null;
  const mod = f?.module ? COACH_MODULES.find((m) => m.n === f.module) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="week-body">
      <section aria-label={C.weekTitle} data-testid="week-hero" className="flex flex-col gap-3 rounded-[22px] bg-[#33374a] px-[18px] pb-4 pt-[18px] text-white">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold uppercase tracking-[.08em] text-[#a9e3c4] rtl:normal-case rtl:tracking-normal rtl:text-[13px]">{C.weekEyebrow}</span>
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[#47ba7d] text-[15px] font-black">N</span>
        </div>
        <p className="m-0 text-[21px] font-semibold leading-[1.35]">{C.weekHeadline}</p>
        <div data-testid="week-score" className="flex items-baseline gap-2.5">
          <b dir="ltr" className="text-[48px] font-extrabold leading-none tracking-[-.02em]">{`${w.complete}/${w.target}`}</b>
          <span className="text-[15px] font-semibold text-[#c6e9d5]">{C.complete}</span>
        </div>
        <div role="img" aria-label={`${w.complete} / ${w.target}`} className="flex gap-[3px]">
          {Array.from({ length: w.target }, (_, i) => <i key={i} className={cn("h-2 flex-1 rounded-full", i < w.complete ? "bg-[#47ba7d]" : "bg-white/20")} />)}
        </div>
        <p className="m-0 -mt-1 text-[13px] leading-[1.45] text-[#c6e9d5]">{C.completeNote}</p>
        <div className="border-t border-white/15 pt-2.5 text-[14px] text-[#e2e5ea]">{span(w.monday, w.friday, lang)} · {C.weekSpan}</div>
      </section>

      {!f ? <p className={cn(SECTION, "m-0 text-center text-[16px] font-semibold text-[#4b5563]")} data-testid="week-empty">{C.noDebriefs}</p> : (
        <section aria-label={C.weekFocus} data-testid="week-focus" className={cn(SECTION, "border-2 border-[#6e52e0]")}>
          <h3 className={LABEL}>
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eeeafd] text-[#6e52e0]"><Spark /></span>
            {C.weekFocus}
          </h3>
          <p className="m-0 text-[18px] font-semibold leading-[1.35]">{pick(f.name, lang)}</p>
          <p data-testid="week-focus-count" className="m-0 mb-3 mt-0.5 text-[22px] font-bold">{C.ofDebriefs(f.week.done, f.week.of)}</p>
          <div role="radiogroup" aria-label={C.dayHint} className="[display:grid] grid-cols-5 gap-1.5">
            {f.days.map((d, i) => (
              <button key={d.date} type="button" role="radio" aria-checked={day === i} data-day={d.date} onClick={() => setDay(i)}
                className={cn("flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-[14px] border px-0.5 text-[13px] font-semibold", FOCUS,
                  day === i ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#e5e7eb] bg-white text-[#4b5563]")}>
                <span>{dayWord(d.date, lang)}</span>
                <span className="flex min-h-[10px] gap-1" aria-hidden="true">
                  {d.items.map((ok, j) => <i key={j} className={cn("h-2.5 w-2.5 rounded-full", ok ? (day === i ? "bg-[#47ba7d]" : "bg-[#2f7a52]") : (day === i ? "bg-white/30" : "bg-[#e5e7eb]"))} />)}
                </span>
              </button>
            ))}
          </div>
          <p data-testid="week-day" className="m-0 mt-2.5 rounded-[14px] bg-[#f3f4f6] px-3 py-2.5 text-[14px] leading-[1.5]">
            {dayWord(f.days[day].date, lang)}: {f.days[day].items.length
              ? f.days[day].items.map((ok, j) => `${C.debrief(j + 1)} ${ok ? "✓" : "—"}`).join(" · ")
              : "—"}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[14px] text-[#4b5563]" data-testid="week-compare">
            {f.last ? (
              <>
                <span className={cn(PILL, delta && delta > 0 ? "bg-[#eaf6ef] text-[#2f7a52]" : "bg-[#f3f4f6] text-[#374151]")}>
                  {delta && delta > 0 ? C.upBy(delta) : delta && delta < 0 ? C.downBy(-delta) : C.same}
                </span>
                {C.lastWeek(f.last.done, f.last.of)}
              </>
            ) : C.firstWeek}
          </div>
          <p className="m-0 mt-2 text-[13px] text-[#6b7280]">{C.dayHint}</p>
        </section>
      )}

      {w.small && f ? <p className={cn(SECTION, "m-0 text-[14px] leading-[1.5] text-[#4b5563]")} data-testid="week-small">{C.smallWeek}</p> : null}

      {w.strengths.length ? (
        <section aria-label={C.steady} className={SECTION} data-testid="week-steady">
          <h3 className={LABEL}>{C.steady} <span className={cn(PILL, "bg-[#f3f4f6] text-[#374151]")}>{C.ofTheWeek(w.debriefs)}</span></h3>
          <div className="flex flex-wrap gap-1.5">
            {w.strengths.map((s) => (
              <span key={s.key} className="inline-flex min-h-[28px] items-center gap-1.5 whitespace-nowrap rounded-full bg-[#eaf6ef] px-2.5 text-[13px] font-semibold text-[#2f7a52]">
                <Tick size={12} />{pick(s.name, lang)} <b dir="ltr" className="font-bold text-[#1d2025]">{`${s.done}/${s.of}`}</b>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {w.keepInMind.length ? (
        <section aria-label={C.keep} className={SECTION} data-testid="week-keep">
          <h3 className={LABEL}>{C.keep} <span className={cn(PILL, "bg-[#f3f4f6] text-[#374151]")}>{C.notExtra}</span></h3>
          <div className="flex flex-col gap-1">
            {w.keepInMind.map((k) => (
              <div key={k.key} className="-mx-2.5 flex items-start gap-3 rounded-[14px] p-2.5">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fef3c7] text-[17px] font-extrabold text-[#b45309]">!</span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <b className="text-[16px] font-semibold leading-[1.3]">{pick(k.name, lang)}</b>
                  <span className="text-[13px] font-semibold text-[#6b7280]">{C.doneIn(k.done, k.of)}</span>
                  {pick(k.why, lang) ? <p className="m-0 text-[15px] leading-[1.45] text-[#374151]"><b className="font-semibold text-[#1d2025]">{C.why}</b> {pick(k.why, lang)}</p> : null}
                  <ModuleRow n={k.module} lang={lang} />
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {f ? (
        <section aria-label={C.next} className={SECTION} data-testid="week-next">
          <h3 className={LABEL}><span className={cn(PILL, "bg-[#eaf6ef] text-[#2f7a52]")}>{C.next}</span></h3>
          <p className="m-0 text-[18px] font-semibold leading-[1.35]">{f.reached ? C.reached(pick(f.name, lang)) : C.stays(pick(f.name, lang))}</p>
          <p className="m-0 mt-2 text-[15px] leading-[1.45] text-[#374151]"><b className="font-semibold text-[#1d2025]">{C.whereYouAre}</b> {C.lastTen(f.last10.done, f.last10.of, f.doneAt)}</p>
          {f.steps ? (
            <>
              <p className="m-0 mt-3.5 text-[12px] font-bold uppercase tracking-[.08em] text-[#6b7280] rtl:normal-case rtl:tracking-normal rtl:text-[13px]">
                {C.howTo}{f.steps.reviewed ? null : <span className={cn(PILL, "ms-2 bg-[#fef3c7] text-[#b45309]")} data-testid="week-steps-draft">{C.stepsDraft}</span>}
              </p>
              <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0" data-testid="week-steps">
                {(lang === "ur" ? f.steps.ur : f.steps.en).map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-[15px] leading-[1.45]">
                    <span aria-hidden="true" className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#e8e9f0] text-[13px] font-bold text-[#33374a]">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          {f.nextName ? <p className="m-0 mt-3 text-[15px] leading-[1.45] text-[#374151]"><b className="font-semibold text-[#1d2025]">{C.afterThat}</b> {C.thenNext(pick(f.nextName, lang))}</p> : null}
          {mod ? <Link to={modulePath(mod)} data-testid="week-open-module" className={cn(PRIMARY_WIDE, "mt-3 text-center leading-tight", FOCUS)}>{C.openModule(mod.n, lang === "ur" ? mod.title.ur : mod.title.en)}</Link> : null}
          <Link to={COACH_TRAINING_PATH} className={cn(OUTLINE_WIDE, "mt-2", FOCUS)}>{C.allModules}</Link>
        </section>
      ) : null}

      {w.respectAll ? (
        <p className="m-0 flex items-center gap-2 rounded-[14px] bg-[#eaf6ef] px-3.5 py-2.5 text-[14px] font-semibold text-[#2f7a52]"><Tick size={16} /><span>{C.respectWeek}</span></p>
      ) : null}

      {w.debriefs > 0 ? (
        <section className={cn(SECTION, "px-4 py-0")} data-testid="week-table">
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
            className={cn("flex min-h-[56px] w-full items-center justify-between text-[16px] font-semibold text-[#33374a]", FOCUS)}>
            <span>{C.fullWeek}</span><ChevronDown aria-hidden="true" className={cn("h-5 w-5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          </button>
          {open ? (
            <table className="mb-3 w-full border-collapse text-[14px]">
              <thead><tr className="text-start text-[12px] text-[#6b7280]"><th className="py-1.5 text-start font-bold">{C.behaviour}</th><th className="py-1.5 text-start font-bold">{C.thisWeek}</th><th className="py-1.5 text-start font-bold">{C.lastWeekCol}</th></tr></thead>
              <tbody>
                {w.table.map((r) => (
                  <tr key={r.key} className={cn("border-t border-[#f0f1f3]", f && r.key === f.key && "bg-[#f4f5f8] font-bold")}>
                    <td className="py-1.5">{pick(r.name, lang)}</td>
                    <td dir="ltr" className="py-1.5 text-start">{`${r.week.done}/${r.week.of}`}</td>
                    <td dir="ltr" className="py-1.5 text-start">{r.last ? `${r.last.done}/${r.last.of}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}

      <div className="flex items-center justify-between gap-3 px-1 pt-1.5 text-[13px] text-[#6b7280]">
        <span className="flex shrink-0 items-center gap-2 font-bold text-[#33374a]">
          <span aria-hidden="true" className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-[#47ba7d] text-[12px] font-black text-white">N</span>NIETE
        </span>
        <span className="text-end">{C.weekFoot}</span>
      </div>
    </div>
  );
}
