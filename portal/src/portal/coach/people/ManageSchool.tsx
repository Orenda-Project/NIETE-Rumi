import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, UserMinus, UserPen, UserPlus } from "lucide-react";
import { ConfirmTray, StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import { SectionLabel, TapRow, IconTile, RowText } from "../ui";
import { PEOPLE } from "./copy";
import { useLevel, withLevel } from "./level";

/**
 * A school's Manage group (Blueprint: Coach · Manage schools and teachers), the WhatsApp /observe "Manage teachers" for
 * THIS school: Add a teacher, Edit teacher (bd-ewbzns.2: her name, number, role, teaching level, school; the list it
 * opens keeps the page's teaching level), Remove teachers, and Remove school. Removing the school asks first (the kit's ConfirmTray)
 * and takes only HER link: the teachers stay at the school, for every other coach who holds it. One component, on the
 * school's page and on its School card.
 */
export default function ManageSchool({ emis, name, teacherCount }: { emis: string; name: string | null | undefined; teacherCount: number }) {
  const C = useCopy(PEOPLE);
  const navigate = useNavigate();
  const [level] = useLevel();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const removeSchool = async () => {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      await coach.removeSchool(emis);
      navigate("/portal/coach/people", { replace: true, state: { notice: C.removedName(name || emis) } });
    } catch {
      setAsking(false); setError(true);
    } finally { setBusy(false); }
  };

  const base = `/portal/coach/school/${encodeURIComponent(emis)}`;
  return (
    <>
      <SectionLabel>{C.manage}</SectionLabel>
      <div data-testid="manage" className="flex flex-col gap-2.5">
        <TapRow to={`${base}/add-teacher`}>
          <IconTile hue="neutral"><UserPlus className="h-6 w-6" /></IconTile>
          <RowText name={C.addTeacher} />
        </TapRow>
        {teacherCount > 0 && (
          <TapRow to={withLevel(`${base}/edit-teacher`, level)}>
            <IconTile hue="neutral"><UserPen className="h-6 w-6" /></IconTile>
            <RowText name={C.editTeacher} />
          </TapRow>
        )}
        {teacherCount > 0 && (
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

      <ConfirmTray open={asking} title={name || C.dash} onClose={() => setAsking(false)}
        line={C.lines.removeSchool} confirmLabel={C.removeSchool} confirmIcon={Trash2} confirmTone="danger"
        onConfirm={removeSchool} cancelLabel={C.keep} closeLabel={C.back} />
    </>
  );
}
