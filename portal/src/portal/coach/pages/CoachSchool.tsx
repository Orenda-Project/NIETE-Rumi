import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { ConfirmTray, KpiTiles, StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import { SectionLabel, BottomLink, Loading, useLoad, TapRow, IconTile, RowText } from "../ui";
import { PEOPLE } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { TeacherCard, Notice, useNotice } from "../people/rows";
import { bySince } from "./CoachPeople";
import { coachFeatureReady } from "../training/appReady";

/**
 * bd-o15qnr + bd-4404s7.6 — one school: its four numbers (the kit's KpiTiles), then its teachers, never-visited first.
 *
 * Then Manage (Blueprint: Coach · Manage schools and teachers), the WhatsApp /observe "Manage teachers" for THIS
 * school: Add a teacher, Remove teachers, and Remove school. Removing the school asks first (the kit's ConfirmTray)
 * and takes only HER link: the teachers stay at the school, for every other coach who holds it.
 */
const CoachSchool = () => {
  const C = useCopy(PEOPLE);
  const { emis = "" } = useParams();
  const navigate = useNavigate();
  const { notice, tellTeam } = useNotice();
  const { data, failed, reload } = useLoad(() => coach.getSchool(emis), [emis]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const s = data?.school;

  const removeSchool = async () => {
    if (busy || !s) return;
    setBusy(true); setError(false);
    try {
      await coach.removeSchool(emis);
      navigate("/portal/coach/people", { replace: true, state: { notice: C.removedName(s.name || emis) } });
    } catch {
      setAsking(false); setError(true);
    } finally { setBusy(false); }
  };

  const base = `/portal/coach/school/${encodeURIComponent(emis)}`;
  return (
    <PeopleFrame title={s?.name || C.dash} crumb={C.title} backTo="/portal/coach/people" feature="schools"
      // Schedule a visit here opens Schedule: only once Schedule is in the coach app.
      dock={s && coachFeatureReady("schedule") ? <BottomLink to={`/portal/coach/new-visit?${new URLSearchParams({ school: s.schoolExtId }).toString()}`}><Plus className="h-5 w-5" aria-hidden="true" />{C.scheduleVisitHere}</BottomLink> : undefined}>
      <Notice text={notice} />
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {s && data && (
        <>
          {tellTeam && s.teachers === 0 && (
            <p role="note" data-testid="tell-team" className="m-0 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] font-medium leading-snug text-[#b45309]">{C.lines.tellTeam}</p>
          )}
          <KpiTiles columns={2} items={[
            { value: s.visits, label: C.visitsLast3 },
            { value: s.daysSinceVisit == null ? null : C.daysShort(s.daysSinceVisit), label: C.sinceVisit },
            { value: s.avgHitl == null ? null : C.pct(s.avgHitl), label: C.avgHitl },
            { value: s.teachers, label: C.teachersCol },
          ]} />
          <SectionLabel right={<span className="text-[13px] font-semibold text-[#6b7280]">{C.sortDays}</span>}>{C.teachersTab}</SectionLabel>
          {[...data.teachers].sort(bySince).map((t) => <TeacherCard key={t.teacherExtId || t.name} t={t} />)}

          <SectionLabel>{C.manage}</SectionLabel>
          <div data-testid="manage" className="flex flex-col gap-2.5">
            <TapRow to={`${base}/add-teacher`}>
              <IconTile hue="neutral"><UserPlus className="h-6 w-6" /></IconTile>
              <RowText name={C.addTeacher} />
            </TapRow>
            {data.teachers.length > 0 && (
              <TapRow to={`${base}/remove-teachers`}>
                <IconTile hue="neutral"><UserMinus className="h-6 w-6" /></IconTile>
                <RowText name={C.removeTeachers} />
              </TapRow>
            )}
            <button type="button" onClick={() => setAsking(true)}
              className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold text-[#c8331f]">
              <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />{C.removeSchool}
            </button>
            {error && <div className="flex" data-testid="school-error"><StatusChip text={C.saveFailed} tone="waiting" /></div>}
          </div>

          <ConfirmTray open={asking} title={s.name || C.dash} onClose={() => setAsking(false)}
            line={C.lines.removeSchool} confirmLabel={C.removeSchool} confirmIcon={Trash2} confirmTone="danger"
            onConfirm={removeSchool} cancelLabel={C.keep} closeLabel={C.back} />
        </>
      )}
    </PeopleFrame>
  );
};

export default CoachSchool;
