import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, School, UserPlus } from "lucide-react";
import { ChosenSoFar, HistoryRow, StatusChip } from "../../teacher/ui";
import type { ChipData } from "../../teacher/ui/styles";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import type { TeacherPlan } from "../types";
import { BottomButton, BottomLink, Loading, useLoad, formatPhone, Initials } from "../ui";
import { PEOPLE, PEOPLE_EN } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";

type Words = typeof PEOPLE_EN;

/**
 * Add a teacher to one of her schools by WhatsApp number (Blueprint: Coach · Manage schools and teachers, boards
 * Coach_AddTeacherPickSchool / Number / Name / Confirm) — the WhatsApp /observe "Manage teachers → Add a teacher",
 * one question per screen (the WhatsApp-flow form pattern): the number; her name, only when nobody has it yet; then
 * what will happen, and one Add teacher.
 *
 * Nothing is written until Add teacher. Check number only READS (the /observe planAdd) and answers one of three:
 *   new           nobody has this number: a name is asked for, then a new teacher at this school;
 *   move          someone on record elsewhere (or nowhere): shown from where to here, and moved (the /observe add IS
 *                 how a teacher changes school);
 *   already_here  nothing to change.
 * A coach's number and a number that is not a Pakistani mobile are refused on the number screen.
 *
 * From the Teachers tab there is no school yet (`/portal/coach/add-teacher`): she picks one of hers first.
 */
type Step = "number" | "name" | "confirm";

/** The refusal's `reason` from an HTTP error (the coach API answers refusals as 4xx with `{ reason }`). */
const reasonOf = (e: unknown): string | undefined => (e as { response?: { data?: { reason?: string } } } | null)?.response?.data?.reason;

function reasonText(C: Words, reason: string | undefined): string {
  switch (reason) {
    case "invalid_phone": return C.phoneInvalid;
    case "is_coach": return C.isCoach;
    case "name_required": return C.nameNeeded;
    case "not_my_school": case "not_found": return C.notYourSchool;
    default: return C.saveFailed;
  }
}

function PickSchool() {
  const C = useCopy(PEOPLE);
  const { data, failed, reload } = useLoad(() => coach.getPeople(), []);
  return (
    <PeopleFrame title={C.addTeacher} crumb={C.title} backTo="/portal/coach/people?tab=teachers" feature="schools">
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && data.schools.length === 0 && (
        <>
          <EmptyRow icon={<School className="h-5 w-5" />}>{C.noSchoolsYet}</EmptyRow>
          <div className="flex"><BottomLink to="/portal/coach/schools/add">{C.addSchool}</BottomLink></div>
        </>
      )}
      {data && data.schools.length > 0 && (
        <>
          <h2 className="mx-1 mt-1 text-sm font-semibold text-[#4b5563]">{C.schoolLabel}</h2>
          <section className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
            {data.schools.map((s, i) => (
              <HistoryRow key={s.schoolExtId} lead="school" wrapTitle first={i === 0} title={s.name || C.dash} extra={C.teachersN(s.teachers)}
                to={`/portal/coach/school/${encodeURIComponent(s.emis || "")}/add-teacher`} />
            ))}
          </section>
        </>
      )}
    </PeopleFrame>
  );
}

function AddToSchool({ emis }: { emis: string }) {
  const C = useCopy(PEOPLE);
  const navigate = useNavigate();
  const { data, failed, reload } = useLoad(() => coach.getSchool(emis), [emis]);
  const [step, setStep] = useState<Step>("number");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<TeacherPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schoolName = data?.school?.name || C.dash;
  const back = `/portal/coach/school/${encodeURIComponent(emis)}`;

  const check = async () => {
    if (!phone.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await coach.checkTeacher(emis, phone.trim());
      setPlan(r);
      setStep(r.outcome === "new" ? "name" : "confirm");
    } catch (e) {
      setError(reasonText(C, reasonOf(e)));
    } finally { setBusy(false); }
  };

  const add = async () => {
    if (!plan || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await coach.addTeacher(emis, plan.phone || phone.trim(), plan.outcome === "new" ? name.trim() : "");
      navigate(back, { replace: true, state: { notice: C.teacherAdded(r.name || plan.name || name.trim()) } });
    } catch (e) {
      setError(reasonText(C, reasonOf(e)));
    } finally { setBusy(false); }
  };

  const restart = () => { setStep("number"); setPlan(null); setName(""); setError(null); };
  const label = "px-1 text-sm font-semibold text-[#4b5563]";
  const input = "min-h-[56px] w-full rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[17px] font-medium text-[#1d2025] outline-none focus:border-[#33374a] focus:ring-1 focus:ring-[#33374a]";

  const chip: ChipData | null = !plan ? null
    : plan.outcome === "new" ? { text: C.newTeacher, tone: "info" }
      : plan.outcome === "move" ? { text: C.changesSchool, tone: "waiting" }
        : { text: C.alreadyHere, tone: "done" };

  const dock = !data ? undefined
    : step === "number" ? <BottomButton onClick={check} disabled={!phone.trim() || busy}>{C.checkNumber}</BottomButton>
      : step === "name" ? <BottomButton onClick={() => setStep("confirm")} disabled={!name.trim()}>{C.next}</BottomButton>
        : plan?.outcome === "already_here" ? <BottomLink to={back} tone="outline">{C.back}</BottomLink>
          : <BottomButton onClick={add} disabled={busy}><Check className="h-5 w-5" aria-hidden="true" />{C.addTeacherBtn}</BottomButton>;

  return (
    <PeopleFrame title={C.addTeacher} crumb={schoolName} backTo={back} feature="schools" dock={dock}>
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && step === "number" && (
        <label className="flex flex-col gap-2">
          <span className={label}>{C.whatsappNumber}</span>
          <input aria-label={C.whatsappNumber} className={input} type="tel" inputMode="tel" dir="ltr" autoComplete="off"
            value={phone} onChange={(e) => { setPhone(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") check(); }} />
        </label>
      )}
      {data && step !== "number" && plan && (
        <ChosenSoFar items={[{ label: C.whatsappNumber, value: formatPhone(plan.phone) || plan.phone || "", onChange: restart }]}
          copy={{ change: C.change }} />
      )}
      {data && step === "name" && (
        <>
          {chip && <div className="flex"><StatusChip text={chip.text} tone={chip.tone} /></div>}
          <label className="flex flex-col gap-2">
            <span className={label}>{C.fullName}</span>
            <input aria-label={C.fullName} className={input} type="text" dir="auto" autoComplete="off"
              value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </>
      )}
      {data && step === "confirm" && plan && (
        <>
          <section data-testid="teacher-plan" className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
            <div className="flex min-h-[76px] items-center gap-3 px-3.5 py-3">
              <Initials name={plan.name || name} round />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="break-words text-[17px] font-semibold [overflow-wrap:anywhere]" dir="auto">{plan.name || name.trim()}</span>
                <StatusChip text={plan.isPrincipal ? C.rolePrincipal : C.roleTeacher} tone="info" />
              </span>
            </div>
            <dl className="m-0 border-t border-[#e5e7eb]">
              {plan.outcome !== "new" && (
                <div className="flex min-h-[56px] items-center gap-3 px-3.5">
                  <dt className="w-32 shrink-0 text-[14px] font-semibold text-[#6b7280]">{C.currentSchool}</dt>
                  <dd className="m-0 min-w-0 flex-1 text-[16px] font-semibold" dir="auto">{plan.fromSchoolName || C.noSchool}</dd>
                </div>
              )}
              <div className="flex min-h-[56px] items-center gap-3 border-t border-[#eef0f3] px-3.5 first:border-t-0">
                <dt className="w-32 shrink-0 text-[14px] font-semibold text-[#6b7280]">{C.newSchool}</dt>
                <dd className="m-0 min-w-0 flex-1 text-[16px] font-semibold" dir="auto">{plan.toSchoolName || schoolName}</dd>
              </div>
            </dl>
          </section>
          {chip && <div className="flex"><StatusChip text={chip.text} tone={chip.tone} /></div>}
        </>
      )}
      {error && <div className="flex" data-testid="add-error"><StatusChip text={error} tone="waiting" className="h-auto min-h-[26px] whitespace-normal py-1" /></div>}
    </PeopleFrame>
  );
}

const CoachAddTeacher = () => {
  const { emis } = useParams();
  return emis ? <AddToSchool emis={emis} /> : <PickSchool />;
};

export default CoachAddTeacher;
