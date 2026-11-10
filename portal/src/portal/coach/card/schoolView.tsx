import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Star, Users } from "lucide-react";
import { FEATURE_HUE } from "../../teacher/icons/features";
import { useCopy } from "../../teacher/i18n";
import { SCHOOL_CARD } from "./copy";
import { PEOPLE } from "../people/copy";
import { useLevelNames, type TeachingLevel } from "../people/level";
import { EmptyRow } from "../people/rows";
import { SearchBox, SectionLabel } from "../ui";
import { CARD_FEATURES, FEATURE_OF, GLYPH } from "./parts";
import type { CardFeature, CardTeacher, CoachObsTeacher, Overview, PeriodKey, SchoolScores } from "./types";

/**
 * bd-17v39c.4.13 (queue #19) — Rifat's School view on the School card, as the operator approved it (mockups v3, 5 Nov):
 *   Overview      who used NIETE in the period and the same days before, then five boxes two to a row (Lesson plans ·
 *                 Training / Assessments · Digital Coaching / the Coach average across the full width). Each box opens
 *                 that feature's details page; the Activity tiles are gone from the card.
 *   TeacherTable  one row per teacher: her four counts under icon heads, Contribution % last, ★ on the top two; the top 8
 *                 and "Show all"; the teachers with nothing in the period always shown, grey, with 0s and 0% (decided 5 Nov).
 *   CoachObsTable a row per observed teacher: observations, a trend, the change in colour (green up, red down, "first"),
 *                 the latest score.
 *   DetailsTop    a details page's first card: the box's number and lines, then the tile's day bars.
 * Every number is the server's; one that did not load is "—", never 0. Tables follow the page's direction (Urdu right to
 * left, the teacher first, decided choice 5 A); digits stay Latin; the charts inside them stay left to right.
 */

const CARD = "rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";
const TAP = "transition-colors hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#f59e0b]";
const ROW_TAP = "transition-colors hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[#f59e0b]";
const GREY = "#6b7280";
const ZERO = "#b6bac2";

/** One decimal, always ("0.8", "1.0"); null is null. */
export const oneDecimal = (v: number | null | undefined): string | null => (v == null || !Number.isFinite(v) ? null : v.toFixed(1));
const num = (n: number | null | undefined, dash: string) => (n == null ? dash : n.toLocaleString("en-US"));

type BoxKind = "lp" | "training" | "papers" | "dc" | "coach";
const BOX_ART = { lp: FEATURE_OF.lp, training: FEATURE_OF.training, papers: FEATURE_OF.papers, dc: FEATURE_OF.dc, coach: FEATURE_OF.coach } as const;

/** A box of the overview: its glyph and name with a ›, its number big in its colour, then a white pill and a grey line. */
function Box({ kind, name, number, word, pill, line, to, wide = false }: {
  kind: BoxKind; name: string; number: string; word?: string; pill?: string | null; line?: string | null; to?: string; wide?: boolean;
}) {
  const hue = FEATURE_HUE[BOX_ART[kind]];
  const Glyph = kind === "coach" ? Users : GLYPH[kind as CardFeature];
  const big = (
    <b dir="ltr" data-testid="box-number" className="self-start text-[28px] font-bold leading-[1.1] tabular-nums" style={{ color: number === "—" ? "#9ca3af" : hue.fg }}>{number}</b>
  );
  const lines = (
    <>
      {word ? <span className="text-[13px] font-semibold leading-[1.3] text-[#1d2025] rtl:leading-[1.8]">{word}</span> : null}
      {pill ? <span className="self-start rounded-full bg-white px-2.5 py-[3px] text-[12.5px] font-bold leading-[1.3] text-[#1d2025] rtl:leading-[1.8]">{pill}</span> : null}
      {line ? <span className="text-[12px] font-semibold leading-[1.35] text-[#4b5563] rtl:leading-[1.8]">{line}</span> : null}
    </>
  );
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <Glyph className="h-[17px] w-[17px] shrink-0" strokeWidth={2.2} style={{ color: hue.fg }} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[14px] font-semibold leading-[1.25] text-[#1d2025] rtl:leading-[1.8]">{name}</span>
        {to ? <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#6b7280] rtl:rotate-180" aria-hidden="true" /> : null}
      </span>
      {wide
        ? <span className="flex items-center gap-3">{big}<span className="flex min-w-0 flex-col gap-0.5">{lines}</span></span>
        : <>{big}{lines}</>}
    </>
  );
  const label = [name, number, word, pill, line].filter(Boolean).join(", ");
  // bd-33wxxi.3 — no page behind it (a principal's My school): information, so flat — no link, no chevron, no tap look.
  if (!to) {
    return (
      <div data-testid={`box-${kind}`} aria-label={label}
        className={`flex min-h-[112px] min-w-0 flex-col gap-1 rounded-[18px] p-3 ${wide ? "col-span-2" : ""}`} style={{ background: hue.bg }}>{body}</div>
    );
  }
  return (
    <Link to={to} data-testid={`box-${kind}`} aria-label={label}
      className={`flex min-h-[112px] min-w-0 flex-col gap-1 rounded-[18px] p-3 ${TAP} ${wide ? "col-span-2" : ""}`} style={{ background: hue.bg }}>{body}</Link>
  );
}

/**
 * The overview card. `ov` absent (an older server, or not loaded): every number is "—". `link(kind)` is the box's page,
 * carrying the period and the level.
 */
export function OverviewCard({ ov, scores, period, link, countsOnly = false }: {
  ov: Overview | null | undefined;
  scores: Partial<Record<"dc" | "coach", Pick<SchoolScores, "count" | "makers"> & Partial<SchoolScores>>> | null | undefined;
  period: PeriodKey;
  /** Each box's page. Absent (a principal's My school: no page behind the boxes), the boxes are flat information. */
  link?: (kind: BoxKind) => string;
  /** bd-33wxxi.3 — a principal's My school (#55 Q1): the DC and Coach boxes show how many and by how many teachers, never an average. */
  countsOnly?: boolean;
}) {
  const C = useCopy(SCHOOL_CARD);
  const n = ov?.teachers ?? null;
  const rate = oneDecimal(ov?.lp.perTeacherDay);
  const rateBefore = oneDecimal(ov?.lp.prev.perTeacherDay);
  const pct = (v: number | null | undefined) => C.pct(v ?? null);
  const scoreLine = (s: (Pick<SchoolScores, "count" | "makers"> & Partial<SchoolScores>) | undefined) => {
    if (!s) return null;
    const before = s.prevAvg != null ? C.pctBefore[period](pct(s.prevAvg)) : null;
    return [C.obsN(s.count), before].filter(Boolean).join(" · ");
  };
  return (
    <section data-testid="overview" className={`${CARD} flex flex-col gap-1 p-4`}>
      {/* bd-17v39c.4.13.7 — not forced left to right: Urdu "14 میں سے 12" reads right to left like the rest */}
      <b data-testid="used-count" className="self-start text-[34px] font-bold leading-[1.1] tabular-nums text-[#1d2025]">
        {ov && n != null ? C.nOfM(ov.active.now, n) : C.dash}
      </b>
      <span className="text-[17px] font-semibold leading-[1.3] text-[#1d2025] rtl:leading-[1.8]">{C.usedNiete[period]}</span>
      {ov && n != null && <span className="text-[14px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{C.usedBefore[period](ov.active.prev, n)}</span>}
      {ov && ov.active.now === 0 && <span data-testid="no-use-yet" className="mt-1 text-[15px] leading-[1.4] text-[#1d2025] rtl:leading-[1.9]">{C.noUseYet[period]}</span>}
      {/* "· tap a box for details" only when the boxes open a page (not on a principal's My school, bd-33wxxi.3) */}
      {n != null && link && <span className="mt-2.5 text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{C.acrossTap[period](n)}</span>}
      <div data-testid="overview-boxes" className="mt-2 grid grid-cols-2 gap-2.5">
        <Box kind="lp" name={C.tiles.lp} number={num(ov?.lp.total, C.dash)} to={link?.("lp")}
          pill={rate ? C.perTeacherDay[period](rate) : null} line={rateBefore ? C.rateBefore[period](rateBefore) : null} />
        <Box kind="training" name={C.boxTraining} number={num(ov?.training.modules, C.dash)} to={link?.("training")}
          word={C.tileLabel.training(ov?.training.modules ?? 0)} pill={ov && n != null ? C.byN(ov.training.makers, n) : null} />
        <Box kind="papers" name={C.tiles.papers} number={num(ov?.papers.total, C.dash)} to={link?.("papers")}
          word={C.tileLabel.papers(ov?.papers.total ?? 0)} pill={ov && n != null ? C.byN(ov.papers.makers, n) : null} />
        {countsOnly ? (
          <>
            <Box kind="dc" name={C.digitalCoaching} number={num(scores?.dc?.count, C.dash)} to={link?.("dc")}
              word={C.tileLabel.dc(scores?.dc?.count ?? 0)} pill={scores?.dc && n != null ? C.byN(scores.dc.makers, n) : null} />
            <Box kind="coach" name={C.coachObsName} number={num(scores?.coach?.count, C.dash)} to={link?.("coach")}
              word={C.tileLabel.coach(scores?.coach?.count ?? 0)} pill={scores?.coach && n != null ? C.byN(scores.coach.makers, n) : null} wide />
          </>
        ) : (
          <>
            <Box kind="dc" name={C.digitalCoaching} number={pct(scores?.dc?.avg)} to={link?.("dc")} word={C.average} line={scoreLine(scores?.dc)} />
            <Box kind="coach" name={C.coachObsName} number={pct(scores?.coach?.avg)} to={link?.("coach")} word={C.coachAverage} line={scoreLine(scores?.coach)} wide />
          </>
        )}
      </div>
    </section>
  );
}

// ── the teacher table ────────────────────────────────────────────────────────

/** Teacher · four counts · Contribution. At 360 px the Contribution head breaks in two (a soft hyphen) and names cut. */
// bd-17v39c.4.13.7 (live check at 390/360): counts are at most two digits, so 22px columns and 4px gaps leave the names
// about 120px at 390 ("Mehwish Demo" whole) and about 105px at 360, where Contribution breaks in two.
const TABLE_COLS = "grid grid-cols-[minmax(0,1fr)_repeat(4,22px)_68px] max-[374px]:grid-cols-[minmax(0,1fr)_repeat(4,22px)_50px] items-center gap-x-1";
const SHOWN = 8;

function TableRow({ t, to, state, none }: { t: CardTeacher; to: string; state: unknown; none: boolean }) {
  const C = useCopy(SCHOOL_CARD);
  const P = useCopy(PEOPLE);
  const levelNames = useLevelNames();
  // bd-ewbzns.2 — her role and teaching levels: no room on a table row (mockups v3), so said with her name, and shown on
  // her page.
  const who = [t.isPrincipal ? P.rolePrincipal : "", levelNames(t.levels)].filter(Boolean).join(" · ");
  return (
    <Link to={to} state={state} data-testid={none ? "table-row-none" : "table-row"} data-none={none ? "1" : undefined}
      aria-label={`${t.name}${who ? `, ${who}` : ""}, ${C.countsSpoken(t.counts.lp ?? 0, t.counts.dc ?? 0, t.counts.training ?? 0, t.counts.papers ?? 0)}, ${C.contribution} ${none ? "0%" : C.pct(t.contributionPct)}`}
      className={`${TABLE_COLS} min-h-[56px] border-t border-[#f0f1f3] ${ROW_TAP}`}>
      <span className="flex min-w-0 items-center gap-1">
        {!none && t.star ? <Star data-star="1" className="h-3 w-3 shrink-0 fill-[#33374a] text-[#33374a]" aria-hidden="true" /> : null}
        <span dir="auto" className={`truncate text-[15px] leading-[1.3] ${none ? "font-medium text-[#9ca3af]" : "font-semibold text-[#1d2025]"}`}>{t.name}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#c4c8cf] rtl:rotate-180" aria-hidden="true" />
      </span>
      {CARD_FEATURES.map((f) => {
        const v = t.counts[f] ?? 0;
        return (
          <span key={f} data-count={f} aria-hidden="true" className="text-center text-[15px] font-bold tabular-nums" style={{ color: none ? ZERO : v ? "#1d2025" : ZERO }}>{v}</span>
        );
      })}
      <span data-testid="contribution" dir="ltr" aria-hidden="true" className="text-end text-[15px] font-bold tabular-nums" style={{ color: none ? ZERO : "#1d2025" }}>
        {none ? "0%" : C.pct(t.contributionPct)}
      </span>
    </Link>
  );
}

/**
 * The teacher table. `active` (total > 0) most first, the top 8 then "Show all"; `quiet` (nothing in the period) always
 * shown under the card's own words ("Nothing this week"), grey, 0s and 0%. `linkOf` opens her page.
 */
export function TeacherTable({ active, quiet, period, linkOf, state }: {
  active: CardTeacher[]; quiet: CardTeacher[]; period: PeriodKey; linkOf: (ext: string) => string; state: unknown;
}) {
  const C = useCopy(SCHOOL_CARD);
  const [all, setAll] = useState(false);
  const shown = all ? active : active.slice(0, SHOWN);
  return (
    <section data-testid="teacher-table" className={`${CARD} px-3.5 pb-1`}>
      <div data-testid="table-heads" className={`${TABLE_COLS} min-h-[44px] text-[12px] font-semibold text-[#6b7280]`}>
        <span>{C.teacherCol}</span>
        {CARD_FEATURES.map((f) => {
          const Glyph = GLYPH[f];
          return (
            <span key={f} data-head={f} className="flex justify-center">
              <Glyph className="h-[17px] w-[17px]" strokeWidth={2.2} style={{ color: FEATURE_HUE[FEATURE_OF[f]].fg }} aria-hidden="true" />
              <span className="sr-only">{C.featureName[f]}</span>
            </span>
          );
        })}
        <span className="text-end leading-[1.15] [hyphens:manual] rtl:leading-[1.7]">
          <span className="sr-only">{C.contribution}</span>
          {/* a soft hyphen: at 360 px the head breaks in two ("Contri-" / "bution") so the names keep their room */}
          <span aria-hidden="true">{C.contributionHead}</span>
        </span>
      </div>
      {shown.map((t) => <TableRow key={t.teacherExtId} t={t} to={linkOf(t.teacherExtId)} state={state} none={false} />)}
      {!all && active.length > SHOWN && (
        <button type="button" onClick={() => setAll(true)}
          className="flex min-h-[52px] w-full items-center border-t border-[#f0f1f3] text-start text-[15px] font-semibold text-[#33374a] underline decoration-[#c4c8cf] underline-offset-4">
          {C.showAll(active.length)}
        </button>
      )}
      {quiet.length > 0 && (
        <>
          <div data-testid="quiet-head" className="flex min-h-[44px] items-center gap-2 border-t border-[#e5e7eb] text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">
            <span>{C.nothing[period]}</span>
            <span className="inline-flex h-6 items-center rounded-full bg-[#e5e7eb] px-[9px] text-[12px] font-semibold text-[#374151]">{quiet.length}</span>
          </div>
          {quiet.map((t) => <TableRow key={t.teacherExtId} t={t} to={linkOf(t.teacherExtId)} state={state} none />)}
        </>
      )}
    </section>
  );
}

/** Search shows from this many teachers up (the School card's rule). */
const SEARCH_FROM = 10;

/**
 * bd-33wxxi.3 — the School view's Teachers section, ONE piece for the coach's School card and a principal's My school
 * (lifted out of SchoolCardPage, unchanged): the label and its tap hint, search from SEARCH_FROM teachers, the empty
 * rows, then the table (the active ones by total, the ones with nothing A to Z). `linkOf` is where a row opens.
 */
export function SchoolTeachers({ teachers, period, level, linkOf, state }: {
  teachers: CardTeacher[]; period: PeriodKey; level: TeachingLevel | null; linkOf: (ext: string) => string; state: unknown;
}) {
  const C = useCopy(SCHOOL_CARD);
  const P = useCopy(PEOPLE);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? teachers.filter((t) => t.name.toLowerCase().includes(q)) : teachers), [teachers, q]);
  const active = shown.filter((t) => t.total > 0)
    .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name));
  const none = shown.filter((t) => !(t.total > 0)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <SectionLabel>{C.teachers}</SectionLabel>
      <p className="m-0 mx-1 -mt-2 text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{C.tapTeacher}</p>
      {teachers.length > SEARCH_FROM && <SearchBox value={query} onChange={setQuery} placeholder={C.teacherName} />}
      {teachers.length === 0 && <EmptyRow icon={<span>·</span>} testId="no-teachers">{level ? P.noneAtLevel : C.noTeachers}</EmptyRow>}
      {teachers.length > 0 && shown.length === 0 && <EmptyRow icon={<span>·</span>} testId="no-match">{C.noMatch}</EmptyRow>}
      {shown.length > 0 && <TeacherTable key={`${period}|${level}|${q}`} active={active} quiet={none} period={period} linkOf={linkOf} state={state} />}
    </>
  );
}

// ── the coach observations table ─────────────────────────────────────────────

const OBS_COLS = "grid grid-cols-[minmax(0,1fr)_28px_52px_50px_42px] max-[374px]:grid-cols-[minmax(0,1fr)_26px_44px_46px_40px] items-center gap-x-1";
const TONE = { up: "#2f7a52", down: "#c8331f", same: GREY, first: "#c2410c", none: "#9ca3af" } as const;

/** The change over the period: green up, red down (operator's pick, 5 Nov), "first" when she has one score so far. */
function changeOf(r: CoachObsTeacher, first: string): { text: string; tone: keyof typeof TONE } {
  if (!r.points.length) return { text: "—", tone: "none" };
  if (r.points.length === 1 || r.change == null) return { text: first, tone: "first" };
  const d = Math.round(r.change);
  if (d > 0) return { text: `+${d}%`, tone: "up" };
  if (d < 0) return { text: `−${Math.abs(d)}%`, tone: "down" };
  return { text: "0%", tone: "same" };
}

/**
 * A teacher's Coach scores in the period, oldest first, as a tiny line at its own size (44x20): the coach's square marks
 * (Coach observations are squares everywhere), a line only when there are two or more. Left to right in Urdu too.
 */
function Trend({ values }: { values: readonly (number | null)[] }) {
  const pts = values.filter((v): v is number => typeof v === "number");
  const W = 44, H = 20, PAD = 4;
  const lo = Math.min(...pts) - 4, hi = Math.max(...pts) + 4;
  const X = (i: number) => (pts.length === 1 ? W / 2 : PAD + ((W - 2 * PAD) * i) / (pts.length - 1));
  const Y = (v: number) => H - PAD - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * PAD);
  const colour = FEATURE_HUE[FEATURE_OF.coach].fg;
  return (
    <svg data-testid="obs-trend" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" style={{ direction: "ltr" }} className="block overflow-visible">
      {pts.length > 1 && <polyline fill="none" stroke={colour} strokeWidth={1.8} strokeLinejoin="round" points={pts.map((v, i) => `${X(i)},${Y(v)}`).join(" ")} />}
      {pts.map((v, i) => <rect key={i} data-point="square" x={X(i) - 2.5} y={Y(v) - 2.5} width={5} height={5} rx={1} fill={colour} />)}
    </svg>
  );
}

export function CoachObsTable({ rows, linkOf, state }: { rows: CoachObsTeacher[]; linkOf: (ext: string) => string; state?: unknown }) {
  const C = useCopy(SCHOOL_CARD);
  return (
    <section data-testid="coach-obs-table" className={`${CARD} px-3.5 pb-1`}>
      <div data-testid="obs-heads" className={`${OBS_COLS} min-h-[44px] text-[12.5px] font-semibold text-[#6b7280] rtl:leading-[1.8]`}>
        <span>{C.teacherCol}</span>
        <span className="text-center">{C.obsCol}</span>
        <span className="text-center">{C.trendCol}</span>
        <span className="text-center">{C.changeCol}</span>
        <span className="text-end">{C.latestCol}</span>
      </div>
      {rows.map((r) => {
        const ch = changeOf(r, C.first);
        return (
          <Link key={r.teacherExtId} to={linkOf(r.teacherExtId)} state={state} data-testid="obs-row"
            className={`${OBS_COLS} min-h-[56px] border-t border-[#f0f1f3] ${ROW_TAP}`}>
            <span className="flex min-w-0 items-center gap-1">
              <span dir="auto" className="truncate text-[15px] font-semibold leading-[1.3] text-[#1d2025]">{r.name}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#c4c8cf] rtl:rotate-180" aria-hidden="true" />
            </span>
            <span data-testid="obs-count" className="text-center text-[15px] font-bold tabular-nums">{r.count}</span>
            <span className="flex min-w-0 justify-center">
              {r.points.length ? <Trend values={r.points.map((p) => p.score)} /> : <span className="text-[#9ca3af]">—</span>}
            </span>
            {/* bd-17v39c.4.13.7 — a signed number is an isolated left-to-right run (LRI … PDI): in Urdu "+10%" read "10%+" */}
            <span data-testid="obs-change" data-tone={ch.tone} className="text-center text-[14px] font-bold tabular-nums rtl:leading-[1.8]"
              style={{ color: TONE[ch.tone], unicodeBidi: "isolate" }}>{ch.tone === "first" ? ch.text : `\u2066${ch.text}\u2069`}</span>
            <span data-testid="obs-latest" dir="ltr" className="text-end text-[15px] font-bold tabular-nums" style={{ color: r.latest == null ? "#9ca3af" : "#1d2025" }}>{C.pct(r.latest)}</span>
          </Link>
        );
      })}
    </section>
  );
}

// ── a details page's top ─────────────────────────────────────────────────────

/** A pill on a details page's top (information: no edge colour, no chevron). */
const Pill = ({ children }: { children: ReactNode }) => (
  <span className="self-start rounded-full border border-[#e5e7eb] bg-white px-3 py-1 text-[13px] font-bold text-[#1d2025] rtl:leading-[1.8]">{children}</span>
);

/**
 * A count page's first card (lesson plans, assessments, modules completed): the box's number big in the feature's colour
 * and its word; the rate, the same days before and "by N of M" as pills; then the tile's chart. Nothing yet: one line in
 * place of the number, the same days before under it, no chart.
 */
export function DetailsTop({ feature, total, word, pills, empty, chart }: {
  feature: CardFeature; total: number | null; word: string; pills: (string | null | undefined)[]; empty?: string | null; chart?: ReactNode;
}) {
  const C = useCopy(SCHOOL_CARD);
  const hue = FEATURE_HUE[FEATURE_OF[feature]];
  const shown = pills.filter((p): p is string => !!p);
  return (
    <section data-testid="details-top" className={`${CARD} flex flex-col gap-2 p-4`}>
      {empty
        ? <span data-testid="details-empty" className="text-[17px] font-semibold leading-[1.35] text-[#1d2025] rtl:leading-[1.8]">{empty}</span>
        : (
          <span className="flex flex-wrap items-baseline gap-x-2">
            <b dir="ltr" data-testid="details-number" className="text-[34px] font-bold leading-[1.05] tabular-nums" style={{ color: total == null ? "#9ca3af" : hue.fg }}>{num(total, C.dash)}</b>
            <span className="text-[17px] font-semibold text-[#1d2025]">{word}</span>
          </span>
        )}
      {shown.map((p) => <Pill key={p}>{p}</Pill>)}
      {!empty && chart ? <div className="mt-1.5">{chart}</div> : null}
    </section>
  );
}

/** "By teacher" with its one line under it, before a details page's grid or list. */
export function ByTeacherHead({ sub }: { sub: string }) {
  const C = useCopy(SCHOOL_CARD);
  return (
    <div data-testid="by-teacher-head" className="mx-1 mt-2 flex flex-col">
      <h2 className="text-xl font-light">{C.byTeacherHead}</h2>
      <span className="text-[13px] font-semibold text-[#6b7280] rtl:leading-[1.8]">{sub}</span>
    </div>
  );
}

export type { BoxKind };
