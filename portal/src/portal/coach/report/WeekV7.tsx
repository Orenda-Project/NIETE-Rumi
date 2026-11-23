import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopy, type Lang } from "../../teacher/i18n";
import { FOCUS } from "../../teacher/ui/styles";
import { COACH_MODULES, modulePath } from "../coachTraining/modules";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { FLOW_V7_WEEK, type FlowV7WeekCopy } from "../flow/copyV7week";
import type { CoachReportCopy } from "./copy";
import type { CoachWeek } from "./api";
import { weekSpan } from "./weekSpan";
import { LABEL, SECTION, pick } from "./CoachReportPage";
import { CountBar, DarkTop, FocusCount, KeyFocusCard, RespectLine } from "./v7Parts";

/**
 * bd-o15qnr.28.1 (queue #204, v7; #188's c8-week-page, c8-week-focus-options option A) — her week in the app's v6/v7 look,
 * behind the v6/v7 switch (CoachWeekPage decides; off, today's WeekBody exactly). The board's order:
 *
 *   1 the reports' dark top card: WEEKLY REPORT, n/12 complete observations, the twelve segments, the days it covers
 *   2 the Key Focus Area FIRST (option B card): its name, the debriefs that included it of her last 10 (all if fewer), a
 *     bar with the goal mark at 6 of 10 (bot coach-week.js FOCUS_DONE_AT / FOCUS_WINDOW), "Goal 6 of 10"; then its ONE
 *     Coach Training module (queue #186: one training, never more)
 *   3 this week, day by day: the debriefs each day (information, nothing to tap)
 *   4 steady strengths (chips with their count), keep in mind (count and bar; with no focus, the one module under them)
 *   5 Respect held on its own line, not one of the 8 (the operator, 20 Nov 15:04), above the full week of all 8, folded
 *   6 just for you
 *
 * No sentences (the operator: "Too much text. We dont want full sentences here"): no where-you-are line, no four steps, no
 * why lines, no small-week note. Counts in the words, never a %. Every number comes from the server.
 */
const dayWord = (date: string, lang: Lang) => new Intl.DateTimeFormat(lang === "ur" ? "ur-PK" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export function WeekBodyV7({ w, C, lang }: { w: CoachWeek; C: CoachReportCopy; lang: Lang }) {
  const W = useCopy(FLOW_V7) as FlowV7Copy;
  const K = useCopy(FLOW_V7_WEEK) as FlowV7WeekCopy;
  const [open, setOpen] = useState(false);
  const f = w.focus;
  const mod = w.training ? COACH_MODULES.find((m) => m.n === w.training) ?? null : null;
  const training = mod ? (
    <Link to={modulePath(mod)} data-testid="week-open-module"
      className={cn("mt-1 flex min-h-[56px] items-center justify-center gap-2.5 rounded-2xl bg-[#33374a] px-4 text-center text-[16px] font-semibold leading-tight text-white rtl:leading-[1.8]", FOCUS)}>
      <GraduationCap className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{C.openModule(mod.n, lang === "ur" ? mod.title.ur : mod.title.en)}</span>
    </Link>
  ) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="week-body-v7">
      <DarkTop testId="week-hero" ariaLabel={C.weekTitle} eyebrow={C.weekEyebrow} done={w.complete} of={w.target} words={K.completeObs}
        foot={<bdi>{weekSpan(w.monday, w.friday, lang)} · {C.weekSpan}</bdi>} />

      {w.debriefs === 0 ? (
        <p data-testid="week-empty" className={cn(SECTION, "m-0 flex min-h-[64px] items-center py-0 text-[16px] font-semibold text-[#4b5563]")}>{C.noDebriefs}</p>
      ) : null}

      {f ? (
        <KeyFocusCard testId="week-focus" label={W.keyFocus} name={pick(f.name, lang)}>
          <FocusCount count={C.ofTotal(f.last10.done, f.last10.of)} goalText={K.goal(f.doneAt, 10)}
            done={f.last10.done} of={f.last10.of} goal={f.doneAt} window={10} />
          {training}
        </KeyFocusCard>
      ) : null}

      {f && w.debriefs > 0 ? (
        <section aria-label={K.dayByDay} data-testid="week-days" className="flex flex-col gap-2">
          <h3 className="m-0 mx-1 mt-1 text-[20px] font-light leading-[1.3]">{K.dayByDay}</h3>
          <div className="[display:grid] grid-cols-5 overflow-hidden rounded-[14px] border border-[#e5e7eb] bg-white">
            {f.days.map((d, i) => (
              <div key={d.date} className={cn("flex min-h-[56px] flex-col items-center justify-center gap-1 py-2", i > 0 && "border-s border-[#f0f1f3]")}>
                <span className="text-[12px] font-semibold text-[#6b7280]">{dayWord(d.date, lang)}</span>
                <span data-testid="week-day-count" className="text-[15px] font-bold tabular-nums">{d.items.length}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {w.strengths.length ? (
        <section aria-label={C.steady} className={SECTION} data-testid="week-steady">
          <h3 className={LABEL}>{C.steady}</h3>
          <div className="flex flex-wrap gap-1.5">
            {w.strengths.map((s) => (
              <span key={s.key} className="inline-flex min-h-[28px] items-center gap-1.5 whitespace-nowrap rounded-full bg-[#eaf6ef] px-2.5 text-[13px] font-bold text-[#2f7a52]">
                {pick(s.name, lang)} · <bdi>{C.ofTotal(s.done, s.of)}</bdi>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {w.keepInMind.length ? (
        <section aria-label={C.keep} className={SECTION} data-testid="week-keep">
          <h3 className={LABEL}>{C.keep}</h3>
          <div className="flex flex-col">
            {w.keepInMind.map((k, i) => (
              <div key={k.key} data-testid="week-keep-row" className={cn("flex min-h-[52px] items-center gap-3", i > 0 && "border-t border-[#f0f1f3]")}>
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#fef3c7] text-[15px] font-bold text-[#b45309]">!</span>
                <span className="min-w-0 flex-1 text-[15px] font-semibold leading-[1.3]">{pick(k.name, lang)}</span>
                <CountBar done={k.done} of={k.of} />
                <span className="w-16 shrink-0 text-end text-[14px] font-bold tabular-nums"><bdi>{C.ofTotal(k.done, k.of)}</bdi></span>
              </div>
            ))}
          </div>
          {f ? null : training}
        </section>
      ) : null}

      {w.respectAll ? <RespectLine testId="week-respect" label={W.respectHeld} note={W.respectNote} /> : null}

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

      <p className="m-0 px-1 pt-1.5 text-center text-[13px] text-[#6b7280]">{C.weekFoot}</p>
    </div>
  );
}
