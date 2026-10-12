import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { HistoryRow, StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { Stats } from "../ui";
import type { CoachSchool, CoachTeacher } from "../types";
import { PEOPLE } from "./copy";
import { visitChip } from "./visitStatus";

/**
 * bd-4404s7.6 — the rows of Schools and Teachers, on the kit's HistoryRow with a coach lead: a ROUND 48px avatar
 * (`lead="school"` glyph, `lead="person"` initials), never the square grade·subject column. Each card is a white
 * list card that clips its rows; the flat numbers under a row are the coach-local `Stats` until the kit's StatStrip
 * (bd-4404s7.1 PR 2c) replaces them.
 */

const CARD = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]";

/** A school in the Schools tab: avatar, name, teachers, the visit-status chip, then four flat numbers. */
export function SchoolCard({ s }: { s: CoachSchool }) {
  const C = useCopy(PEOPLE);
  return (
    <section data-testid="school-card" className={CARD}>
      <HistoryRow lead="school" wrapTitle title={s.name || C.dash} extra={C.teachersN(s.teachers)} chip={visitChip(s.daysSinceVisit, C)}
        to={`/portal/coach/school/${encodeURIComponent(s.emis || "")}`} />
      <Stats items={[
        { value: s.visits, label: C.visitsCol }, { value: C.daysShort(s.daysSinceVisit), label: C.sinceVisit },
        { value: s.teachers, label: C.teachersCol }, { value: C.pct(s.avgHitl), label: C.avgHitl },
      ]} />
    </section>
  );
}

/** A teacher on a school's page: avatar, name, then five flat numbers. */
export function TeacherCard({ t }: { t: CoachTeacher }) {
  const C = useCopy(PEOPLE);
  return (
    <section data-testid="teacher-card" className={CARD}>
      <HistoryRow lead="person" wrapTitle title={t.name} action={t.teacherExtId ? "chevron" : "none"} to={t.teacherExtId ? `/portal/coach/teacher/${t.teacherExtId}` : undefined} />
      <Stats items={[
        { value: C.daysShort(t.daysSinceVisit), label: C.sinceVisit }, { value: t.hitl, label: C.hitl },
        { value: t.dc, label: C.dc }, { value: C.pct(t.avgHitl), label: C.avgHitl }, { value: C.daysShort(t.daysSinceTraining), label: C.trainingCol },
      ]} />
    </section>
  );
}

/**
 * A school in the grouped Teachers list. The school's own row is information; the 56px toggle at its end opens the
 * school IN PLACE to its first two teachers (in the page's sort order), and "Show all N" reveals the rest.
 */
export function SchoolGroup({ id, name, teachers, defaultOpen }: { id: string; name: string; teachers: CoachTeacher[]; defaultOpen: boolean }) {
  const C = useCopy(PEOPLE);
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const shown = all ? teachers : teachers.slice(0, 2);
  return (
    <section data-testid="school-group" data-school={id} className={CARD}>
      <div className="flex items-stretch bg-white">
        <div className="min-w-0 flex-1">
          <HistoryRow lead="school" wrapTitle title={name} extra={C.teachersN(teachers.length)} action="none" />
        </div>
        <button type="button" data-testid="school-toggle" aria-expanded={open} aria-label={name} onClick={() => setOpen((o) => !o)}
          className="flex min-h-[56px] w-14 shrink-0 items-center justify-center text-[#33374a]">
          <ChevronDown className={`h-6 w-6 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="border-t border-[#e5e7eb]">
          {shown.map((t, i) => (
            <div key={t.teacherExtId || t.name} data-testid="teacher-row">
              <HistoryRow lead="person" wrapTitle title={t.name} extra={C.lastVisitDays(t.daysSinceVisit)} first={i === 0}
                action={t.teacherExtId ? "chevron" : "none"} to={t.teacherExtId ? `/portal/coach/teacher/${t.teacherExtId}` : undefined} />
            </div>
          ))}
          {!all && teachers.length > 2 && (
            <button type="button" onClick={() => setAll(true)}
              className="flex min-h-[56px] w-full items-center justify-center gap-1.5 border-t border-[#e5e7eb] bg-white text-[15px] font-bold text-[#33374a]">
              {C.showAllN(teachers.length)}<ChevronDown className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** "Nothing here yet" as ONE slim row (icon and a few words, ~64px), never a dashed card (12 Oct decision). */
export function EmptyRow({ icon, children, testId }: { icon: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[16px] font-semibold text-[#6b7280]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[#9ca3af]" aria-hidden="true">{icon}</span>
      {children}
    </div>
  );
}

/** What the page that sent her here just did ("Added", "Removed 2 teachers"): `location.state.notice`, a done chip. */
export type NoticeState = { notice?: string; tellTeam?: boolean };

export function useNotice(): NoticeState {
  const loc = useLocation();
  const st = (loc.state || {}) as NoticeState;
  return { notice: typeof st.notice === "string" ? st.notice : undefined, tellTeam: !!st.tellTeam };
}

export function Notice({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="flex" data-testid="notice" role="status">
      <StatusChip text={text} tone="done" tick className="h-auto min-h-[26px] whitespace-normal py-1" />
    </div>
  );
}

