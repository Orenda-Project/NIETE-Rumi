import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, TriangleAlert, Trash2 } from "lucide-react";
import { HistoryRow, StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import type { CoachTeacher } from "../types";
import { BottomButton, Loading, useLoad, Initials } from "../ui";
import { PEOPLE } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";

/**
 * Remove teachers from one of her schools (Blueprint: Coach · Manage schools and teachers, boards
 * Coach_RemoveTeachers and Coach_RemoveTeachersConfirm) — the WhatsApp /observe "Manage teachers → Remove a teacher",
 * several at once, as there.
 *
 * Two screens: tick up to 30 (the /observe batch cap), then check the list. The check says what removal MEANS, because
 * it is not what a coach expects: the teacher leaves the SCHOOL, so she comes off every coach's list who holds it;
 * her account and history are kept; her booked visits at that school are cancelled. An optional reason is saved with
 * each removal. Only people with an account can be removed (a roster name with no account has nothing to take off).
 */
const MAX = 30;

const CoachRemoveTeachers = () => {
  const C = useCopy(PEOPLE);
  const { emis = "" } = useParams();
  const navigate = useNavigate();
  const { data, failed, reload } = useLoad(() => coach.getSchool(emis), [emis]);
  const [ticked, setTicked] = useState<string[]>([]);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const back = `/portal/coach/school/${encodeURIComponent(emis)}`;

  const people: CoachTeacher[] = (data?.teachers || [])
    .filter((t) => t.teacherExtId && t.onRumi !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
  const chosen = people.filter((t) => ticked.includes(t.teacherExtId as string));
  const toggle = (ext: string) => setTicked((cur) => (cur.includes(ext) ? cur.filter((x) => x !== ext) : cur.length >= MAX ? cur : [...cur, ext]));

  const remove = async () => {
    if (!chosen.length || busy) return;
    setBusy(true); setError(false);
    try {
      const r = await coach.removeTeachers(emis, chosen.map((t) => t.teacherExtId as string), reason.trim());
      navigate(back, { replace: true, state: { notice: C.removedN((r.removed || []).length) } });
    } catch {
      setError(true);
    } finally { setBusy(false); }
  };

  const dock = !data ? undefined
    : step === "pick"
      ? <BottomButton onClick={() => setStep("confirm")} disabled={!chosen.length}>{chosen.length ? C.nextN(chosen.length) : C.next}</BottomButton>
      : <BottomButton tone="danger" onClick={remove} disabled={busy}><Trash2 className="h-5 w-5" aria-hidden="true" />{C.removeN(chosen.length)}</BottomButton>;

  const card = "overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]";
  return (
    <PeopleFrame title={C.removeTeachers} crumb={data?.school?.name || C.dash} backTo={back} feature="schools" dock={dock}>
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {data && step === "pick" && (
        <>
          <p className="m-0 px-1 text-[13px] font-semibold text-[#6b7280]">{C.upTo30}</p>
          <section className={card} role="group" aria-label={C.removeTeachers}>
            {people.map((t, i) => {
              const on = ticked.includes(t.teacherExtId as string);
              const full = !on && ticked.length >= MAX;
              return (
                <button key={t.teacherExtId} type="button" role="checkbox" aria-checked={on} aria-label={t.name} disabled={full}
                  onClick={() => toggle(t.teacherExtId as string)}
                  className={`flex min-h-[76px] w-full items-center gap-3 px-3.5 text-start disabled:opacity-50 ${i > 0 ? "border-t border-[#e5e7eb]" : ""} ${on ? "bg-[#f4f5f8]" : "bg-white"}`}>
                  <Initials name={t.name} round />
                  <span className="min-w-0 flex-1 break-words text-[17px] font-semibold [overflow-wrap:anywhere]" dir="auto">{t.name}</span>
                  <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-2 ${on ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#c7cad6] bg-white"}`}>
                    {on && <Check className="h-4 w-4" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </section>
        </>
      )}
      {data && step === "confirm" && (
        <>
          <section className={card} data-testid="remove-list">
            {chosen.map((t, i) => (
              <HistoryRow key={t.teacherExtId} lead="person" wrapTitle first={i === 0} title={t.name} action="none" />
            ))}
          </section>
          <p role="note" className="m-0 flex gap-2.5 rounded-2xl bg-[#fef3c7] px-3.5 py-3 text-[15px] font-medium leading-snug text-[#b45309]">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{C.lines.removeTeachersWarn}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <StatusChip text={C.accountKept} tone="info" />
            <StatusChip text={C.visitsCancelled} tone="info" />
          </div>
          <label className="flex flex-col gap-2">
            <span className="px-1 text-sm font-semibold text-[#4b5563]">{C.reasonOptional}</span>
            <input aria-label={C.reasonOptional} type="text" dir="auto" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)}
              className="min-h-[56px] w-full rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[17px] font-medium text-[#1d2025] outline-none focus:border-[#33374a] focus:ring-1 focus:ring-[#33374a]" />
          </label>
          {error && <div className="flex" data-testid="remove-error"><StatusChip text={C.saveFailed} tone="waiting" /></div>}
        </>
      )}
    </PeopleFrame>
  );
};

export default CoachRemoveTeachers;
