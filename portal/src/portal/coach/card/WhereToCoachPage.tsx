import { useId, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Lock, Smartphone } from "lucide-react";
import { GradeSubjectLead, StatusChip } from "../../teacher/ui";
import { subjectShort } from "../../teacher/ui/subjects";
import { useCopy, useLang, type Lang } from "../../teacher/i18n";
import { Loading, SectionLabel } from "../ui";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";
import { SCHOOL_CARD, type SchoolCardCopy } from "./copy";
import { WHERE, type WhereCopy } from "./whereCopy";
import { where, type CheckinItem, type Practice, type Tips, type WhereToCoachData, type Why } from "./where";
import { CardOnly, useBackTo, useCardLoad } from "./frame";
import { dayLabel, pkDate, usePeriod, withPeriod } from "./period";
import { PeriodChips } from "./parts";
import { kindColour } from "./scores";

/**
 * WHERE TO COACH (bd-17v39c.4.14), coach only, never shared: no share button, and nothing here reaches a shared image.
 * Rifat's screen 3, in her block order, filled by her DC pattern engine on the server: how to run the conversation (a
 * strength, ONE focus and why, show it, agree the next step); the NIETE-use check-in; the framework sections, weakest
 * first; the weakest practices with What to try; how closely she followed the plan; what the AI coach told her last; her
 * DC observations, each opening its full report. Opens on This month (Rifat's pick 1B), with the chips to change it.
 * Every number, tip and reason is the server's. A blocker the coach taps shows its support line; it is not saved.
 */
const CARD = "rounded-[20px] border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const TAP = "transition-colors hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]";
const H2 = "m-0 text-[20px] font-semibold leading-[1.3] text-[#1d2025] rtl:leading-[1.8]";
const META = "text-[13px] font-semibold leading-[1.4] text-[#6b7280] rtl:leading-[1.9]";

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function Code({ children }: { children: ReactNode }) {
  return <span dir="ltr" className="inline-flex h-[24px] shrink-0 items-center rounded-md bg-[#33374a] px-1.5 text-[12.5px] font-extrabold text-white">{children}</span>;
}

function whyLine(why: Why, W: WhereCopy, C: SchoolCardCopy): string {
  switch (why.test) {
    case 1: return W.whyBoth;
    case 2: return why.source === "coach" ? W.whyLowCoach(why.k, why.n) : W.whyLow(why.k, why.n);
    case 3: return W.whyStep(C.stepNames[["Opening", "Explanation", "We Do", "You Do", "Check"].indexOf(why.step)] ?? why.step);
    default: return W.whyLowest;
  }
}

const tipOf = (tips: Tips, lang: Lang) => (tips ? tips[lang] : null);

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li data-testid="convo-step" className="flex gap-3 border-t border-[#f0f1f3] px-3.5 py-3 first:border-t-0">
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eaf6ef] text-[15px] font-bold text-[#2f7a52]">{n}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="text-[16px] font-semibold leading-[1.35] rtl:leading-[1.8]">{title}</b>
        <span className="text-[15px] leading-[1.45] text-[#374151] rtl:leading-[1.9]">{children}</span>
      </span>
    </li>
  );
}

function Conversation({ d, W, C, lang }: { d: WhereToCoachData; W: WhereCopy; C: SchoolCardCopy; lang: Lang }) {
  const f = d.focus;
  if (!f) return null;
  const s = d.strength;
  const tryThis = tipOf(f.tips, lang)?.tryThis;
  return (
    <section data-testid="convo" className={CARD}>
      <h2 className={`${H2} px-3.5 pt-3`}>{W.convoH}</h2>
      <ol className="m-0 list-none p-0">
        <Step n={1} title={W.c1h}>
          {s ? <span data-testid="strength"><bdi>{W.c1(s.id, s.name ?? "", C.outOf(Number(fmt(s.avg)), s.scaleMax))}</bdi></span> : W.c1None}
        </Step>
        <Step n={2} title={W.c2h}>
          <span className="flex flex-wrap items-center gap-1.5"><Code>{f.id}</Code><b dir="auto" data-testid="focus-name">{f.name}</b></span>
          <em data-testid="why" className="mt-1 block not-italic text-[#6b7280]">{W.whyLabel} {whyLine(f.why, W, C)}</em>
        </Step>
        {tryThis && <Step n={3} title={W.c3h}><span data-testid="try-focus">{tryThis}</span></Step>}
        <Step n={tryThis ? 4 : 3} title={W.c4h}>{W.c4(f.id)}</Step>
      </ol>
      <p className={`${META} m-0 border-t border-[#f0f1f3] px-3.5 py-2.5`}>{W.convoNote}</p>
    </section>
  );
}

function CheckinCard({ item, W, lang, unit }: { item: CheckinItem; W: WhereCopy; lang: Lang; unit: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const c = item.content ? item.content[lang] : null;
  if (!c) return null;
  const status = item.state === "none" ? W.stNone(unit)
    : item.feature === "dc" ? W.stDcLow(item.count, unit)
      : item.feature === "lp" ? W.stLpLow(item.count, unit)
        : W.stTrn(unit);
  return (
    <div data-testid="checkin-card" data-feature={item.feature} className="flex flex-col gap-2 border-t border-[#f0f1f3] px-3.5 py-3">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-[16px] font-semibold">{W.features[item.feature]}</b>
        <StatusChip text={status} tone="waiting" />
      </span>
      <span className={META}>{W.ask}</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {c.questions.map((q) => <li key={q} className="text-[15px] leading-[1.45] rtl:leading-[1.9]">“{q}”</li>)}
      </ul>
      <span className={META}>{W.listen}</span>
      <div className="flex flex-wrap gap-2">
        {c.blockers.map(([b], i) => (
          <button key={b} type="button" aria-pressed={picked === i} onClick={() => setPicked(picked === i ? null : i)}
            className={`min-h-[44px] rounded-full border px-3 text-[14px] font-semibold ${TAP} ${picked === i ? "border-[#33374a] bg-[#f4f5f8] text-[#33374a]" : "border-[#e5e7eb] bg-white text-[#374151]"}`}>
            {b}
          </button>
        ))}
      </div>
      {picked != null && (
        <div data-testid="support" className="rounded-xl bg-[#eaf6ef] px-3 py-2">
          <small className={META}>{W.support}</small>
          <p className="m-0 text-[15px] leading-[1.45] text-[#1d2025] rtl:leading-[1.9]">{c.blockers[picked][1]}</p>
        </div>
      )}
    </div>
  );
}

function Checkin({ d, W, lang }: { d: WhereToCoachData; W: WhereCopy; lang: Lang }) {
  const unit = W.unit[d.period.key];
  return (
    <section data-testid="checkin" className={CARD}>
      <div className="flex flex-col gap-0.5 px-3.5 py-3">
        <h2 className={H2}>{W.chkH}</h2>
        <span className={META}>{W.chkSub}</span>
      </div>
      {d.checkin.items.length
        ? d.checkin.items.map((i) => <CheckinCard key={i.feature} item={i} W={W} lang={lang} unit={unit} />)
        : <p data-testid="checkin-none" className="m-0 border-t border-[#f0f1f3] px-3.5 py-3 text-[15px] font-semibold text-[#2f7a52]">{W.allGood(unit)}</p>}
    </section>
  );
}

function Bar({ label, pct, colour }: { label: string; pct: number | null; colour: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px] font-semibold text-[#6b7280]">
      <span className="w-[86px] shrink-0">{label}</span>
      <span dir="ltr" className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#f0f1f3]">
        {pct != null && <span className="absolute inset-y-0 start-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: colour }} />}
      </span>
      <b dir="ltr" className="w-[40px] shrink-0 text-end tabular-nums text-[#1d2025]">{pct == null ? "—" : `${pct}%`}</b>
    </span>
  );
}

function Sections({ d, W, C }: { d: WhereToCoachData; W: WhereCopy; C: SchoolCardCopy }) {
  if (!d.sections.length) return null;
  return (
    <section data-testid="sections" className={CARD}>
      <h2 className={`${H2} px-3.5 py-3`}>{W.fwH}</h2>
      {d.sections.map((s) => (
        <div key={s.code} data-testid="section-row" data-code={s.code} className="flex flex-col gap-1.5 border-t border-[#f0f1f3] px-3.5 py-3">
          <span className="flex flex-wrap items-center gap-2">
            <Code>{s.code}</Code>
            <b dir="auto" className="min-w-0 flex-1 text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]">{C.sectionNames[s.code]}</b>
            {s.focusHere && <StatusChip text={W.focusHere} tone="waiting" />}
            {s.differ && <StatusChip text={W.differ} tone="info" />}
          </span>
          <Bar label={W.aiScore} pct={s.dc} colour={kindColour("dc")} />
          <Bar label={W.coachScore} pct={s.coach} colour={kindColour("coach")} />
        </div>
      ))}
    </section>
  );
}

function PracticeRow({ p, W, C, lang, source }: { p: Practice; W: WhereCopy; C: SchoolCardCopy; lang: Lang; source: "dc" | "coach" }) {
  const [open, setOpen] = useState(!!p.focus);
  const id = useId();
  const tip = tipOf(p.tips, lang);
  return (
    <div data-testid="weak-row" data-id={p.id} className="flex flex-col gap-1.5 border-t border-[#f0f1f3] px-3.5 py-3">
      <span className="flex flex-wrap items-center gap-2">
        <Code>{p.id}</Code>
        <b dir="auto" className="min-w-0 flex-1 text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]">{p.name}</b>
        <b dir="ltr" className="shrink-0 text-[16px] tabular-nums">{C.outOf(Number(fmt(p.avg)), p.scaleMax)}</b>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {p.focus && <StatusChip text={W.yourFocus} tone="waiting" />}
        <span className={META}>{source === "coach" ? W.lowInCoach(p.k, p.n) : W.lowIn(p.k, p.n)}</span>
      </span>
      {tip && (
        <>
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
            className={`flex min-h-[44px] items-center gap-1 self-start rounded-lg px-1 text-[14px] font-semibold text-[#33374a] ${TAP}`}>
            {W.tryBtn}<ChevronDown className={`h-[18px] w-[18px] motion-safe:transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {open && (
            <div id={id} data-testid="tip" className="flex flex-col gap-2 rounded-xl bg-[#f9fafb] px-3 py-2.5">
              <span><small className={META}>{W.lookFor}</small><p className="m-0 text-[15px] leading-[1.45] rtl:leading-[1.9]">{tip.lookFor}</p></span>
              <span><small className={META}>{W.tryThis}</small><p className="m-0 text-[15px] leading-[1.45] rtl:leading-[1.9]">{tip.tryThis}</p></span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Weakest({ d, W, C, lang }: { d: WhereToCoachData; W: WhereCopy; C: SchoolCardCopy; lang: Lang }) {
  if (!d.weakest.length) return null;
  const source = d.sessions.dc ? "dc" : "coach";
  return (
    <section data-testid="weakest" className={CARD}>
      <h2 className={`${H2} px-3.5 py-3`}>{W.weakH}</h2>
      {d.weakest.map((p) => <PracticeRow key={p.id} p={p} W={W} C={C} lang={lang} source={source} />)}
    </section>
  );
}

function Plan({ d, W, C, lang }: { d: WhereToCoachData; W: WhereCopy; C: SchoolCardCopy; lang: Lang }) {
  if (!d.sessions.dc) return null;
  const p = d.plan;
  return (
    <section data-testid="plan" className={`${CARD} flex flex-col gap-2 px-3.5 py-3`}>
      <h2 className={H2}>{W.planH}</h2>
      {!p
        ? <p className="m-0 text-[15px] text-[#6b7280]">{W.noPlan}</p>
        : (
          <>
            <b dir="ltr" className="self-start text-[28px] font-bold tabular-nums">{p.pct}%</b>
            <p className="m-0 text-[15px] leading-[1.45] rtl:leading-[1.9]">{W.planLine(p.pct)} {W.planUsed(p.measured, p.of)}</p>
            <span className={META}>{W.skippedH}</span>
            {p.skipped.length
              ? p.skipped.map((s) => (
                <div key={s.step} data-testid="skipped-step" className="flex flex-col gap-1 rounded-xl bg-[#f9fafb] px-3 py-2">
                  <span className="flex items-center justify-between gap-2">
                    <b className="text-[15px]">{C.stepNames[s.index - 1] ?? s.step}</b>
                    <StatusChip text={W.skippedRow(s.skipped, s.of)} tone="info" />
                  </span>
                  {tipOf(s.tips, lang) && <span className="text-[14px] leading-[1.45] text-[#374151] rtl:leading-[1.9]">{tipOf(s.tips, lang)?.tryThis}</span>}
                </div>
              ))
              : <span className="text-[15px] font-semibold text-[#2f7a52]">{W.noSkipped}</span>}
          </>
        )}
    </section>
  );
}

function Advice({ d, W, C }: { d: WhereToCoachData; W: WhereCopy; C: SchoolCardCopy }) {
  const a = d.lastAdvice;
  if (!a) return null;
  return (
    <section data-testid="advice" className={`${CARD} flex flex-col gap-1.5 px-3.5 py-3`}>
      <h2 className={H2}>{W.adviceH}</h2>
      <span className={META}>{W.adviceMeta(dayLabel(a.date, d.period.today, C))}</span>
      <blockquote dir="auto" className="m-0 border-s-4 border-[#e5e7eb] ps-3 text-[16px] leading-[1.5] rtl:leading-[1.9]">“{a.text}”</blockquote>
      <span className={META}>{W.adviceNote}</span>
    </section>
  );
}

function Sessions({ d, W, C, lang, here }: { d: WhereToCoachData; W: WhereCopy; C: SchoolCardCopy; lang: Lang; here: string }) {
  if (!d.reports.length) return null;
  const today = d.period.today ?? pkDate(new Date().toISOString()) ?? undefined;
  return (
    <>
      <div data-testid="sessions-head" className="flex flex-col gap-0.5">
        <SectionLabel count={d.sessions.dc}>{W.sessionsH}</SectionLabel>
        <span className={`${META} mx-1`}>{W.sessionsSub}</span>
      </div>
      <section className={`overflow-hidden ${CARD}`}>
        {d.reports.map((r, i) => (
          <Link key={r.id} to={withPeriod(`/portal/coach/session/${encodeURIComponent(r.id)}`, d.period.key)} state={{ back: here }}
            data-testid="session-row" data-id={r.id}
            className={`flex min-h-[76px] items-stretch gap-3 bg-white pe-3.5 text-[#1d2025] ${TAP} ${i ? "border-t border-[#f0f1f3]" : ""}`}>
            <GradeSubjectLead grade={r.grade} subject={r.subject ?? ""} />
            <span className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
              <span dir="auto" className="line-clamp-2 text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]">
                <bdi>{r.title || C.lessonOf(r.subject ? subjectShort(r.subject, lang) : "")}</bdi>
              </span>
              <span className="flex items-center gap-[5px] text-[13px] font-semibold text-[#6b7280]">
                <Smartphone className="h-[15px] w-[15px] shrink-0" strokeWidth={2.2} style={{ color: kindColour("dc") }} aria-hidden="true" />
                {dayLabel(r.date, today, C)}
              </span>
              <span className="mt-0.5 flex flex-wrap gap-1.5">
                {r.score != null && <StatusChip text={C.aiScoreN(Math.round(r.score))} tone="score" />}
                {r.weakest && <StatusChip text={W.weakestTag(r.weakest)} tone="info" />}
              </span>
            </span>
            <ChevronRight className="h-[22px] w-[22px] shrink-0 self-center text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
          </Link>
        ))}
      </section>
      {d.moreReports > 0 && <p data-testid="more-sessions" className={`${META} m-0 text-center`}>{W.more(d.moreReports, W.unit[d.period.key])}</p>}
    </>
  );
}

function WhereToCoach() {
  const W = useCopy(WHERE);
  const C = useCopy(SCHOOL_CARD);
  const lang = useLang();
  const { ext = "" } = useParams();
  const { pathname, search } = useLocation();
  const [period] = usePeriod();
  const backTo = useBackTo(withPeriod(`/portal/coach/teacher/${encodeURIComponent(ext)}`, period));
  const { data: d, failed, reload } = useCardLoad<WhereToCoachData>(() => where.teacher(ext, period), [ext, period]);
  const known = useRef<WhereToCoachData["teacher"] | null>(null);
  if (d?.teacher) known.current = d.teacher;
  const t = d?.teacher ?? known.current;

  return (
    <PeopleFrame title={W.title} crumb={t?.name || undefined} feature="schools" backTo={backTo}>
      <div data-testid="where-head" className="mx-1 flex flex-col gap-1">
        {d && <span className={META}><bdi>{t?.school ?? ""}</bdi>{t?.school ? " · " : ""}{W.counts(d.sessions.dc, d.sessions.coach)}</span>}
        <span data-testid="coach-only" className="flex items-center gap-1.5 text-[13px] font-semibold text-[#b45309]">
          <Lock className="h-4 w-4" aria-hidden="true" />{W.never}
        </span>
      </div>
      <PeriodChips />
      {failed && <LoadFailed onRetry={reload} />}
      {!d && !failed && <Loading />}
      {d && (
        <>
          {d.signal === "early" && <p data-testid="signal" className="m-0 rounded-xl bg-[#fef3c7] px-3 py-2 text-[14px] font-semibold text-[#b45309]">{W.early}</p>}
          {d.signal === "coach_only" && <p data-testid="signal" className="m-0 rounded-xl bg-[#f3f4f6] px-3 py-2 text-[14px] font-semibold text-[#374151]">{W.coachOnly}</p>}
          {d.signal === "empty" && <EmptyRow icon={<span>·</span>} testId="where-empty">{W.empty}</EmptyRow>}
          <Conversation d={d} W={W} C={C} lang={lang} />
          <Checkin d={d} W={W} lang={lang} />
          <Sections d={d} W={W} C={C} />
          <Weakest d={d} W={W} C={C} lang={lang} />
          <Plan d={d} W={W} C={C} lang={lang} />
          <Advice d={d} W={W} C={C} />
          <Sessions d={d} W={W} C={C} lang={lang} here={`${pathname}${search}`} />
          <p className="m-0 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-[#6b7280]">
            <Lock className="h-4 w-4" aria-hidden="true" />{W.never}
          </p>
        </>
      )}
    </PeopleFrame>
  );
}

export default function WhereToCoachPage() {
  return <CardOnly><WhereToCoach /></CardOnly>;
}
