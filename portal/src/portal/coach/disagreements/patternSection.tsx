import type { ReactNode } from "react";
import { useCopy, useLang } from "../../teacher/i18n";
import type { Pattern } from "./api";
import { PATTERN } from "./patternCopy";

/**
 * bd-tbprit.10 — Rifat's "3. Is this a pattern?": the line of her last lessons (the dashed average, her best in
 * green, this lesson in gold), then four facts — average · best, recordings a week against the ICT average, the
 * step missed here over her last 5 checked lessons, and her earlier "don't agree" taps. Her chart's geometry and
 * colours. Fewer than 2 scores draws no line; what the server does not have is said, never guessed.
 */

const H2 = "text-[17px] font-bold text-[#1d2025]";
const COLOUR = { line: "#3d5bd6", gold: "#f2b51d", best: "#2f8a55", ok: "#2f9a46", amber: "#d99a1e", red: "#c2552f" };
const W = 380, H = 140, PL = 14, PR = 30, PT = 22, PB = 22;

function useDay() {
  const C = useCopy(PATTERN);
  return (iso: string | null) => {
    if (!iso) return "—";
    const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "Asia/Karachi" }).formatToParts(new Date(iso));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return `${n("day")} ${C.months[n("month") - 1]}`;
  };
}

function Chart({ p }: { p: Pattern }) {
  const C = useCopy(PATTERN);
  const day = useDay();
  const pcts = p.points.map((x) => x.pct);
  const lo = Math.min(50, Math.floor(Math.min(...pcts) / 10) * 10);
  const hi = Math.max(80, Math.ceil(Math.max(...pcts) / 10) * 10);
  const x = (i: number) => PL + (i * (W - PL - PR)) / (p.points.length - 1);
  const y = (v: number) => PT + ((hi - v) * (H - PT - PB)) / (hi - lo);
  const line = p.points.map((pt, i) => `${x(i)},${y(pt.pct)}`).join(" ");
  const last = p.points.length - 1;
  const bestAt = p.best ? p.points.findIndex((pt) => pt.pct === p.best!.pct && pt.date === p.best!.date) : -1;
  const now = p.points[last].pct;
  const grid: number[] = [];
  for (let v = lo; v <= hi; v += 10) grid.push(v);
  return (
    <svg role="img" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" dir="ltr" aria-label={C.title}>
      {grid.map((v) => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#e1e4ea" />
          <text x={W - PR + 4} y={y(v) + 3} fontSize="10" fill="#8a90a0">{v}</text>
        </g>
      ))}
      <path d={`M${x(0)},${H - PB} L${line.replace(/ /g, " L")} L${x(last)},${H - PB} Z`} fill={COLOUR.line} opacity=".1" />
      {p.avg != null ? (
        <g>
          <line x1={PL} x2={W - PR} y1={y(p.avg)} y2={y(p.avg)} stroke="#8a90a0" strokeDasharray="3 3" />
          <text x={PL} y={y(p.avg) - 4} fontSize="10" fill="#5f6677">{C.herAverage(p.avg)}</text>
        </g>
      ) : null}
      <polyline points={line} fill="none" stroke={COLOUR.line} strokeWidth="2" />
      {bestAt >= 0 && bestAt !== last ? (
        <g>
          <circle cx={x(bestAt)} cy={y(p.best!.pct)} r="3.5" fill={COLOUR.best} />
          <text x={x(bestAt)} y={y(p.best!.pct) - 7} fontSize="10" fontWeight="700" fill={COLOUR.best} textAnchor="middle">{p.best!.pct}</text>
        </g>
      ) : null}
      <circle cx={x(last)} cy={y(now)} r="5" fill={COLOUR.gold} stroke="#fff" strokeWidth="2" />
      <text x={x(last)} y={now < 56 ? y(now) - 9 : y(now) + 17} fontSize="11" fontWeight="800" fill="#1d2025" textAnchor="end">{C.nowLabel(now)}</text>
      <text x={PL} y={H - 5} fontSize="10" fill="#8a90a0">{day(p.points[0].date)}</text>
      <text x={W - PR} y={H - 5} fontSize="10" fill="#8a90a0" textAnchor="end">{day(p.points[last].date)}</text>
    </svg>
  );
}

function Pill({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <span data-testid="pattern-pill" className="rounded-full px-[9px] py-px text-[12px] font-bold text-white" style={{ background: colour }}>
      {children}
    </span>
  );
}

function Fact({ q, a, note }: { q: string; a: ReactNode; note: string }) {
  return (
    <div data-testid="pattern-fact" className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-[#e1e4ea] py-2.5">
      <p className="text-[13.5px]" dir="auto">{q}</p>
      <div className="text-end text-[13.5px] font-extrabold">{a}</div>
      <p className="col-span-2 text-[12.5px] text-[#5f6677]" dir="auto">{note}</p>
    </div>
  );
}

function Facts({ p }: { p: Pattern }) {
  const C = useCopy(PATTERN);
  const day = useDay();
  const best = p.best ? day(p.best.date) : "—";
  const lowest = p.now != null && p.points.length > 1 && p.now <= Math.min(...p.points.map((x) => x.pct));
  const avgNote = p.now == null || p.avg == null ? "" : lowest ? C.lowest(p.now, p.count, best) : p.now < p.avg ? C.below(p.now, best) : C.atOrAbove(p.now, best);
  const ict = p.ictAvg.toFixed(2);
  const rateColour = p.level === "active" ? COLOUR.ok : p.level === "steady" ? COLOUR.amber : COLOUR.red;
  const m = p.missed;
  const missedColour = m && m.n >= 3 ? COLOUR.red : m && m.n === 2 ? COLOUR.amber : COLOUR.ok;
  return (
    <div>
      <Fact q={C.avgQ} a={p.avg != null && p.best ? `${p.avg}% · ${p.best.pct}%` : "—"} note={avgNote} />
      <Fact
        q={C.rateQ}
        a={p.perWeek != null && p.level ? <Pill colour={rateColour}>{`${p.perWeek.toFixed(1)} · ${C.level[p.level]}`}</Pill> : "—"}
        note={p.perWeek == null ? C.oneLesson : p.level === "active" ? C.activeNote(ict) : C.spanNote(p.count, day(p.firstDate), day(p.lastDate), ict)}
      />
      {m == null ? (
        <Fact q={C.missedNoneQ(5)} a={C.notChecked} note={C.notCheckedNote} />
      ) : m.step == null ? (
        <Fact q={C.missedNoneQ(m.of)} a={C.none} note="" />
      ) : (
        <Fact q={C.missedQ(m.step)} a={<Pill colour={missedColour}>{C.nOf(m.n, m.of)}</Pill>} note={m.n >= 2 ? C.repeated : C.once} />
      )}
      <Fact q={C.tapsQ} a={p.earlier ? String(p.earlier) : C.none} note={p.earlier ? C.tapsNote : C.firstTime} />
    </div>
  );
}

export function PatternSection({ p }: { p: Pattern }) {
  const C = useCopy(PATTERN);
  useLang();
  return (
    <section data-testid="pattern" className="flex flex-col gap-2 rounded-2xl border border-[#e1e4ea] bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={H2}>{C.title}</h2>
        <span className="text-[12.5px] text-[#5f6677]">{C.lastN(p.count)}</span>
      </div>
      {p.points.length >= 2 ? <Chart p={p} /> : <p className="text-[14px] text-[#5f6677]">{C.noLine}</p>}
      <Facts p={p} />
    </section>
  );
}
