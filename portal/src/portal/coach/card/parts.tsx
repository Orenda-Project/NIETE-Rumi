import type { KeyboardEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, ChevronRight, FileCheck, GraduationCap, Smartphone, Star, Users } from "lucide-react";
import { ChoiceChips, GradeSubjectLead, StatusChip } from "../../teacher/ui";
import { FOCUS, radioKeyDown } from "../../teacher/ui/styles";
import { subjectShort } from "../../teacher/ui/subjects";
import { FeatureArt } from "../../teacher/icons/FeatureArt";
import { FEATURE_HUE, type AnyFeature } from "../../teacher/icons/features";
import { useCopy, type Lang } from "../../teacher/i18n";
import { SCHOOL_CARD, type SchoolCardCopy } from "./copy";
import { PERIODS, dayLabel, usePeriod } from "./period";
import type { CardFeature, ChartPoint, CoachingItem, CoachingSummary, FeatureCounts, ItemsFeature, PeriodKey, SectionScores } from "./types";

/**
 * The School card's pieces, drawn from the live kit's values (the mockups copied them from the app's own DOM): the
 * period chips are the kit's ChoiceChips, the art is the kit's FeatureArt, the colours are FEATURE_HUE (a feature's colour
 * only ever marks that feature). Bars, grids and charts always read LEFT TO RIGHT, in Urdu too (decision of 9 Oct:
 * "Charts stay left to right in Urdu"); only their labels are Urdu.
 */

/** Which feature art and colour each count belongs to (dc: Digital Coaching; coach: a coach's visits). */
export const FEATURE_OF: Record<ItemsFeature | "dc" | "coach", AnyFeature> = { lp: "lessons", dc: "coaching", training: "training", papers: "assessment", coach: "observations" };
export const CARD_FEATURES: readonly CardFeature[] = ["lp", "dc", "training", "papers"];

const CARD = "rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const TAP = "transition-colors hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]";

/** Today · This week · This month (the kit's ChoiceChips, the picked one indigo). */
export function PeriodChips() {
  const C = useCopy(SCHOOL_CARD);
  const [period, setPeriod] = usePeriod();
  return (
    <ChoiceChips label={C.period} hideLabel value={period} onChange={(k) => setPeriod(k as PeriodKey)}
      options={PERIODS.map((k) => ({ key: k, label: C.periods[k] }))} />
  );
}

/**
 * One bar per school day (This week) or per week (This month): the count above, the day and its date below. A day
 * still ahead is a dashed slot with no count; a 0 is a thin grey line.
 */
export function Bars({ values, labels, colour, future = [], mini = false, testId }: {
  values: readonly (number | null)[]; labels: readonly [string, string][]; colour: string; future?: readonly boolean[]; mini?: boolean; testId?: string;
}) {
  const h = mini ? 24 : 54;
  const hi = Math.max(1, ...values.map((v) => (typeof v === "number" ? v : 0)));
  return (
    <div dir="ltr" data-testid={testId} aria-hidden="true" className={`flex items-end ${mini ? "gap-1" : "gap-2"}`} style={{ direction: "ltr" }}>
      {values.map((v, i) => {
        const ahead = !!future[i];
        const [a, b] = labels[i] ?? ["", ""];
        return (
          <div key={i} data-bar={ahead ? "future" : v ? "count" : "zero"} className="flex min-w-0 flex-1 flex-col items-center gap-[3px]">
            <span className={`font-bold leading-[1.1] tabular-nums text-[#1d2025] ${mini ? "text-[10px]" : "text-[12.5px]"}`} style={{ lineHeight: 1.15 }}>{ahead || v == null ? " " : v}</span>
            {ahead
              ? <span className="block h-2.5 w-full rounded-t-[5px] border-[1.5px] border-b-0 border-dashed border-[#d1d5db]" />
              : !v
                ? <span className="block h-[3px] w-full rounded-sm bg-[#e5e7eb]" />
                : <span className="block w-full rounded-t-[5px]" style={{ height: Math.max(4, Math.round((h * v) / hi)), background: colour }} />}
            <span className={`whitespace-nowrap text-center font-semibold leading-[1.2] text-[#6b7280] ${mini ? "text-[9.5px]" : "text-[11.5px]"}`}>
              {a}
              {b && !mini ? <small className="block text-[10px] font-medium text-[#9ca3af]">{b}</small> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const fmt = (n: number | null | undefined, dash: string) => (n == null ? dash : n.toLocaleString("en-US"));

/** The School card's full-width feature tile: art, the total and its word, small lines, the bars. The whole tile opens its grid. */
export function ActivityTile({ feature, total, label, lines, bars, to, state }: {
  feature: CardFeature; total: number | null; label: string; lines: readonly string[]; bars?: ReactNode; to: string; state?: unknown;
}) {
  const C = useCopy(SCHOOL_CARD);
  const art = FEATURE_OF[feature];
  const hue = FEATURE_HUE[art];
  return (
    <Link to={to} state={state} data-testid={`tile-${feature}`} aria-label={`${fmt(total, C.dash)} ${label}${lines.length ? `, ${lines.join(", ")}` : ""}`}
      className={`flex flex-col gap-2.5 rounded-[20px] border border-[#e5e7eb] bg-white p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${TAP}`}>
      <span className="flex items-center gap-3">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px]" style={{ background: hue.bg }}>
          <FeatureArt feature={art} size={36} motion={false} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="flex flex-wrap items-baseline gap-2">
            <b dir="ltr" data-testid="tile-total" className="text-[34px] font-bold tabular-nums" style={{ color: hue.fg, lineHeight: 1.05 }}>{fmt(total, C.dash)}</b>
            <span className="text-[16px] font-semibold text-[#1d2025]">{label}</span>
          </span>
          {lines.map((l) => <span key={l} className="text-[13px] font-semibold text-[#6b7280]">{l}</span>)}
        </span>
        <ChevronRight className="mt-1.5 h-[22px] w-[22px] shrink-0 self-start text-[#9ca3af] rtl:rotate-180" aria-hidden="true" />
      </span>
      {bars}
    </Link>
  );
}

const GLYPH: Record<CardFeature, typeof BookOpen> = { lp: BookOpen, dc: Smartphone, training: GraduationCap, papers: FileCheck };

/** A teacher's four small counts on her row: the feature's colour on the glyph only; a 0 is grey. */
export function CountsRow({ counts }: { counts: FeatureCounts }) {
  const C = useCopy(SCHOOL_CARD);
  return (
    <span dir="ltr" className="flex items-center gap-2.5 text-[13px] font-semibold tabular-nums text-[#374151]" style={{ direction: "ltr" }}>
      <span className="sr-only">{C.countsSpoken(counts.lp ?? 0, counts.dc ?? 0, counts.training ?? 0, counts.papers ?? 0)}</span>
      {CARD_FEATURES.map((f) => {
        const Glyph = GLYPH[f];
        const n = counts[f] ?? 0;
        return (
          <span key={f} data-count={f} aria-hidden="true" className={`inline-flex items-center gap-[3px] ${n ? "" : "text-[#b6bac2]"}`}>
            <Glyph className="h-[15px] w-[15px]" strokeWidth={2.2} style={{ color: n ? FEATURE_HUE[FEATURE_OF[f]].fg : "#c4c8cf" }} />
            {n}
          </span>
        );
      })}
    </span>
  );
}

/** ★ Top contributor (indigo, the frame's colour: a recognition, not a feature). */
export function StarChip({ text }: { text: string }) {
  return (
    <span data-testid="top-contributor" className="inline-flex h-6 items-center gap-1 self-start whitespace-nowrap rounded-full bg-[#e8e9f0] px-[9px] text-[12px] font-bold text-[#33374a] rtl:h-7">
      <Star className="h-[13px] w-[13px] fill-[#33374a] text-[#33374a]" aria-hidden="true" />{text}
    </span>
  );
}

/** The change pill (KpiTiles' look): ▲ green, ▼ amber, ● Same. */
export function ChangePill({ delta, same }: { delta: number | null | undefined; same: string }) {
  if (delta == null || Number.isNaN(delta)) return null;
  const d = Math.round(delta);
  const tone = d > 0 ? "bg-[#eaf6ef] text-[#2f7a52]" : d < 0 ? "bg-[#fef3c7] text-[#b45309]" : "bg-[#f3f4f6] text-[#374151]";
  return (
    <span dir="ltr" data-delta={d} className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-bold tabular-nums ${tone}`}>
      <span aria-hidden="true" className="text-[10px]">{d > 0 ? "▲" : d < 0 ? "▼" : "●"}</span>{d === 0 ? same : Math.abs(d)}
    </span>
  );
}

/** A few scores as a small line (indigo, the Coach score's colour), oldest on the left. */
export function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 1) return <span className="w-16" />;
  const w = 64; const h = 26;
  const lo = Math.min(...values) - 4; const hi = Math.max(...values) + 4;
  const pts = values.map((v, i) => [values.length === 1 ? w / 2 : 5 + (i * (w - 10)) / (values.length - 1), h - 4 - ((v - lo) / Math.max(1, hi - lo)) * (h - 8)]);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ direction: "ltr" }}>
      <polyline fill="none" stroke="#33374a" strokeWidth={2} strokeLinejoin="round" points={pts.map((p) => p.join(",")).join(" ")} />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.4 : 2.4} fill="#33374a" />)}
    </svg>
  );
}

/**
 * A number tile on the Teacher page (KpiTiles' white tile, the feature's art in the corner). `to` makes it a link with a
 * chevron (it opens her list); `flat` is information only: grey, no edge, no chevron (the AI score, the days).
 */
export function NumTile({ value, label, feature, sub, extra, bars, to, state, flat = false, testId }: {
  value: ReactNode; label: string; feature?: AnyFeature; sub?: string; extra?: ReactNode; bars?: ReactNode; to?: string; state?: unknown; flat?: boolean; testId?: string;
}) {
  const hue = feature ? FEATURE_HUE[feature] : null;
  const body = (
    <>
      {hue && feature ? (
        <span className="absolute end-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-[11px]" style={{ background: hue.bg }}>
          <FeatureArt feature={feature} size={28} motion={false} />
        </span>
      ) : null}
      <b dir="ltr" className="self-start whitespace-nowrap text-[32px] font-bold tabular-nums" style={{ lineHeight: 1.1 }}>{value}</b>
      <span className={`text-[14px] font-semibold leading-[1.25] text-[#4b5563] rtl:leading-[1.8] ${hue ? "pe-9" : ""}`}>{label}</span>
      {extra ? <span className="self-start">{extra}</span> : null}
      {sub ? <span className="text-[12px] font-semibold text-[#6b7280]">{sub}</span> : null}
      {bars ? <div className="mt-1.5 pe-[22px]">{bars}</div> : null}
      {to ? <ChevronRight className="absolute bottom-3 end-2.5 h-[22px] w-[22px] text-[#9ca3af] rtl:rotate-180" aria-hidden="true" /> : null}
    </>
  );
  const cls = `relative flex min-h-[104px] min-w-0 flex-col gap-1 rounded-2xl px-3.5 pb-3 pt-3.5 ${flat ? "bg-[#e9ebef]" : `${CARD}`}`;
  return to
    ? <Link to={to} state={state} data-testid={testId} className={`${cls} ${TAP}`}>{body}</Link>
    : <div role="group" data-testid={testId} className={cls}>{body}</div>;
}

/**
 * One feature by teacher: a row per teacher, a column per bucket, a count per cell (the feature's tint), a dot for 0,
 * dashed for a day still ahead, the row's total, and the School row of bucket totals. Rows are sorted by total, then
 * name; teachers with nothing stay in, grey, at the bottom. Each row is a link to her Teacher page.
 */
export function TeacherGrid({ rows, school, total, columns, future, feature, linkOf, schoolWord, totalWord }: {
  rows: readonly { key: string; name: string; cells: readonly (number | null)[]; total: number }[];
  school: readonly (number | null)[]; total: number; columns: readonly [string, string][]; future: readonly boolean[];
  feature: CardFeature; linkOf: (key: string) => string | null; schoolWord: string; totalWord: string;
}) {
  const hue = FEATURE_HUE[FEATURE_OF[feature]];
  const sorted = [...rows].sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
  const template = `minmax(0,1fr) ${columns.map(() => "30px").join(" ")} 34px 16px`;
  const cell = (v: number | null, i: number) => {
    if (future[i]) return <span key={i} data-cell="future" className="h-8 rounded-lg border-[1.5px] border-dashed border-[#e5e7eb]" />;
    if (v && v > 0) return <span key={i} data-cell="count" className="flex h-8 items-center justify-center rounded-lg text-[13px] font-bold" style={{ background: hue.bg, color: hue.fg }}>{v}</span>;
    return <span key={i} data-cell="zero" className="flex h-8 items-center justify-center rounded-lg bg-[#f3f4f6] text-[13px] font-bold text-[#9ca3af]">·</span>;
  };
  return (
    <div dir="ltr" data-testid="teacher-grid" className={`${CARD} overflow-x-auto px-1.5 pb-2.5 pt-2`} style={{ direction: "ltr" }}>
      <div className="grid items-end gap-[3px] pb-1" style={{ gridTemplateColumns: template }} aria-hidden="true">
        <span />
        {columns.map(([a, b], i) => (
          <span key={i} className={`whitespace-nowrap text-center text-[11.5px] font-semibold leading-tight ${future[i] ? "text-[#c4c8cf]" : "text-[#6b7280]"}`}>
            {a}<small className="block text-[10px] font-medium text-[#9ca3af]">{b}</small>
          </span>
        ))}
        <span className="text-center text-[11.5px] font-semibold text-[#6b7280]">{totalWord}</span>
        <span />
      </div>
      {sorted.map((r) => {
        const to = linkOf(r.key);
        const none = r.total === 0;
        const inner = (
          <>
            <span className={`truncate ps-1 text-start text-[13.5px] ${none ? "font-medium text-[#9ca3af]" : "font-semibold text-[#1d2025]"}`}>{r.name}</span>
            {columns.map((_, i) => cell(r.cells[i] ?? 0, i))}
            <span className={`text-center text-[13px] font-bold tabular-nums ${none ? "text-[#c4c8cf]" : "text-[#1d2025]"}`}>{r.total}</span>
            <ChevronRight className="h-4 w-4 text-[#c4c8cf]" aria-hidden="true" />
          </>
        );
        const cls = "grid min-h-[38px] items-center gap-[3px] rounded-lg";
        return to
          ? <Link key={r.key} to={to} data-testid="grid-row" data-none={none ? "1" : undefined} aria-label={`${r.name}, ${totalWord} ${r.total}`}
              className={`${cls} ${TAP}`} style={{ gridTemplateColumns: template }}>{inner}</Link>
          : <div key={r.key} data-testid="grid-row" data-none={none ? "1" : undefined} className={cls} style={{ gridTemplateColumns: template }}>{inner}</div>;
      })}
      <div data-testid="grid-school" className="mt-1 grid min-h-[34px] items-center gap-[3px] border-t border-[#e5e7eb] pt-1 text-[13px] font-bold tabular-nums text-[#374151]" style={{ gridTemplateColumns: template }}>
        <span className="ps-1 text-start">{schoolWord}</span>
        {columns.map((_, i) => <span key={i} className="text-center">{future[i] ? "" : (school[i] ?? 0)}</span>)}
        <span className="text-center">{total}</span>
        <span />
      </div>
    </div>
  );
}

/**
 * The Coaching score chart: the AI score of each DC report (orange dots) and the Coach score of each coach visit (indigo
 * squares on a dashed line), by date, left to right; the legend on one line above it. Information only by default (on the
 * Coaching card the whole card is the link); with `linkOf` each AI-score dot opens its DC report. The points sit inside the
 * axis and the date labels skip any that would touch their neighbour.
 */
export function ScoreChart({ points, dateLabel, label, aiWord, coachWord, linkOf, height = 150 }: {
  points: readonly ChartPoint[]; dateLabel: (iso: string) => string; label: string; aiWord: string; coachWord: string;
  linkOf?: (id: string) => string; height?: number;
}) {
  const navigate = useNavigate();
  const scored = points.filter((p): p is ChartPoint & { score: number } => typeof p.score === "number" && !!p.date)
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!scored.length) return null;
  const W = 326; const H = height; const L = 34; const R = 14; const T = 20; const B = H - 30; const PAD = 14;
  const time = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  const t0 = time(scored[0].date); const t1 = time(scored[scored.length - 1].date);
  const X = (d: string) => (t1 === t0 ? (L + W - R) / 2 : L + PAD + ((time(d) - t0) / (t1 - t0)) * (W - L - R - 2 * PAD));
  const vals = scored.map((p) => p.score);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 6) / 10) * 10);
  const hi = Math.min(100, Math.max(lo + 20, Math.ceil((Math.max(...vals) + 6) / 10) * 10));
  const Y = (v: number) => B - ((v - lo) / (hi - lo)) * (B - T);
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const ai = scored.filter((p) => p.kind === "dc");
  const co = scored.filter((p) => p.kind === "coach");
  const days = Array.from(new Set(scored.map((p) => p.date.slice(0, 10))));
  // The newest date always; an older one only where it does not touch the label to its right.
  const shownDays = [days[days.length - 1]];
  for (let i = days.length - 2; i >= 0; i -= 1) if (X(shownDays[0]) - X(days[i]) >= 48) shownDays.unshift(days[i]);
  const line = (ps: typeof scored) => ps.map((p) => `${X(p.date)},${Y(p.score)}`).join(" ");
  const open = linkOf ? (id: string) => navigate(linkOf(id)) : null;
  return (
    <figure className="m-0" data-testid="score-chart">
      <div className="mb-1 mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] font-semibold text-[#4b5563]">
        <span className="flex items-center gap-1.5"><i className="block h-[11px] w-[11px] rounded-full bg-[#c2410c]" aria-hidden="true" />{aiWord}</span>
        <span className="flex items-center gap-1.5"><i className="block h-[11px] w-[11px] rounded-[2px] bg-[#33374a]" aria-hidden="true" />{coachWord}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ direction: "ltr" }} className="block overflow-visible">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#eef0f3" />
            <text x={L - 6} y={Y(v) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
          </g>
        ))}
        {co.length > 1 && <polyline fill="none" stroke="#33374a" strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" points={line(co)} />}
        {ai.length > 1 && <polyline fill="none" stroke="#c2410c" strokeWidth={2} strokeLinejoin="round" points={line(ai)} />}
        {co.map((p) => (
          <g key={`c-${p.id}`} data-point="coach">
            <rect x={X(p.date) - 5.5} y={Y(p.score) - 5.5} width={11} height={11} rx={2} fill="#33374a" stroke="#fff" strokeWidth={1.5} />
            <text x={X(p.date)} y={Y(p.score) + 21} textAnchor="middle" fontSize={11} fontWeight={700} fill="#33374a">{Math.round(p.score)}</text>
          </g>
        ))}
        {ai.map((p) => {
          const dot = (
            <>
              {open && <circle cx={X(p.date)} cy={Y(p.score)} r={18} fill="transparent" />}
              <circle cx={X(p.date)} cy={Y(p.score)} r={6.5} fill="#c2410c" stroke="#fff" strokeWidth={2} />
              <text x={X(p.date)} y={Y(p.score) - 12} textAnchor="middle" fontSize={11} fontWeight={700} fill="#c2410c">{Math.round(p.score)}</text>
            </>
          );
          return open
            ? (
              <g key={`a-${p.id}`} data-point="dc" role="link" tabIndex={0} aria-label={`${aiWord} ${Math.round(p.score)}%, ${dateLabel(p.date)}`}
                onClick={() => open(p.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(p.id); } }}
                style={{ cursor: "pointer", outline: "none" }}>{dot}</g>
            )
            : <g key={`a-${p.id}`} data-point="dc">{dot}</g>;
        })}
        {shownDays.map((d) => <text key={d} x={X(d)} y={H - 6} textAnchor="middle" fontSize={10.5} fill="#6b7280">{dateLabel(d)}</text>)}
      </svg>
    </figure>
  );
}

/** "26 Oct" under the chart. */
export const chartDate = (C: SchoolCardCopy) => (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return C.dayMonth(d, C.months[m - 1]);
};

/**
 * The Observations summary's two lines (the same on the Teacher page's Observations card and at the top of the
 * Observations page): Digital Coaching with her count of DC observations and the AI score (its change on the period
 * before), then Coach observations with their count and the Coach score. A score that is not there is a dash, never 0.
 */
export function CoachingLines({ summary, flat = false }: { summary: CoachingSummary | null | undefined; flat?: boolean }) {
  const C = useCopy(SCHOOL_CARD);
  const divider = flat ? "border-[#d9dce3]" : "border-[#f0f1f3]";
  const delta = (s: { avg: number | null; prevAvg: number | null } | undefined) =>
    s && s.avg != null && s.prevAvg != null ? Math.round(s.avg) - Math.round(s.prevAvg) : null;
  const line = (kind: "dc" | "coach", name: string, sub: string, avg: number | null | undefined, word: string, d: number | null) => {
    const art = FEATURE_OF[kind];
    return (
      <span data-testid={`coaching-line-${kind}`} className={`flex min-h-[60px] items-center gap-3 ${kind === "coach" ? `border-t pt-2.5 ${divider}` : ""}`}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px]" style={{ background: FEATURE_HUE[art].bg }}>
          <FeatureArt feature={art} size={36} motion={false} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]">{name}</span>
          <span className="text-[13px] font-semibold leading-[1.35] text-[#6b7280] rtl:leading-[1.8]">{sub}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-[3px]">
          <b dir="ltr" className={`text-[28px] font-bold leading-[1.05] tabular-nums ${avg == null ? "text-[#9ca3af]" : "text-[#1d2025]"}`}>{C.pct(avg ?? null)}</b>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold text-[#4b5563]">
            <ChangePill delta={d} same={C.same} />
            {/* what a screen reader hears: "AI score 68%" */}
            <span aria-hidden="true">{word}</span>
            <span className="sr-only">{avg == null ? word : (kind === "dc" ? C.aiScoreN(Math.round(avg)) : C.coachScoreN(Math.round(avg)))}</span>
          </span>
        </span>
      </span>
    );
  };
  return (
    <>
      {line("dc", C.digitalCoaching, C.obsN(summary?.dc?.count ?? 0), summary?.dc?.avg, C.aiScore, delta(summary?.dc))}
      {line("coach", C.coachObsLine, C.obsN(summary?.coach?.count ?? 0), summary?.coach?.avg, C.coachScore, delta(summary?.coach))}
    </>
  );
}

/** The Observations list's filter: All · Digital Coaching · Coach observations, each with its count (the kit's ChoiceChips look). */
export type CoachingShow = "all" | "dc" | "coach";
export function KindChips({ value, counts, onChange }: { value: CoachingShow; counts: Record<CoachingShow, number>; onChange: (k: CoachingShow) => void }) {
  const C = useCopy(SCHOOL_CARD);
  const options: [CoachingShow, string][] = [["all", C.all], ["dc", C.digitalCoaching], ["coach", C.coachObsLine]];
  const keys = options.map(([k]) => k);
  const onKey = (e: KeyboardEvent<HTMLElement>) => radioKeyDown(e, keys, value, (k) => onChange(k as CoachingShow));
  return (
    <div role="radiogroup" aria-label={C.show} data-testid="coaching-filter" onKeyDown={onKey} className="flex flex-wrap items-center gap-x-2">
      {options.map(([k, label]) => {
        const on = k === value;
        return (
          <button key={k} type="button" role="radio" aria-checked={on} aria-label={`${label} ${counts[k]}`} data-radio-key={k} tabIndex={on ? 0 : -1}
            onClick={() => onChange(k)} className={`flex min-h-[56px] items-center ${FOCUS}`}>
            <span className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[14px] font-semibold ${on ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#e5e7eb] bg-white text-[#4b5563]"}`}>
              {label}<em dir="ltr" className={`not-italic font-bold tabular-nums ${on ? "text-[#c9ccd8]" : "text-[#6b7280]"}`}>{counts[k]}</em>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const SECTIONS: readonly (keyof SectionScores)[] = ["B", "C", "D", "F"];

/** B 71 · C 63 · D 80 · F 80, left to right in Urdu too; a section the report did not score is "—" (the key says so). */
export function SectionStrip({ sections }: { sections: SectionScores }) {
  const C = useCopy(SCHOOL_CARD);
  return (
    <span dir="ltr" data-testid="row-sections" className="inline-flex gap-[7px] whitespace-nowrap text-[12px] font-bold tabular-nums text-[#1d2025]" style={{ direction: "ltr" }}>
      {SECTIONS.map((k) => {
        const v = sections?.[k];
        return (
          <span key={k} data-section={k} className={v == null ? "text-[#9ca3af]" : undefined}>
            <span className="me-0.5 font-semibold text-[#9ca3af]">{k}</span>{v == null ? C.dash : Math.round(v)}
            {v == null && <span className="sr-only"> {C.notScored}</span>}
          </span>
        );
      })}
    </span>
  );
}

/**
 * One row of the Observations list (design v8 A, "Row anatomy"). The D6.5 grade·subject tile (this is a list of
 * observations), the title (the server's: the report's topic or real lesson label; else "<short subject> lesson"), the meta
 * line (date · Digital Coaching, or date · Coach observation · her coach), the labelled score and the B C D F strip, then
 * the step she took away, quoted. A DC report opens its report (chevron); a coach observation is information only: its
 * report lives in Observe, which the coach app does not show. A field-form visit has the "Field form" chip and no strip;
 * one not reviewed yet has neither.
 */
export function CoachingRow({ item, today, lang, first, linkOf }: {
  item: CoachingItem; today: string | undefined; lang: Lang; first: boolean; linkOf: (id: string) => string;
}) {
  const C = useCopy(SCHOOL_CARD);
  const dc = item.kind === "dc";
  const title = item.title || C.lessonOf(item.subject ? subjectShort(item.subject, lang) : "");
  const day = dayLabel(item.date, today, C);
  const fieldForm = !dc && item.form === "observe2";
  const anyScore = SECTIONS.some((k) => item.sections?.[k] != null);
  const Glyph = dc ? Smartphone : Users;
  const chip = fieldForm ? C.fieldForm
    : item.score == null ? (dc ? `${C.aiScore} ${C.dash}` : null)
      : dc ? C.aiScoreN(Math.round(item.score)) : C.coachScoreN(Math.round(item.score));
  const body = (
    <>
      <GradeSubjectLead grade={item.grade} subject={item.subject ?? ""} />
      <span className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
        <span data-testid="row-title" dir="auto" className="line-clamp-2 text-[16px] font-semibold leading-[1.3] rtl:leading-[1.8]"><bdi>{title}</bdi></span>
        <span data-testid="row-meta" className="flex items-start gap-[5px] text-[13px] font-semibold leading-[1.35] text-[#6b7280] rtl:leading-[1.8]">
          <Glyph className="mt-px h-[15px] w-[15px] shrink-0 rtl:mt-[5px]" strokeWidth={2.2} style={{ color: FEATURE_HUE[FEATURE_OF[item.kind]].fg }} aria-hidden="true" />
          <span>{day} · {dc ? C.digitalCoaching : <>{C.coachObservation}{item.coachName ? <> · <bdi>{item.coachName}</bdi></> : null}</>}</span>
        </span>
        {(chip || anyScore) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {chip && <span data-testid="row-chip" className="contents"><StatusChip text={chip} tone={fieldForm ? "info" : "score"} /></span>}
            {anyScore && !fieldForm && <SectionStrip sections={item.sections} />}
          </span>
        )}
        {item.quote && (
          <span className="mt-[3px] flex flex-col gap-px">
            <b className="text-[12.5px] font-bold leading-[1.35] text-[#6b7280] rtl:leading-[1.8]">{dc ? C.nextStep : C.stepAgreed}</b>
            <span data-testid="row-quote" dir="auto" className="line-clamp-2 text-[14px] leading-[1.45] text-[#1d2025] rtl:leading-[1.9]">“{item.quote}”</span>
          </span>
        )}
      </span>
    </>
  );
  const cls = `flex min-h-[76px] items-stretch gap-3 pe-3.5 text-[#1d2025] ${first ? "" : "border-t border-[#f0f1f3]"}`;
  return dc
    ? (
      <Link to={linkOf(item.id)} data-testid="coaching-row" data-id={item.id} data-kind="dc" className={`${cls} bg-white ${TAP}`}>
        {body}
        <ChevronRight data-chevron className="h-[22px] w-[22px] shrink-0 self-center text-[#9ca3af] rtl:rotate-180" strokeWidth={2.4} aria-hidden="true" />
      </Link>
    )
    : <div role="group" data-testid="coaching-row" data-id={item.id} data-kind="coach" className={`${cls} bg-white`}>{body}</div>;
}

/** A quoted line from a report, in the report's own words (data, so its direction follows its text). */
export function Quote({ children }: { children: ReactNode }) {
  return <span dir="auto" className="text-[15px] leading-[1.45] text-[#1d2025] rtl:leading-[1.9]">“{children}”</span>;
}
