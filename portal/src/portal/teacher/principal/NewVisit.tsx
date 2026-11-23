import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { CoachPage, Loading, Failed, useLoad } from "../../coach/ui";
import { TimeStep, Done, WhenStep, ScheduledV6, type NewVisitLinks } from "../../coach/pages/CoachNewVisit";
import type { CoachTeacher } from "../../coach/types";
import { useCopy } from "../i18n";
import { SCHEDULE } from "../../coach/schedule/copy";
import { FLOW_V6 } from "../../coach/flow/copy";
import { useFlowV6 } from "../../coach/flow/useCoachFlowV2";
import { trackFlow } from "../../coach/flow/track";
import ObservePage from "../../coach/observe/ObservePage";
import { OBSERVATIONS } from "../observations/copy";
import { OBS_HOME } from "../observations/paths";
import { PRINCIPAL_OBSERVE_ROUTES, PRINCIPAL_PICK, PRINCIPAL_SCHEDULE, principalNewVisitPath, principalVisit } from "./observe";

/**
 * bd-31ziu8 — a principal books a visit exactly as a coach does (operator 18 Nov ~16:40: "the principal does not do
 * scheduling? If that is the case, drop it. It has to be the same as coach."): the teacher she picked (her own school's,
 * Pick the teacher) → the coach's day and time step → "Visit scheduled" → My schedule. The booking is the coach's
 * (POST /leader/schedules: the server checks the teacher is in her own school) and so is the teacher's visit notice.
 *
 * bd-o15qnr.27 (queue #204, v6; the operator 20 Nov ~14:40: "For the Coach and the Principal both, we need to get this
 * HITL feature live"; ~14:50: "On Portal") — with the v6 switch on for her (principalFlowV2), the picked teacher opens the
 * coach's When? step: Schedule for Now goes straight to that teacher's record or upload screen (the principal app books
 * nothing for an observation, so nothing reaches the teacher), Schedule for Later is the day and time above, then
 * "Observation scheduled" with her own links. Switch off, Reschedule: as before.
 *
 * bd-o15qnr.29 (the operator 21 Nov ~08:50: "They should land on the homepage of obsevrations") — Done goes to Observe
 * (Observations), never the old My schedule page.
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
  const F = useCopy(FLOW_V6);
  const O = useCopy(OBSERVATIONS);
  const flowRead = useFlowV6();
  const v6 = flowRead === true && !visitId;
  const later = v6 && params.get("when") === "later";
  if (flowRead === null && !visitId) {
    return <CoachPage title={c.newVisit} crumb={c.crumb} backTo={PRINCIPAL_PICK}><Loading /></CoachPage>;
  }
  if (v6) {
    const whenPath = principalNewVisitPath(ext);
    return (
      <ObservePage title={F.scheduleObservation} crumb={O.title} backTo={later ? whenPath : PRINCIPAL_PICK} feature="observations" banner={false} whatsapp={false}>
        {failed && <Failed onRetry={reload} />}
        {!data && !failed && <Loading />}
        {data && done && (
          <ScheduledV6 teacher={teacher} schoolName={schoolName} when={done} doneTo={OBS_HOME} anotherTo={PRINCIPAL_PICK}
            line={F.whatsappMessage(teacher?.name)} />
        )}
        {data && !done && teacher && !later && (
          <WhenStep teacher={teacher} schoolName={schoolName} changeTo={PRINCIPAL_PICK} laterTo={`${whenPath}&when=later`}
            onNow={async (kind) => (kind === "record" ? PRINCIPAL_OBSERVE_ROUTES.record(ext) : PRINCIPAL_OBSERVE_ROUTES.attach(ext))} />
        )}
        {data && !done && later && (
          <TimeStep teacher={teacher} schoolName={schoolName} visitId={null} initialSlot={initialSlot} links={LINKS}
            onDone={(when) => { trackFlow("schedule.later"); setDone(when); }}
            note={(
              <p className="m-0 flex items-center gap-2 px-1 text-[14px] text-[#4b5563]">
                <MessageCircle className="h-4 w-4 shrink-0 text-[#48b078]" aria-hidden="true" /><span>{F.whatsappMessage(teacher?.name)}</span>
              </p>
            )} />
        )}
      </ObservePage>
    );
  }
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
