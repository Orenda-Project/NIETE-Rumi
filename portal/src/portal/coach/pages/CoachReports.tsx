import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, SectionLabel, Chip, Initials, SearchBox, Loading, Failed, Chevron, DayLabel } from "../ui";
import { localDay } from "../time";
import type { CoachReport, ReportsData } from "../types";

/**
 * bd-o15qnr — Reports: Waiting for you (her draft to check, her talk to have),
 * In progress (still being analysed), then every observation grouped by day —
 * searchable by name or phone, a page at a time. Every card and row opens the
 * v2 observation page (bd-o15qnr.19).
 */

const STEP_INDEX: Record<string, number> = { analysing: 0, draft: 1, talk: 2, sent: 4 };

/** bd-o15qnr.19 — every report opens the one v2 observation page, never the teacher. */
function hrefFor(r: CoachReport): string {
  return `/portal/coach/observation/${r.id}`;
}

function Progress({ step }: { step: string }) {
  const at = STEP_INDEX[step] ?? 0;
  return (
    <span className="grid grid-cols-4 gap-1.5 px-3.5 pb-3 pt-1" aria-hidden="true">
      {C.steps.map((label, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <span key={label} className="flex flex-col gap-1">
            <i className="block h-1.5 rounded-full" style={{ background: done ? "#48b078" : current ? "#f59e0b" : "#e5e7eb" }} />
            <span className="text-[11px] font-semibold" style={{ color: done ? "#2f7a52" : current ? "#b45309" : "#9ca3af" }}>
              {current && step === "analysing" ? C.stepLabel.analysing : label}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function ReportCard({ r, waiting }: { r: CoachReport; waiting?: boolean }) {
  const to = hrefFor(r);
  const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
  const inner = (
    <>
      <span className="flex min-h-[72px] items-center gap-3 px-3.5 pb-1.5 pt-2.5">
        <Initials name={r.teacherName} size={44} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base font-semibold">{r.teacherName || C.dash}</span>
          <span className="truncate text-[13px] text-[#6b7280]">{[r.schoolName, date].filter(Boolean).join(" · ")}</span>
        </span>
        {r.step === "analysing"
          ? <Chip><Clock className="h-3.5 w-3.5" aria-hidden="true" />{C.stepLabel.analysing}</Chip>
          : <Chip tone={waiting ? "warn" : "info"}>{C.stepLabel[r.step]}</Chip>}
        {to && <Chevron />}
      </span>
      <Progress step={r.step} />
    </>
  );
  const cls = `flex flex-col rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)] ${waiting ? "border-2 border-[#f59e0b]" : "border border-[#e5e7eb]"}`;
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

function Row({ r }: { r: CoachReport }) {
  const to = hrefFor(r);
  const time = r.createdAt ? new Date(r.createdAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase() : "";
  const inner = (
    <>
      <Initials name={r.teacherName} size={44} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base font-semibold">{r.teacherName || C.dash}</span>
        <span className="truncate text-[13px] text-[#6b7280]">{[r.schoolName, time].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="text-[17px] font-bold tabular-nums">{C.pct(r.score)}</span>
      {to && <Chevron />}
    </>
  );
  const cls = "flex min-h-[64px] items-center gap-3 px-3.5 py-2 [&+&]:border-t [&+&]:border-[#eef0f3]";
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

const CoachReports = () => {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [first, setFirst] = useState<ReportsData | null>(null);
  const [items, setItems] = useState<CoachReport[]>([]);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    coach.getReports({ page, q: q.trim() || undefined }).then((d) => {
      if (!live) return;
      if (page === 1) { setFirst(d); setItems(d.all.items); } else { setItems((prev) => [...prev, ...d.all.items]); }
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [q, page, tick]);

  const search = (v: string) => { setQ(v); setPage(1); };

  const days = useMemo(() => {
    const m = new Map<string, CoachReport[]>();
    for (const r of items) {
      const key = r.createdAt ? localDay(new Date(r.createdAt)) : "";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return [...m.entries()];
  }, [items]);

  const today = localDay();
  const total = first?.all.total ?? 0;

  return (
    <CoachPage title={C.reports} crumb={C.observe} backTo="/portal/coach/observe">
      {failed && <Failed onRetry={() => setTick((n) => n + 1)} />}
      {!first && !failed && <Loading />}
      {first && (
        <>
          <div className="flex flex-col gap-2.5" data-testid="reports-waiting">
            <SectionLabel countStyle="count" count={first.waiting.length} countTone={first.waiting.length ? "warn" : "info"}>{C.waitingForYou}</SectionLabel>
            {first.waiting.map((r) => <ReportCard key={r.id} r={r} waiting />)}
          </div>
          <div className="flex flex-col gap-2.5" data-testid="reports-in-progress">
            <SectionLabel countStyle="count" count={first.inProgress.length}>{C.inProgress}</SectionLabel>
            {first.inProgress.map((r) => <ReportCard key={r.id} r={r} />)}
          </div>
          <div className="flex flex-col gap-2.5" data-testid="reports-all">
            <SectionLabel countStyle="count" count={total}>{C.allObservations}</SectionLabel>
            <SearchBox value={q} onChange={search} placeholder={C.searchPlaceholder} />
            {days.map(([day, list]) => (
              <div key={day} className="flex flex-col gap-1.5" data-testid="report-day" data-day={day}>
                <DayLabel count={list.length}>
                  {day === today ? C.today : new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                </DayLabel>
                <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
                  {list.map((r) => <Row key={r.id} r={r} />)}
                </div>
              </div>
            ))}
            {items.length < total && (
              <button type="button" onClick={() => setPage((p) => p + 1)}
                className="min-h-[56px] rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold text-[#33374a]">{C.showMore}</button>
            )}
          </div>
        </>
      )}
    </CoachPage>
  );
};

export default CoachReports;
