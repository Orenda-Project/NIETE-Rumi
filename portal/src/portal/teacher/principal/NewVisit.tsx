import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CoachPage, Loading, Failed, useLoad } from "../../coach/ui";
import { TimeStep, Done, type NewVisitLinks } from "../../coach/pages/CoachNewVisit";
import type { CoachTeacher } from "../../coach/types";
import { useCopy } from "../i18n";
import { SCHEDULE } from "../../coach/schedule/copy";
import { PRINCIPAL_PICK, PRINCIPAL_SCHEDULE, principalVisit } from "./observe";

/**
 * bd-31ziu8 — a principal books a visit exactly as a coach does (operator 18 Nov ~16:40: "the principal does not do
 * scheduling? If that is the case, drop it. It has to be the same as coach."): the teacher she picked (her own school's,
 * Pick the teacher) → the coach's day and time step → "Visit scheduled" → My schedule. The booking is the coach's
 * (POST /leader/schedules: the server checks the teacher is in her own school) and so is the teacher's visit notice.
 */
const LINKS: NewVisitLinks = {
  changeSchool: PRINCIPAL_PICK,
  changeTeacher: () => PRINCIPAL_PICK,
  newVisit: PRINCIPAL_PICK,
  schedule: PRINCIPAL_SCHEDULE,
};

export function PrincipalNewVisit() {
  const c = useCopy(SCHEDULE);
  const [params] = useSearchParams();
  const ext = params.get("teacher") || "";
  const visitId = params.get("visit");
  const initialSlot = params.get("slot");
  const { data, failed, reload } = useLoad(() => principalVisit(ext), [ext]);
  const [done, setDone] = useState<{ date: string; slot: string } | null>(null);
  const teacher: CoachTeacher | undefined = useMemo(() => {
    const v = data?.visit;
    if (!v) return undefined;
    return {
      teacherExtId: v.teacherExtId ?? ext,
      name: v.teacherName ?? "",
      phone: v.teacherExtId ?? ext,
      schoolName: v.schoolName ?? null,
      emis: null,
      schoolExtId: v.schoolExtId ?? null,
      hitl: 0,
      dc: 0,
      avgHitl: null,
      daysSinceVisit: null,
      daysSinceTraining: null,
    };
  }, [data]);
  const schoolName = data?.visit?.schoolName ?? null;
  return (
    <CoachPage title={visitId ? c.reschedule : c.newVisit} crumb={c.crumb} backTo={PRINCIPAL_PICK}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && done && <Done teacher={teacher} schoolName={schoolName} when={done} links={LINKS} />}
      {data && !done && (
        <TimeStep teacher={teacher} schoolName={schoolName} visitId={visitId} initialSlot={initialSlot} onDone={setDone} links={LINKS} />
      )}
    </CoachPage>
  );
}
