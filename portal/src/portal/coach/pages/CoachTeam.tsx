import { useState } from "react";
import { Users } from "lucide-react";
import { coach } from "../../services/api";
import { CoachPage, Card, SectionLabel, SelectBox, Loading, Failed, useLoad } from "../ui";
import { localDay } from "../time";
import type { TeamVisit } from "../types";
import { DayStrip, KpiTiles, SlotGroup, addDays, weekdayOf } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { useCopy } from "../../teacher/i18n";
import { SCHEDULE } from "../schedule/copy";
import { dayMonth } from "../schedule/model";

/**
 * bd-o15qnr — Team schedule: the totals first (today, this week, this month),
 * then one coach or all, the week with a count per day, and the day's visits
 * grouped by time. A time with many visits (20 is normal) shows a few and a
 * "Show all"; a collapsed time shows its count and the coaches.
 *
 * bd-4404s7.3: the totals are the kit's KpiTiles, the week is the kit's DayStrip (a count under each day; the arrows ask
 * for that week), each time is the kit's SlotGroup (TimeStamp, "N visits", avatars, Show all), the words are en + ur
 * (../schedule/copy.ts). The coach field is this page's native select until the kit's SelectField (PR 2c) lands.
 */

function personOf(v: TeamVisit, you: string) {
  return { id: v.id, name: v.teacherName || "—", sub: [v.schoolName, v.mine ? you : v.coachName].filter(Boolean).join(" · "), initials: undefined, mine: v.mine, done: v.done };
}

const CoachTeam = () => {
  const c = useCopy(SCHEDULE);
  const kit = useKitCopy();
  const [date, setDate] = useState(localDay());
  const [coachId, setCoachId] = useState("");
  const { data, failed, reload } = useLoad(() => coach.getTeam({ date, coach: coachId || undefined }), [date, coachId]);

  return (
    <CoachPage title={c.teamSchedule} crumb={c.title} backTo="/portal/coach/scheduling">
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && (
        <>
          <div data-testid="team-totals">
            <KpiTiles columns={3} items={[
              { value: data.totals.today, label: c.totals.today },
              { value: data.totals.week, label: c.totals.week },
              { value: data.totals.month, label: c.totals.month },
            ]} />
          </div>

          <SelectBox label={c.coach} value={coachId} onChange={setCoachId}
            icon={<Users className="h-5 w-5 shrink-0 text-[#6b7280]" aria-hidden="true" />}
            options={[{ value: "", label: `${c.allCoaches} · ${data.coaches.length}` },
              ...data.coaches.map((k) => ({ value: k.id, label: k.me ? `${k.name || ""} (${c.you})` : (k.name || c.dash) }))]} />

          <DayStrip
            label={c.week}
            value={date}
            onChange={setDate}
            onWeekChange={(first) => setDate(addDays(first, weekdayOf(date)))}
            counts={Object.fromEntries(data.days.map((d) => [d.date, d.count]))}
          />

          <SectionLabel>{dayMonth(data.date, c, kit.months)}</SectionLabel>
          {data.groups.length === 0 && <Card className="p-4 text-[15px] text-[#6b7280]">{c.noVisits}</Card>}
          {data.groups.map((g, i) => (
            <div key={`${data.date}-${g.slot}`} data-testid={`slot-${g.slot || "none"}`}>
              <SlotGroup time={g.slot || ""} count={g.visits.length} defaultOpen={i === 0} people={g.visits.map((v) => personOf(v, c.you))} />
            </div>
          ))}
        </>
      )}
    </CoachPage>
  );
};

export default CoachTeam;
