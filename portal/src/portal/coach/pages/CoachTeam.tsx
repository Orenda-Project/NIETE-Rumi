import { useState } from "react";
import { Check, ChevronDown, Users } from "lucide-react";
import { coach } from "../../services/api";
import { CoachPage, Card, SectionLabel, SelectBox, Loading, Failed, useLoad } from "../ui";
import { localDay } from "../time";
import type { TeamVisit } from "../types";
import { KpiTiles, TimeStamp } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { useCopy } from "../../teacher/i18n";
import { SCHEDULE, type ScheduleCopy } from "../schedule/copy";
import { dayMonth, dayShort } from "../schedule/model";

/**
 * bd-o15qnr — Team schedule: the totals first (today, this week, this month),
 * then one coach or all, the week with a count per day, and the day's visits
 * grouped by time. A time with many visits (20 is normal) shows a few and a
 * "Show all"; a collapsed time shows its count and the coaches.
 *
 * bd-4404s7.3: the totals are the kit's KpiTiles, a slot's time is the kit's TimeStamp, the words are en + ur
 * (../schedule/copy.ts). The coach field, the week strip and the slot group are this page's own until the kit's PR 2
 * (SelectField, DayStrip, SlotGroup) lands; then they are swapped in.
 */

const PREVIEW = 4;

function initials(name: string | null) {
  const p = String(name || "").trim().split(/\s+/).filter(Boolean);
  return p.length ? `${p[0][0]}${p.length > 1 ? p[p.length - 1][0] : ""}`.toUpperCase() : "·";
}

function Visit({ v, c }: { v: TeamVisit; c: ScheduleCopy }) {
  return (
    <div data-testid="team-visit" className="flex min-h-[60px] items-center gap-3 border-t border-[#eef0f3] px-3.5 py-2">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${v.mine ? "bg-[#33374a] text-white" : "bg-[#e8e9f0] text-[#33374a]"}`} aria-hidden="true">
        {v.mine ? c.you : initials(v.coachName)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[15px] font-semibold">{v.teacherName || c.dash}</span>
        <span className="truncate text-xs text-[#6b7280]">{[v.schoolName, v.mine ? c.you : v.coachName].filter(Boolean).join(" · ")}</span>
      </span>
      {v.done && <Check className="h-5 w-5 shrink-0 text-[#48b078]" aria-label={c.done} />}
    </div>
  );
}

function SlotGroup({ slot, visits, startOpen, c }: { slot: string | null; visits: TeamVisit[]; startOpen: boolean; c: ScheduleCopy }) {
  const [open, setOpen] = useState(startOpen);
  const [all, setAll] = useState(false);
  const shown = all ? visits : visits.slice(0, PREVIEW);
  const coaches = [...new Map(visits.map((v) => [v.coachId, v])).values()];
  return (
    <section data-testid={`slot-${slot || "none"}`} className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex min-h-[64px] w-full items-center gap-3 px-3.5 py-2 text-start">
        <span className="min-w-[86px]"><TimeStamp time={slot} size={18} /></span>
        <span className="inline-flex h-7 items-center rounded-full bg-[#f3f4f6] px-2.5 text-[13px] font-bold tabular-nums text-[#374151]">{c.visitsN(visits.length)}</span>
        <span className="flex flex-1 justify-end" aria-hidden="true">
          {!open && coaches.slice(0, 2).map((v) => (
            <span key={v.coachId} className={`-ms-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold ${v.mine ? "bg-[#33374a] text-white" : "bg-[#e8e9f0] text-[#33374a]"}`}>{v.mine ? c.you : initials(v.coachName)}</span>
          ))}
          {!open && coaches.length > 2 && <span className="-ms-2 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-[#e8e9f0] px-1 text-[10px] font-bold text-[#33374a]">+{coaches.length - 2}</span>}
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-[#9ca3af] ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && shown.map((v) => <Visit key={v.id} v={v} c={c} />)}
      {open && visits.length > PREVIEW && (
        <button type="button" onClick={() => setAll((a) => !a)}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 border-t border-[#eef0f3] bg-[#f9fafb] text-[15px] font-semibold text-[#33374a]">
          {all ? c.showFewer : c.showAllN(visits.length)}
          <ChevronDown className={`h-4 w-4 ${all ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}
    </section>
  );
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

          <Card className="grid grid-cols-7 gap-1 p-2">
            {data.days.map((d) => {
              const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
              const on = d.date === date;
              return (
                <button key={d.date} type="button" aria-pressed={on} aria-label={dayShort(d.date, c)} onClick={() => setDate(d.date)}
                  className={`flex min-h-[72px] flex-col items-center justify-center gap-0.5 rounded-xl ${on ? "bg-[#33374a] text-white" : ""} ${[0, 6].includes(dow) ? "opacity-50" : ""}`}>
                  <small className={`text-[11px] font-semibold uppercase ${on ? "text-[#c7cad6]" : "text-[#6b7280]"}`}>{c.weekdaysShort[dow]}</small>
                  <b className="text-lg font-bold tabular-nums">{Number(d.date.slice(8))}</b>
                  <em className={`text-[11px] font-bold not-italic tabular-nums ${on ? "text-[#c7cad6]" : "text-[#6b7280]"}`}>{d.count}</em>
                </button>
              );
            })}
          </Card>

          <SectionLabel>{dayMonth(data.date, c, kit.months)}</SectionLabel>
          {data.groups.length === 0 && <Card className="p-4 text-[15px] text-[#6b7280]">{c.noVisits}</Card>}
          {data.groups.map((g, i) => <SlotGroup key={`${data.date}-${g.slot}`} slot={g.slot} visits={g.visits} startOpen={i === 0} c={c} />)}
        </>
      )}
    </CoachPage>
  );
};

export default CoachTeam;
