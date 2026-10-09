import { Link, useParams } from "react-router-dom";
import { MapPin, Pencil, Plus } from "lucide-react";
import { HistoryList, KpiTiles, TimeStamp } from "../../teacher/ui";
import { PageChip } from "../../teacher/TeacherPage";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import { Card, BottomLink, Loading, useLoad } from "../ui";
import { PEOPLE } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";

/**
 * bd-o15qnr + bd-4404s7.6 — one teacher: average HITL with her scores over time (HITL filled, DC hollow — neutral
 * colours, scores are values), her numbers (the kit's KpiTiles), her history by month. "Schedule visit" goes
 * straight to step 3 of New visit for her. Words come from people/copy.ts (English + Urdu).
 */

function Sparkline({ points, label }: { points: { kind: "HITL" | "DC"; score: number; label: string }[]; label: string }) {
  if (points.length < 2) return null;
  const W = 326;
  const H = 112;
  const min = Math.min(...points.map((p) => p.score)) - 5;
  const max = Math.max(...points.map((p) => p.score)) + 5;
  const x = (i: number) => 16 + (i * (W - 32)) / (points.length - 1);
  const y = (s: number) => 86 - ((s - min) / Math.max(1, max - min)) * 70;
  return (
    // A chart reads left to right in Urdu too.
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label} direction="ltr">
      <polyline points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} fill="none" stroke="#c7cad6" strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => (p.kind === "HITL"
        ? <circle key={i} cx={x(i)} cy={y(p.score)} r={5.5} fill="#33374a" />
        : <circle key={i} cx={x(i)} cy={y(p.score)} r={5} fill="#ffffff" stroke="#48b078" strokeWidth={2.5} />))}
      {points.map((p, i) => <text key={`t${i}`} x={x(i)} y={106} fontSize={10} fill="#6b7280" textAnchor="middle">{p.label}</text>)}
    </svg>
  );
}

const PK = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", year: "numeric", month: "numeric", day: "numeric" });
/** A stored instant as a day in Pakistan (days are Asia/Karachi): year, month (0-11), day. */
function pkDay(iso: string): { y: number; m: number; d: number } {
  const parts = Object.fromEntries(PK.formatToParts(new Date(iso)).map((p) => [p.type, Number(p.value)]));
  return { y: parts.year, m: parts.month - 1, d: parts.day };
}
const monthKey = (iso: string | null) => { if (!iso) return ""; const { y, m } = pkDay(iso); return `${y}-${String(m + 1).padStart(2, "0")}`; };

/** History by month, newest first ("October 2026 · 3"). The service already sends the rows newest first. */
function byMonth<T extends { date: string | null }>(rows: T[]): [string, T[]][] {
  const out: [string, T[]][] = [];
  for (const r of rows) {
    const key = monthKey(r.date);
    const last = out[out.length - 1];
    if (last && last[0] === key) last[1].push(r);
    else out.push([key, [r]]);
  }
  return out;
}

const CoachTeacher = () => {
  const C = useCopy(PEOPLE);
  const { ext = "" } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getTeacher(ext), [ext]);
  const t = data?.teacher;
  const next = data?.nextVisit;
  const dayMonth = (iso: string | null) => { if (!iso) return C.dash; const { m, d } = pkDay(iso); return C.dayMonth(d, m); };
  const scored = (data?.history || []).filter((h) => h.score != null).slice(0, 6).reverse()
    .map((h) => ({ kind: h.kind, score: h.score as number, label: h.date ? dayMonth(h.date) : "" }));
  const nextDay = next?.scheduledFor ? new Date(`${next.scheduledFor}T00:00:00Z`) : null;

  return (
    <PeopleFrame title={t?.name || C.dash} crumb={C.title} feature="schools"
      backTo={t?.emis ? `/portal/coach/school/${t.emis}` : "/portal/coach/people"}
      action={t?.teacherExtId ? (
        <Link to={`/portal/coach/teacher/${t.teacherExtId}/edit`}
          className="flex min-h-[56px] min-w-[56px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#e5e7eb] bg-white px-3.5 text-sm font-semibold text-[#33374a]">
          <Pencil className="h-4 w-4" aria-hidden="true" />{C.edit}
        </Link>
      ) : undefined}
      chips={t ? (
        <>
          {t.schoolName && <PageChip><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{t.schoolName}</PageChip>}
          {next && (
            <PageChip testId="next-visit">
              {C.nextVisitOn}{nextDay ? `: ${C.weekdayDayMonth(nextDay.getUTCDay(), nextDay.getUTCDate(), nextDay.getUTCMonth())} · ` : ": "}
              <TimeStamp time={next.scheduledSlot} size={13} />
            </PageChip>
          )}
        </>
      ) : undefined}
      dock={t?.teacherExtId ? <BottomLink to={`/portal/coach/new-visit?${new URLSearchParams({ school: t.schoolExtId || "", teacher: t.teacherExtId }).toString()}`}><Plus className="h-5 w-5" aria-hidden="true" />{C.scheduleVisit}</BottomLink> : undefined}>
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {t && data && (
        <>
          <Card className="flex flex-col gap-2 p-4">
            <span className="text-[15px] text-[#6b7280]">{C.avgHitl}</span>
            <span className="text-[44px] font-light leading-none tabular-nums" data-testid="avg-hitl">{C.pct(t.avgHitl)}</span>
            <Sparkline points={scored} label={`${C.hitl} · ${C.dc}`} />
            {scored.length >= 2 && (
              <span className="flex gap-4 text-xs font-semibold text-[#6b7280]">
                <span className="inline-flex items-center gap-1.5"><i className="block h-2.5 w-2.5 rounded-full bg-[#33374a]" />{C.hitl}</span>
                <span className="inline-flex items-center gap-1.5"><i className="block h-2.5 w-2.5 rounded-full border-[2.5px] border-[#48b078]" />{C.dc}</span>
              </span>
            )}
          </Card>
          <div data-testid="teacher-stats" className="flex flex-col gap-2.5">
            <KpiTiles columns={2} items={[
              { value: t.hitl, label: C.hitlVisits },
              { value: t.dc, label: C.dcObservations },
              { value: t.examsGenerated ?? null, label: C.papersMade },
              { value: t.lpOpened ?? null, label: C.lpOpened },
            ]} />
            <KpiTiles columns={2} items={[
              { value: t.trainingModules ?? null, label: C.coursesDone },
              { value: t.daysSinceTraining == null ? null : C.daysShort(t.daysSinceTraining), label: C.lastTraining },
            ]} />
          </div>
          {data.history.length > 0 && (
            <div data-testid="history">
              {/* The kit's HistoryList by month (newest first), a round avatar saying HITL or DC, the score as the chip. */}
              <HistoryList heading={C.history} showMore={false} groups={byMonth(data.history).map(([month, rows]) => ({
                day: rows[0].date ? C.monthOf(pkDay(rows[0].date).y, pkDay(rows[0].date).m) : C.dash,
                items: rows.map((h) => {
                  // bd-o15qnr.19 — every HITL row opens the one v2 observation page (its steps, and its reports once
                  // done); a DC session is the teacher's own, information only.
                  const to = h.kind === "HITL" ? `/portal/coach/observation/${h.id}` : undefined;
                  const step = h.kind === "HITL" && (h.step === "draft" || h.step === "talk") ? C.stepLabel[h.step] : undefined;
                  return {
                    id: h.id, lead: "person" as const, leadText: h.kind, leadLabel: h.kind, title: dayMonth(h.date), extra: step,
                    chip: h.score == null ? null : { text: C.pct(h.score), tone: "score" as const }, to, action: to ? "chevron" as const : "none" as const,
                  };
                }),
              }))} />
            </div>
          )}
        </>
      )}
    </PeopleFrame>
  );
};

export default CoachTeacher;
