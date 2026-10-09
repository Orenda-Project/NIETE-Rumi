import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { coach } from "../../services/api";
import { CoachPage, Card, BottomLink, Loading, Failed, useLoad } from "../ui";
import { karachiDay } from "../time";
import type { CoachVisit } from "../types";
import { DayStrip, HistoryList, addDays, type HistoryGroup, type HistoryItem } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { SCHEDULE, type ScheduleCopy } from "../schedule/copy";
import { dayShort, daysBetween } from "../schedule/model";

/**
 * bd-o15qnr — My schedule: the week strip (a dot per visit, green when done),
 * overdue visits first with days late, then each day's visits. Tap a day to see
 * only that day; tap it again for the whole week.
 *
 * bd-4404s7.3: the visits are the kit's HistoryList of HistoryRow lead="person" (a round avatar, the TimeStamp on the
 * first line, status tones: next is a tinted row with a bar, done is muted), the words are en + ur
 * (../schedule/copy.ts). The week is the kit's DayStrip (a dot per visit, green when done; the arrows ask for that week).
 */

/** One visit as the kit's coach row: a round avatar, the TimeStamp on the first line, the teacher, the school. */
function visitItem(v: CoachVisit, today: string, c: ScheduleCopy): HistoryItem {
  const done = v.status === "done";
  const next = !done && !!v.current;
  const late = v.overdue && v.scheduledFor ? daysBetween(v.scheduledFor, today) : null;
  return {
    id: v.id,
    lead: "person",
    title: v.teacherName || c.dash,
    extra: [v.schoolName, v.overdue && v.scheduledFor ? dayShort(v.scheduledFor, c) : null].filter(Boolean).join(" · "),
    time: v.scheduledSlot,
    timeTone: v.overdue ? "overdue" : undefined,
    state: done ? "done" : next ? "next" : "default",
    chip: done ? { text: c.done, tone: "done" } : late != null ? { text: c.daysLate(late), tone: "waiting" } : next ? { text: c.next, tone: "info" } : null,
    to: `/portal/coach/visit/${v.id}`,
  };
}

const CoachSchedule = () => {
  const c = useCopy(SCHEDULE);
  const today = karachiDay(); // bd-o15qnr.23: the day in Pakistan
  // The week asked for with the strip's arrows; none = this week, as the server counts it.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const { data, failed, reload } = useLoad(() => coach.getSchedule(range ?? {}), [range?.from]);
  const [picked, setPicked] = useState<string | null>(null);

  const days = useMemo(() => (data ? Array.from({ length: 7 }, (_, i) => addDays(data.from, i)) : []), [data]);

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
  const dayNo = (iso: string) => Number(iso.slice(8));

  return (
    <CoachPage title={c.mySchedule} crumb={data ? c.weekCrumb(dayNo(data.from), dayNo(data.to)) : c.title}
      backTo="/portal/coach/scheduling"
      dock={<BottomLink to="/portal/coach/new-visit"><Plus className="h-5 w-5" aria-hidden="true" />{c.newVisit}</BottomLink>}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <DayStrip
            label={c.week}
            value={picked ?? (days.includes(today) ? today : data.from)}
            week={data.from}
            onChange={(d) => setPicked((p) => (p === d ? null : d))}
            onWeekChange={(first) => { setPicked(null); setRange({ from: first, to: addDays(first, 6) }); }}
            dots={Object.fromEntries(days.map((d) => [d, (byDay.get(d) || []).slice(0, 3).map((v) => (v.status === "done" ? "done" : "open") as "done" | "open")]))}
          />

          {data.overdue.length > 0 && (
            <div data-testid="overdue">
              <HistoryList showMore={false} groups={[{ day: c.overdue, items: data.overdue.map((v) => visitItem(v, today, c)) }]} />
            </div>
          )}

          {shownDays.length > 0 && (
            <HistoryList showMore={false} groups={shownDays.map((d): HistoryGroup => ({
              day: d === today ? `${c.today} · ${dayShort(d, c)}` : dayShort(d, c),
              items: (byDay.get(d) || []).map((v) => visitItem(v, today, c)),
            }))} />
          )}
          {shownDays.length === 0 && data.overdue.length === 0 && <Card className="p-4 text-[15px] text-[#6b7280]">{c.noVisits}</Card>}
        </>
      )}
    </CoachPage>
  );
};

export default CoachSchedule;
