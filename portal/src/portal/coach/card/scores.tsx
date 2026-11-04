import { useId, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Smartphone, Users } from "lucide-react";
import { GradeSubjectLead, StatusChip } from "../../teacher/ui";
import { subjectShort } from "../../teacher/ui/subjects";
import { FeatureArt } from "../../teacher/icons/FeatureArt";
import { FEATURE_HUE } from "../../teacher/icons/features";
import { useCopy, type Lang } from "../../teacher/i18n";
import { SCHOOL_CARD } from "./copy";
import { dayLabel } from "./period";
import { ChangePill, CountsRow, FEATURE_OF } from "./parts";
import type { Bucket, FeatureCounts, PeriodKey, ScoreKind, TeacherScoresData } from "./types";

/**
 * The School card's Digital Coaching and Coach observations pieces (design v9, 29 Oct): a score tile for the School card,
 * the small lines, the days-used dots, her detailed graph, her practice averages and her reports. Colour is meaning: the
 * DC colour for Digital Coaching (round dots), the Observations colour for Coach observations (square points, so the two
 * differ by shape too). Charts read LEFT TO RIGHT in Urdu too; only their labels are Urdu.
 */

export const KIND_ART = { dc: FEATURE_OF.dc, coach: FEATURE_OF.coach } as const;
export const kindColour = (kind: ScoreKind) => FEATURE_HUE[KIND_ART[kind]].fg;
const shapeOf = (kind: ScoreKind): "dot" | "square" => (kind === "dc" ? "dot" : "square");

const CARD = "rounded-[20px] border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const TAP = "transition-colors hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]";

/** A point: a round dot (Digital Coaching) or a square (Coach observations). */
function Mark({ x, y, r, kind, colour, ring = "#fff" }: { x: number; y: number; r: number; kind: ScoreKind; colour: string; ring?: string }) {
  return shapeOf(kind) === "dot"
    ? <circle cx={x} cy={y} r={r} fill={colour} stroke={ring} strokeWidth={r > 4 ? 2 : 1.5} />
    : <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} fill={colour} stroke={ring} strokeWidth={r > 4 ? 2 : 1.5} />;
}

/**
 * A small line of scores: one slot per value (a day or a week of the period, or one report), a point where there is a
 * score, the period's average dashed across. A fixed 40–90 band (wider only when a score falls outside), so the lines of
 * two tiles read alike. `labels` puts the day (and date) under each slot; a day still ahead is grey.
 */
export function ScoreLine({ values, kind, avg, labels, future = [], tiny = false, compact = false, testId = "score-line" }: {
  values: readonly (number | null)[]; kind: ScoreKind; avg: number | null | undefined; labels?: readonly [string, string][];
  future?: readonly boolean[]; tiny?: boolean; compact?: boolean; testId?: string;
}) {
  // tiny: a by-teacher row (no labels); compact: a half-width Teacher tile; else a full-width School card tile.
  const colour = kindColour(kind);
  const W = tiny ? 120 : compact ? 150 : 300;
  const H = tiny ? 26 : compact ? 52 : labels ? 66 : 56;
  const T = tiny ? 6 : compact ? 16 : 20;
  const B = H - (tiny ? 6 : compact ? 8 : 10);
  const r = tiny ? 2.8 : compact ? 4.5 : 6;
  const fs = compact ? 11 : 13;
  const scored = values.filter((v): v is number => typeof v === "number");
  const lo = Math.min(40, ...scored.map((v) => v - 4));
  const hi = Math.max(90, ...scored.map((v) => v + 4));
  const n = Math.max(1, values.length);
  const X = (i: number) => (W / n) * (i + 0.5);
  const Y = (v: number) => B - ((v - lo) / (hi - lo)) * (B - T);
  const pts = values.map((v, i) => (typeof v === "number" ? { i, v } : null)).filter((p): p is { i: number; v: number } => !!p);
  return (
    <div dir="ltr" data-testid={testId} className="flex min-w-0 flex-col" style={{ direction: "ltr" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={tiny ? 26 : undefined} preserveAspectRatio={tiny ? "none" : undefined} aria-hidden="true" className="block overflow-visible">
        {avg != null && (
          <line data-avg={Math.round(avg)} x1={0} x2={W} y1={Y(avg)} y2={Y(avg)} stroke={colour} strokeOpacity={0.55} strokeWidth={tiny ? 1 : 1.5} strokeDasharray="4 3" />
        )}
        {pts.length > 1 && (
          <polyline fill="none" stroke={colour} strokeWidth={tiny ? 1.6 : compact ? 2 : 2.5} strokeLinejoin="round" points={pts.map((p) => `${X(p.i)},${Y(p.v)}`).join(" ")} />
        )}
        {pts.map((p) => (
          <g key={p.i} data-point={shapeOf(kind)}>
            <Mark x={X(p.i)} y={Y(p.v)} r={r} kind={kind} colour={colour} />
            {!tiny && <text x={X(p.i)} y={Y(p.v) - (r + 5)} textAnchor="middle" fontSize={fs} fontWeight={700} fill={colour}>{Math.round(p.v)}</text>}
          </g>
        ))}
      </svg>
      {labels && (
        <div className="mt-1 flex border-t border-[#eef0f3] pt-1">
          {labels.map(([a, b], i) => (
            <span key={i} className={`min-w-0 flex-1 whitespace-nowrap text-center font-semibold leading-[1.2] ${compact ? "text-[9.5px]" : "text-[11.5px]"} ${future[i] ? "text-[#c4c8cf]" : "text-[#6b7280]"}`}>
              {a}{b && !compact ? <small className="block text-[10px] font-medium text-[#9ca3af]">{b}</small> : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The School card's Digital Coaching or Coach observations tile: the name, the average score (big, in the kind's colour)
 * with its word, "N observations · by N of M teachers", and the line of daily (or weekly) averages with the period's
 * average dashed. The whole tile opens that kind by teacher.
 */
export function ScoreTile({ kind, avg, count, makers, teachers, line, to, state }: {
  kind: ScoreKind; avg: number | null; count: number | null; makers: number | null; teachers: number; line?: ReactNode; to: string; state?: unknown;
}) {
  const C = useCopy(SCHOOL_CARD);
  const name = kind === "dc" ? C.digitalCoaching : C.coachObsName;
  const sub = `${C.obsN(count ?? 0)} · ${C.byN(makers ?? 0, teachers)}`;
  return (
    <Link to={to} state={state} data-testid={`score-tile-${kind}`} aria-label={`${name}, ${C.pct(avg)} ${C.avgOf[kind]}, ${sub}`}
      className={`flex flex-col gap-3 ${CARD} p-3.5 ${TAP}`}>
      <span className="flex items-start gap-3">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px]" style={{ background: FEATURE_HUE[KIND_ART[kind]].bg }}>
          <FeatureArt feature={KIND_ART[kind]} size={36} motion={false} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[16px] font-semibold leading-[1.3] text-[#1d2025] rtl:leading-[1.8]">{name}</span>
          <span className="flex flex-wrap items-baseline gap-x-2">
            <b dir="ltr" className="text-[34px] font-bold tabular-nums" style={{ color: avg == null ? "#9ca3af" : kindColour(kind), lineHeight: 1.05 }}>{C.pct(avg)}</b>
            <span className="text-[16px] font-semibold text-[#1d2025]">{C.avgOf[kind]}</span>
          </span>
          <span className="text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{sub}</span>
        </span>
        <ChevronRight className="mt-1.5 h-[22px] w-[22px] shrink-0 text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
      </span>
      {line}
    </Link>
  );
}

/** A summary card (information, flat): the kind's art, the average (big), its word, the change on the period before, a line. */
export function ScoreSummary({ kind, avg, prevAvg, sub, children }: {
  kind: ScoreKind; avg: number | null; prevAvg?: number | null; sub: string; children?: ReactNode;
}) {
  const C = useCopy(SCHOOL_CARD);
  const delta = avg != null && prevAvg != null ? Math.round(avg) - Math.round(prevAvg) : null;
  return (
    <section data-testid="scores-summary" role="group" className="flex flex-col gap-3 rounded-[20px] bg-[#e9ebef] p-3.5 text-[#1d2025]">
      <span className="flex items-center gap-3">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px]" style={{ background: FEATURE_HUE[KIND_ART[kind]].bg }}>
          <FeatureArt feature={KIND_ART[kind]} size={36} motion={false} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <b dir="ltr" className="text-[34px] font-bold tabular-nums" style={{ color: avg == null ? "#9ca3af" : kindColour(kind), lineHeight: 1.05 }}>{C.pct(avg)}</b>
            <span className="text-[16px] font-semibold">{C.avgOf[kind]}</span>
            <ChangePill delta={delta} same={C.same} />
          </span>
          <span className="text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{sub}</span>
        </span>
      </span>
      {children}
    </section>
  );
}

const ymd = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (t: Date) => t.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => { const t = ymd(day); t.setUTCDate(t.getUTCDate() + n); return iso(t); };

type DayState = "used" | "empty" | "future" | "blank";

/**
 * Days used (variant A): "4/4" over "days used", then one dot per school day, filled where she used NIETE, an empty ring
 * where she did not, dashed for a day still ahead. This week: Mon–Fri in a row. This month: a Mon–Fri calendar of the
 * month (days outside it blank). Today: one dot. Under the dots, how many of those days each instrument was used on
 * (`perFeature`), and with `to` the tile opens her days, one row per day with what she used (bd-dgfkgs.4).
 */
export function DaysUsed({ period, today, from, buckets, used, withUse, schoolDays, perFeature, to, state }: {
  period: PeriodKey; today: string; from: string; buckets: readonly Bucket[]; used: readonly string[]; withUse: number | null; schoolDays: number | null;
  perFeature?: FeatureCounts; to?: string; state?: unknown;
}) {
  const C = useCopy(SCHOOL_CARD);
  const on = new Set(used);
  const stateOf = (day: string, monthOf?: string): DayState => {
    if (monthOf && day.slice(0, 7) !== monthOf) return "blank";
    if (day > today) return "future";
    return on.has(day) ? "used" : "empty";
  };
  const dot = (state: DayState, key: string, size: number) => (
    <span key={key} data-day={state} aria-hidden="true" className="flex items-center justify-center" style={{ width: size, height: size }}>
      {state === "blank" ? null : (
        <span className={`block rounded-full ${state === "used" ? "bg-[#33374a]"
          : state === "future" ? "border-[1.5px] border-dashed border-[#d1d5db]" : "border-[1.5px] border-[#d1d5db] bg-white"}`}
          style={{ width: size - 2, height: size - 2 }} />
      )}
    </span>
  );
  const head = (
    <>
      <b dir="ltr" className="self-start text-[32px] font-bold tabular-nums" style={{ lineHeight: 1.1 }}>{`${withUse ?? C.dash}/${schoolDays ?? C.dash}`}</b>
      <span className="text-[14px] font-semibold leading-[1.25] text-[#4b5563] rtl:leading-[1.8]">{C.daysUsed}</span>
    </>
  );
  let body: ReactNode;
  if (period === "month") {
    const month = from.slice(0, 7);
    body = (
      <div dir="ltr" className="mt-1.5 grid grid-cols-5 justify-items-center gap-y-1" style={{ direction: "ltr" }}>
        {[1, 2, 3, 4, 5].map((wd) => <span key={`h${wd}`} aria-hidden="true" className="text-[10.5px] font-semibold text-[#9ca3af]">{C.dayInitials[wd]}</span>)}
        {buckets.flatMap((b) => [0, 1, 2, 3, 4].map((k) => { const day = addDays(b.date, k); return dot(stateOf(day, month), day, 22); }))}
      </div>
    );
  } else {
    const days = period === "week" ? buckets.map((b) => b.date) : [today];
    body = (
      <div dir="ltr" className="mt-2 flex gap-1.5" style={{ direction: "ltr" }}>
        {days.map((day) => (
          <span key={day} className="flex flex-col items-center gap-1">
            {dot(stateOf(day), day, 26)}
            <span aria-hidden="true" className="text-[10.5px] font-semibold text-[#9ca3af]">{C.dayInitials[ymd(day).getUTCDay()]}</span>
          </span>
        ))}
      </div>
    );
  }
  const inner = (
    <>
      {head}
      {body}
      {perFeature ? <span className="mt-1.5 pe-[22px]"><CountsRow counts={perFeature} /></span> : null}
      {to ? <ChevronRight className="absolute bottom-3 end-2.5 h-[22px] w-[22px] text-[#9ca3af] rtl:rotate-180" aria-hidden="true" /> : null}
    </>
  );
  const label = `${withUse ?? C.dash}/${schoolDays ?? C.dash} ${C.daysUsed}`;
  const cls = "relative flex min-h-[104px] min-w-0 flex-col gap-1 rounded-2xl bg-[#e9ebef] px-3.5 pb-3 pt-3.5";
  return to
    ? <Link to={to} state={state} data-testid="t-days" aria-label={label} className={`${cls} ${TAP}`}>{inner}</Link>
    : <div role="group" data-testid="t-days" aria-label={label} className={cls}>{inner}</div>;
}

/**
 * Her detailed graph: one point per scored report, placed by its day across the period, its score on it, the period's
 * average dashed with "Avg 61%" at the end; the dates under the points (an older one hides when it would touch the
 * next). Each point opens its report (a 40 px target).
 */
export function DetailChart({ kind, points, avg, from, to, linkOf, dateLabel }: {
  kind: ScoreKind; points: readonly { id: string; date: string; score: number }[]; avg: number | null; from: string; to: string;
  linkOf: (id: string) => string; dateLabel: (iso: string) => string;
}) {
  const C = useCopy(SCHOOL_CARD);
  const navigate = useNavigate();
  const colour = kindColour(kind);
  const W = 326; const H = 168; const L = 34; const R = 50; const T = 22; const B = 132; const PAD = 16;
  const t0 = ymd(from).getTime(); const t1 = Math.max(t0, ymd(to).getTime());
  const X = (d: string) => (t1 === t0 ? (L + W - R) / 2 : L + PAD + ((ymd(d).getTime() - t0) / (t1 - t0)) * (W - L - R - 2 * PAD));
  const vals = points.map((p) => p.score);
  const lo = Math.min(30, Math.floor((Math.min(...vals) - 6) / 10) * 10);
  const hi = Math.max(90, Math.ceil((Math.max(...vals) + 6) / 10) * 10);
  const Y = (v: number) => B - ((v - lo) / (hi - lo)) * (B - T);
  const ticks = [lo, Math.round(lo + (hi - lo) / 3), Math.round(lo + (2 * (hi - lo)) / 3), hi];
  const days = [...new Set(points.map((p) => p.date.slice(0, 10)))].sort();
  const shown = days.length ? [days[days.length - 1]] : [];
  for (let i = days.length - 2; i >= 0; i -= 1) if (X(shown[0]) - X(days[i]) >= 48) shown.unshift(days[i]);
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <figure dir="ltr" data-testid="detail-chart" className="m-0" style={{ direction: "ltr" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${C.avgOf[kind]} ${C.pct(avg)}`} className="block overflow-visible">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R + 10} y1={Y(v)} y2={Y(v)} stroke="#dfe2e8" />
            <text x={L - 6} y={Y(v) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
          </g>
        ))}
        {avg != null && (
          <g data-avg={Math.round(avg)}>
            <line x1={L} x2={W - R + 10} y1={Y(avg)} y2={Y(avg)} stroke={colour} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={W - R + 14} y={Y(avg) - 2} fontSize={10.5} fontWeight={700} fill={colour}>{C.avgLine(Math.round(avg)).split(" ")[0]}</text>
            <text x={W - R + 14} y={Y(avg) + 10} fontSize={10.5} fontWeight={700} fill={colour}>{`${Math.round(avg)}%`}</text>
          </g>
        )}
        {sorted.length > 1 && <polyline fill="none" stroke={colour} strokeWidth={2.5} strokeLinejoin="round" points={sorted.map((p) => `${X(p.date)},${Y(p.score)}`).join(" ")} />}
        {sorted.map((p) => (
          <g key={p.id} data-point={shapeOf(kind)} role="link" tabIndex={0} aria-label={`${kind === "dc" ? C.aiScoreN(Math.round(p.score)) : C.coachScoreN(Math.round(p.score))}, ${dateLabel(p.date)}`}
            onClick={() => navigate(linkOf(p.id))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(linkOf(p.id)); } }}
            style={{ cursor: "pointer", outline: "none" }}>
            <circle cx={X(p.date)} cy={Y(p.score)} r={20} fill="transparent" />
            <Mark x={X(p.date)} y={Y(p.score)} r={7.5} kind={kind} colour={colour} />
            <text x={X(p.date)} y={Y(p.score) - 13} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={colour}>{Math.round(p.score)}</text>
          </g>
        ))}
        {shown.map((d) => <text key={d} x={X(d)} y={H - 6} textAnchor="middle" fontSize={11} fill="#6b7280">{dateLabel(d)}</text>)}
      </svg>
      <figcaption className="sr-only">{avg != null ? C.avgLine(Math.round(avg)) : ""}</figcaption>
    </figure>
  );
}

/** A practice's average as a segmented bar: one segment per point of the scale, filled up to the average. */
function Segments({ avg, max, colour }: { avg: number; max: number; colour: string }) {
  const n = Math.max(1, Math.min(10, Math.round(max)));
  return (
    <span dir="ltr" aria-hidden="true" className="flex gap-1" style={{ direction: "ltr" }}>
      {Array.from({ length: n }, (_, i) => {
        const fill = Math.max(0, Math.min(1, avg - i));
        return (
          <span key={i} data-seg className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#e5e7eb]">
            <span className="absolute inset-y-0 start-0 block rounded-full" style={{ width: `${fill * 100}%`, background: colour }} />
          </span>
        );
      })}
    </span>
  );
}

const Value = ({ v, max }: { v: number; max: number }) => (
  <span dir="ltr" className="shrink-0 whitespace-nowrap tabular-nums">
    <b className="text-[17px] font-bold">{v.toFixed(1)}</b><span className="text-[12.5px] font-semibold text-[#9ca3af]">/{max}</span>
  </span>
);

/**
 * One section of "Average by practice": its letter, its name, its average out of the scale (the mean of its practices),
 * a note when only some of her reports scored it (B: the others had no lesson plan). It starts CLOSED (operator, 30 Oct,
 * bd-dgfkgs.2: open, the page was long and text-heavy): the head is a button, and tapping it shows every practice the
 * reports scored with its average and a segmented bar. Lesson Plan Fidelity (B) is the plan steps instead (bd-dgfkgs.3):
 * the share of plan steps followed, and when open each of the five lesson steps with how many of its plan steps were
 * done. A section no report scored has nothing to open: a flat head that says "Not scored" and why (B: no plan linked).
 */
export function PracticeSection({ section, reports, kind }: {
  section: TeacherScoresData["sections"][number]; reports: number; kind: ScoreKind;
}) {
  const C = useCopy(SCHOOL_CARD);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const colour = kindColour(kind);
  const max = section.indicators[0]?.scaleMax ?? null;
  const plan = section.code === "B" ? section.plan ?? null : undefined;
  const scored = plan !== undefined ? plan != null : section.avg != null && max != null;
  const note = scored
    ? (section.code === "B" && section.scoredIn < reports ? C.scoredIn(section.scoredIn, reports) : null)
    : (section.code === "B" ? C.noLpLinked : null);
  const head = (
    <>
      <span dir="ltr" aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#33374a] text-[14px] font-extrabold text-white">{section.code}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-start">
        <b dir="auto" className="text-[17px] font-semibold leading-[1.3] rtl:leading-[1.8]">{section.name}</b>
        {note ? <small className="text-[12.5px] font-semibold leading-[1.35] text-[#6b7280] rtl:leading-[1.8]">{note}</small> : null}
      </span>
      {!scored ? <StatusChip text={C.notScored} tone="info" />
        : plan ? <span dir="ltr" className="shrink-0 whitespace-nowrap tabular-nums"><b className="text-[17px] font-bold">{C.pct(plan.pct)}</b></span>
          : <Value v={section.avg as number} max={max as number} />}
    </>
  );
  const HEAD = "flex min-h-[64px] w-full items-center gap-3 bg-[#f9fafb] px-3.5 py-2.5";
  return (
    <section data-testid="practice-section" data-code={section.code} className={`overflow-hidden ${CARD}`}>
      {scored
        ? (
          <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} className={`${HEAD} ${TAP}`}>
            {head}
            <ChevronDown className={`h-[22px] w-[22px] shrink-0 text-[#6b7280] motion-safe:transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        )
        : <div className={HEAD}>{head}</div>}
      {scored && open && plan && <div id={bodyId}>{
        plan.steps.map((s) => {
          const judged = s.done + s.partly + s.skipped;
          const tone = s.done === judged ? "done" : s.done === 0 && s.partly === 0 ? "skipped" : "partly";
          return (
            <div key={s.step} data-testid="plan-step" data-tone={tone} className="flex min-h-[52px] items-center gap-3 border-t border-[#f0f1f3] px-3.5 py-2 text-[15px]">
              <span dir="auto" className="min-w-0 flex-1 font-semibold leading-[1.35] rtl:leading-[1.8]">{C.stepNames[s.step - 1] ?? C.dash}</span>
              <span className={`inline-flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold ${tone === "done" ? "bg-[#eaf6ef] text-[#2f7a52]" : "bg-[#f3f4f6] text-[#374151]"}`}>
                {C.stepsDone(s.done, judged)}
              </span>
            </div>
          );
        })
      }</div>}
      {scored && open && !plan && <div id={bodyId}>{
        section.indicators.map((p) => (
          <div key={p.id} data-testid="practice-row" className="flex flex-col gap-2 border-t border-[#f0f1f3] px-3.5 py-2.5">
            <span className="flex items-start gap-2">
              <span dir="ltr" className="mt-0.5 shrink-0 text-[12.5px] font-semibold text-[#9ca3af]">{p.id}</span>
              <span dir="auto" className="min-w-0 flex-1 text-[15px] font-semibold leading-[1.35] rtl:leading-[1.8]">{p.name}</span>
              <Value v={p.avg} max={p.scaleMax} />
            </span>
            <Segments avg={p.avg} max={p.scaleMax} colour={colour} />
          </div>
        ))
      }</div>}
    </section>
  );
}

/**
 * One of her reports: the D6.5 grade·subject tile, the title (the report's topic or lesson label; else "<short subject>
 * lesson"), the day (and, for a coach observation, its coach), the score chip ("Field form" for a field-form visit, none
 * for one not reviewed yet). It opens the coach's view of that report.
 */
export function ReportRow({ report, kind, today, lang, first, to }: {
  report: TeacherScoresData["reports"][number]; kind: ScoreKind; today: string | undefined; lang: Lang; first: boolean; to: string;
}) {
  const C = useCopy(SCHOOL_CARD);
  const title = report.title || C.lessonOf(report.subject ? subjectShort(report.subject, lang) : "");
  const Glyph = kind === "dc" ? Smartphone : Users;
  const day = dayLabel(report.date, today, C);
  const fieldForm = report.form === "observe2";
  const chip = fieldForm ? C.fieldForm
    : report.score == null ? null
      : kind === "dc" ? C.aiScoreN(Math.round(report.score)) : C.coachScoreN(Math.round(report.score));
  return (
    <Link to={to} data-testid="report-row" data-id={report.id}
      className={`flex min-h-[76px] items-stretch gap-3 bg-white pe-3.5 text-[#1d2025] ${TAP} ${first ? "" : "border-t border-[#f0f1f3]"}`}>
      <GradeSubjectLead grade={report.grade} subject={report.subject ?? ""} />
      <span className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
        <span dir="auto" className="line-clamp-2 text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]"><bdi>{title}</bdi></span>
        <span className="flex items-start gap-[5px] text-[13px] font-semibold leading-[1.35] text-[#6b7280] rtl:leading-[1.8]">
          <Glyph className="mt-px h-[15px] w-[15px] shrink-0 rtl:mt-[5px]" strokeWidth={2.2} style={{ color: kindColour(kind) }} aria-hidden="true" />
          <span>{day}{kind === "coach" && report.coachName ? <> · <bdi>{report.coachName}</bdi></> : null}</span>
        </span>
        {chip && <span className="mt-0.5 flex"><StatusChip text={chip} tone={fieldForm ? "info" : "score"} /></span>}
      </span>
      <ChevronRight className="h-[22px] w-[22px] shrink-0 self-center text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
    </Link>
  );
}
