import { useMemo, useState } from "react";
import { Check, Clock, Plus } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, SectionLabel, Chip, TimeTile, RowText, TapRow, BottomLink, Loading, Failed, useLoad } from "../ui";
import { localDay } from "../time";
import type { CoachVisit } from "../types";

/**
 * bd-o15qnr — My schedule: the week strip (a dot per visit, green when done),
 * overdue visits first with days late, then each day's visits. Tap a day to see
 * only that day; tap it again for the whole week.
 */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayParts(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return { wd: WEEKDAY[d.getDay()], n: d.getDate() };
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function VisitRow({ v, today }: { v: CoachVisit; today: string }) {
  const done = v.status === "done";
  const next = !done && v.current;
  return (
    <TapRow to={`/portal/coach/visit/${v.id}`} muted={done} emphasis={next}>
      <TimeTile slot={v.scheduledSlot} tone={v.overdue ? "overdue" : done ? "done" : next ? "next" : "neutral"} />
      <RowText name={<span className={done ? "text-[#6b7280]" : ""}>{v.teacherName || C.dash}</span>}
        sub={v.overdue ? `${v.schoolName || ""} · ${v.scheduledFor ? `${dayParts(v.scheduledFor).wd} ${dayParts(v.scheduledFor).n}` : ""}` : v.schoolName} />
      {done && <Chip tone="done"><Check className="h-3.5 w-3.5" aria-hidden="true" />{C.done}</Chip>}
      {v.overdue && v.scheduledFor && <Chip tone="warn">{C.daysLate(daysBetween(v.scheduledFor, today))}</Chip>}
      {next && <Chip>{C.next}</Chip>}
    </TapRow>
  );
}

const CoachSchedule = () => {
  const today = localDay();
  const { data, failed, reload } = useLoad(() => coach.getSchedule(), []);
  const [picked, setPicked] = useState<string | null>(null);

  const days = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${data.from}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, [data]);

  const byDay = useMemo(() => {
    const m = new Map<string, CoachVisit[]>();
    const nextId = (data?.visits || []).find((v) => v.scheduledFor === today && v.status === "upcoming")?.id;
    for (const v of data?.visits || []) {
      const key = v.scheduledFor || "";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push({ ...v, current: v.id === nextId });
    }
    return m;
  }, [data, today]);

  const shownDays = days.filter((d) => byDay.has(d) && (!picked || picked === d));

  return (
    <CoachPage title={C.mySchedule} crumb={data ? `${C.scheduling} · ${dayParts(data.from).n}–${dayParts(data.to).n}` : C.scheduling}
      backTo="/portal/coach/scheduling"
      dock={<BottomLink to="/portal/coach/new-visit"><Plus className="h-5 w-5" aria-hidden="true" />{C.newVisit}</BottomLink>}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <Card className="grid grid-cols-7 gap-1 p-2">
            {days.map((d) => {
              const { wd, n } = dayParts(d);
              const list = byDay.get(d) || [];
              const on = picked === d || (!picked && d === today);
              return (
                <button key={d} type="button" aria-pressed={picked === d} aria-label={`${wd} ${n}`}
                  onClick={() => setPicked((p) => (p === d ? null : d))}
                  className={`flex min-h-[72px] flex-col items-center justify-center gap-0.5 rounded-xl ${on ? "bg-[#33374a] text-white" : ""} ${[0, 6].includes(new Date(`${d}T00:00:00`).getDay()) ? "opacity-50" : ""}`}>
                  <small className={`text-[11px] font-semibold uppercase ${on ? "text-[#c7cad6]" : "text-[#6b7280]"}`}>{wd}</small>
                  <b className="text-lg font-bold tabular-nums">{n}</b>
                  <i className="flex h-1.5 gap-0.5" aria-hidden="true">
                    {list.slice(0, 4).map((v) => <span key={v.id} className="h-1.5 w-1.5 rounded-full" style={{ background: v.status === "done" ? "#48b078" : on ? "#c7cad6" : "#9ca3af" }} />)}
                  </i>
                </button>
              );
            })}
          </Card>

          {data.overdue.length > 0 && (
            <div className="flex flex-col gap-3" data-testid="overdue">
              <SectionLabel><span className="inline-flex items-center gap-2"><Clock className="h-[18px] w-[18px] text-[#b45309]" aria-hidden="true" />{C.overdue}</span></SectionLabel>
              {data.overdue.map((v) => <VisitRow key={v.id} v={v} today={today} />)}
            </div>
          )}

          {shownDays.map((d) => {
            const { wd, n } = dayParts(d);
            return (
              <div key={d} className="flex flex-col gap-3">
                <SectionLabel>{d === today ? `${C.today} · ${wd} ${n}` : `${wd} ${n}`}</SectionLabel>
                {(byDay.get(d) || []).map((v) => <VisitRow key={v.id} v={v} today={today} />)}
              </div>
            );
          })}
          {shownDays.length === 0 && data.overdue.length === 0 && <Card className="p-4 text-[15px] text-[#6b7280]">{C.noVisits}</Card>}
        </>
      )}
    </CoachPage>
  );
};

export default CoachSchedule;
