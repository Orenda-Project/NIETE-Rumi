import { useParams } from "react-router-dom";
import { Clock, Eye, GraduationCap, MapPin, Mic, Plus } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, SectionLabel, IconCircle, PageChip, BottomLink, Loading, Failed, useLoad } from "../ui";
import { formatSlot } from "../time";

/**
 * bd-o15qnr — one teacher: average HITL with her scores over time (HITL filled,
 * DC hollow — neutral colours, scores are values), her counts, her history.
 * "Schedule visit" goes straight to step 3 of New visit for her.
 */

function Sparkline({ points }: { points: { kind: "HITL" | "DC"; score: number; label: string }[] }) {
  if (points.length < 2) return null;
  const W = 326;
  const H = 112;
  const min = Math.min(...points.map((p) => p.score)) - 5;
  const max = Math.max(...points.map((p) => p.score)) + 5;
  const x = (i: number) => 16 + (i * (W - 32)) / (points.length - 1);
  const y = (s: number) => 86 - ((s - min) / Math.max(1, max - min)) * 70;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${C.hitl} · ${C.dc}`}>
      <polyline points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} fill="none" stroke="#c7cad6" strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => (p.kind === "HITL"
        ? <circle key={i} cx={x(i)} cy={y(p.score)} r={5.5} fill="#33374a" />
        : <circle key={i} cx={x(i)} cy={y(p.score)} r={5} fill="#ffffff" stroke="#48b078" strokeWidth={2.5} />))}
      {points.map((p, i) => <text key={`t${i}`} x={x(i)} y={106} fontSize={10} fill="#6b7280" textAnchor="middle">{p.label}</text>)}
    </svg>
  );
}

const CoachTeacher = () => {
  const { ext = "" } = useParams();
  const { data, failed, reload } = useLoad(() => coach.getTeacher(ext), [ext]);
  const t = data?.teacher;
  const next = data?.nextVisit;
  const scored = (data?.history || []).filter((h) => h.score != null).slice(0, 6).reverse()
    .map((h) => ({ kind: h.kind, score: h.score as number, label: h.date ? new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "" }));
  const cell = (icon: React.ReactNode, value: React.ReactNode, label: string, extra = "") => (
    <div className={`flex items-center gap-3 p-3.5 ${extra}`}>
      <IconCircle hue="green" size={40}>{icon}</IconCircle>
      <span><b className="block text-xl font-bold tabular-nums">{value}</b><span className="text-xs text-[#6b7280]">{label}</span></span>
    </div>
  );

  return (
    <CoachPage title={t?.name || C.dash} crumb={t?.schoolName ? `${C.schoolsAndTeachers} · ${t.schoolName}` : C.schoolsAndTeachers}
      backTo={t?.emis ? `/portal/coach/school/${t.emis}` : "/portal/coach/people"}
      chips={t ? (
        <>
          {t.schoolName && <PageChip><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{t.schoolName}</PageChip>}
          {next && <PageChip>{C.nextVisitOn(`${next.scheduledFor ? new Date(`${next.scheduledFor}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : ""} ${formatSlot(next.scheduledSlot)}`)}</PageChip>}
        </>
      ) : undefined}
      dock={t?.teacherExtId ? <BottomLink to={`/portal/coach/new-visit?${new URLSearchParams({ school: t.schoolExtId || "", teacher: t.teacherExtId }).toString()}`}><Plus className="h-5 w-5" aria-hidden="true" />{C.scheduleVisit}</BottomLink> : undefined}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {t && data && (
        <>
          <Card className="flex flex-col gap-2 p-4">
            <span className="text-[15px] text-[#6b7280]">{C.avgHitl}</span>
            <span className="text-[44px] font-light leading-none tabular-nums" data-testid="avg-hitl">{C.pct(t.avgHitl)}</span>
            <Sparkline points={scored} />
            {scored.length >= 2 && (
              <span className="flex gap-4 text-xs font-semibold text-[#6b7280]">
                <span className="inline-flex items-center gap-1.5"><i className="block h-2.5 w-2.5 rounded-full bg-[#33374a]" />{C.hitl}</span>
                <span className="inline-flex items-center gap-1.5"><i className="block h-2.5 w-2.5 rounded-full border-[2.5px] border-[#48b078]" />{C.dc}</span>
              </span>
            )}
          </Card>
          <Card className="grid grid-cols-2 overflow-hidden">
            {cell(<Eye className="h-5 w-5" />, t.hitl, C.hitlVisits)}
            {cell(<Mic className="h-5 w-5" />, t.dc, C.dcSessions, "border-s border-[#e5e7eb]")}
            {cell(<GraduationCap className="h-5 w-5" />, t.trainingModules ?? C.dash, C.modulesDone, "border-t border-[#e5e7eb]")}
            {cell(<Clock className="h-5 w-5" />, C.daysShort(t.daysSinceTraining), C.lastTraining, "border-s border-t border-[#e5e7eb]")}
          </Card>
          {data.history.length > 0 && (
            <>
              <SectionLabel>{C.history}</SectionLabel>
              <Card className="overflow-hidden" data-testid="history">
                {data.history.map((h, i) => (
                  <div key={h.id} className={`flex min-h-[72px] items-center gap-3.5 px-3.5 py-2.5 ${i > 0 ? "border-t border-[#e5e7eb]" : ""}`}>
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${h.kind === "HITL" ? "bg-[#33374a] text-white" : "bg-[#f3f4f6] text-[#33374a]"}`}>{h.kind}</span>
                    <span className="flex-1 text-[17px] font-semibold">{h.date ? new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : C.dash}</span>
                    <span className="text-lg font-bold tabular-nums">{C.pct(h.score)}</span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </CoachPage>
  );
};

export default CoachTeacher;
