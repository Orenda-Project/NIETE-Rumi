import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, School } from "lucide-react";
import { StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { Chevron, IconCircle, Initials, RowText, Stats } from "../ui";
import type { CoachSchool, CoachTeacher } from "../types";
import { PEOPLE } from "./copy";
import { visitChip } from "./visitStatus";

/**
 * bd-4404s7.6 — the rows of Schools and Teachers. Coach rows use a ROUND 48px avatar (the square grade-subject tile is
 * only for a grade and a subject); a long name wraps in full. These stay coach-local until the kit's HistoryRow takes
 * `lead="person" | "school"` (bd-4404s7.1), then each `Row` body becomes that.
 */

const CARD = "block min-h-[76px] overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]";

/** A school in the Schools tab: avatar, name, teachers, the visit-status chip, then four flat numbers. */
export function SchoolCard({ s }: { s: CoachSchool }) {
  const C = useCopy(PEOPLE);
  return (
    <Link to={`/portal/coach/school/${encodeURIComponent(s.emis || "")}`} className={`${CARD} hover:bg-[#f9fafb]`}>
      <span data-testid="school-card" className="flex flex-col">
        <span className="flex min-h-[76px] items-center gap-3 p-2.5 ps-3.5">
          <IconCircle hue="neutral" size={48}><School className="h-6 w-6" aria-hidden="true" /></IconCircle>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <RowText wrap name={s.name || C.dash} />
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-[#6b7280]">{C.teachersN(s.teachers)}</span>
              <StatusChip {...visitChip(s.daysSinceVisit, C)} />
            </span>
          </span>
          <Chevron />
        </span>
        <Stats items={[
          { value: s.visits, label: C.visitsCol }, { value: C.daysShort(s.daysSinceVisit), label: C.sinceVisit },
          { value: s.teachers, label: C.teachersCol }, { value: C.pct(s.avgHitl), label: C.avgHitl },
        ]} />
      </span>
    </Link>
  );
}

/** A teacher on a school's page: avatar, name, then five flat numbers. */
export function TeacherCard({ t }: { t: CoachTeacher }) {
  const C = useCopy(PEOPLE);
  const body = (
    <span data-testid="teacher-card" className="flex flex-col">
      <span className="flex min-h-[76px] items-center gap-3 p-2.5 ps-3.5">
        <Initials name={t.name} round />
        <RowText wrap name={t.name} />
        {t.teacherExtId && <Chevron />}
      </span>
      <Stats items={[
        { value: C.daysShort(t.daysSinceVisit), label: C.sinceVisit }, { value: t.hitl, label: C.hitl },
        { value: t.dc, label: C.dc }, { value: C.pct(t.avgHitl), label: C.avgHitl }, { value: C.daysShort(t.daysSinceTraining), label: C.trainingCol },
      ]} />
    </span>
  );
  return t.teacherExtId
    ? <Link to={`/portal/coach/teacher/${t.teacherExtId}`} className={`${CARD} hover:bg-[#f9fafb]`}>{body}</Link>
    : <div className={CARD}>{body}</div>;
}

function TeacherRow({ t, first }: { t: CoachTeacher; first: boolean }) {
  const C = useCopy(PEOPLE);
  const inner = (
    <span data-testid="teacher-row" className="flex min-h-[76px] items-center gap-3 p-2.5 ps-3.5">
      <Initials name={t.name} round />
      <RowText wrap name={t.name} sub={C.lastVisitDays(t.daysSinceVisit)} />
      {t.teacherExtId && <Chevron />}
    </span>
  );
  const edge = first ? "" : "border-t border-[#e5e7eb]";
  return t.teacherExtId
    ? <Link to={`/portal/coach/teacher/${t.teacherExtId}`} className={`block min-h-[76px] hover:bg-[#f9fafb] ${edge}`}>{inner}</Link>
    : <div className={edge}>{inner}</div>;
}

/**
 * A school in the grouped Teachers list. The header is one big toggle: the school opens IN PLACE to its first two
 * teachers (in the page's sort order), and "Show all N" reveals the rest.
 */
export function SchoolGroup({ id, name, teachers, defaultOpen }: { id: string; name: string; teachers: CoachTeacher[]; defaultOpen: boolean }) {
  const C = useCopy(PEOPLE);
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const shown = all ? teachers : teachers.slice(0, 2);
  return (
    <section data-testid="school-group" data-school={id} className={CARD}>
      <button type="button" data-testid="school-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex min-h-[76px] w-full items-center gap-3 p-2.5 ps-3.5 text-start">
        <IconCircle hue="neutral" size={48}><School className="h-6 w-6" aria-hidden="true" /></IconCircle>
        <RowText wrap name={name} sub={C.teachersN(teachers.length)} />
        <span className="flex h-14 w-10 shrink-0 items-center justify-center text-[#33374a]" aria-hidden="true">
          <ChevronDown className={`h-6 w-6 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="border-t border-[#e5e7eb]">
          {shown.map((t, i) => <TeacherRow key={t.teacherExtId || t.name} t={t} first={i === 0} />)}
          {!all && teachers.length > 2 && (
            <button type="button" onClick={() => setAll(true)}
              className="flex min-h-[56px] w-full items-center justify-center gap-1.5 border-t border-[#e5e7eb] text-[15px] font-bold text-[#33374a]">
              {C.showAllN(teachers.length)}<ChevronDown className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
