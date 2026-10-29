import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ChevronRight, FileCheck, GraduationCap, Smartphone, Star } from "lucide-react";
import { ChoiceChips } from "../../teacher/ui";
import { FeatureArt } from "../../teacher/icons/FeatureArt";
import { FEATURE_HUE, type AnyFeature } from "../../teacher/icons/features";
import { useCopy } from "../../teacher/i18n";
import { SCHOOL_CARD, type SchoolCardCopy } from "./copy";
import { PERIODS, usePeriod } from "./period";
import type { CardFeature, FeatureCounts, ItemsFeature, PeriodKey } from "./types";

/**
 * The School card's pieces, drawn from the live kit's values (the mockups copied them from the app's own DOM): the
 * period chips are the kit's ChoiceChips, the art is the kit's FeatureArt, the colours are FEATURE_HUE (a feature's colour
 * only ever marks that feature). Bars, grids and charts always read LEFT TO RIGHT, in Urdu too (decision of 9 Oct:
 * "Charts stay left to right in Urdu"); only their labels are Urdu.
 */

/** Which feature art and colour each count belongs to (dc: Digital Coaching; coach: Coach observations). */
export const FEATURE_OF: Record<ItemsFeature | "dc" | "coach", AnyFeature> = { lp: "lessons", dc: "coaching", training: "training", papers: "assessment", coach: "observations" };
export const CARD_FEATURES: readonly CardFeature[] = ["lp", "dc", "training", "papers"];
/** The School card's count tiles, after the Digital Coaching and Coach observations score tiles. */
export const COUNT_FEATURES: readonly CardFeature[] = ["lp", "papers", "training"];

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

/** "26 Oct" under a chart. */
export const chartDate = (C: SchoolCardCopy) => (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return C.dayMonth(d, C.months[m - 1]);
};

/** A quoted line from a report, in the report's own words (data, so its direction follows its text). */
export function Quote({ children }: { children: ReactNode }) {
  return <span dir="auto" className="text-[15px] leading-[1.45] text-[#1d2025] rtl:leading-[1.9]">“{children}”</span>;
}
