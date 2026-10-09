import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, School, Trash2 } from "lucide-react";
import { coach } from "../../services/api";
import { StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { SelectBox, BottomButton, Loading, useLoad, formatPhone } from "../ui";
import { PEOPLE, PEOPLE_EN } from "../people/copy";
import PeopleFrame, { LoadFailed } from "../people/PeopleFrame";

type Words = typeof PEOPLE_EN;

/**
 * bd-o15qnr.11 + .13 — Edit teacher (v22 EditTeacher.dc.html).
 *
 * Every field saves the way WhatsApp /observe saves it:
 *   · Name, Role, Teaching level, Phone → main's /observe "Edit a teacher" path,
 *     ported to the bot (teacher-edit-commit.service);
 *   · School → commitAdd (moves her); Remove from school → commitRemovals.
 * Phone is CHECKED first (main's teacher_edit_phone_check): a free number, an
 * account that gets folded in, or a real teacher's number — refused, with main's
 * words — and changed only when the coach confirms.
 */
const LEVELS = ["PRIMARY", "MIDDLE", "HIGH"] as const;
type Role = "teacher" | "principal";

function reasonText(C: Words, data: any): string {
  switch (data?.reason) {
    case "not_found": return C.editNotYours;
    case "not_my_school": return C.notYourSchool;
    case "cooldown": return C.levelLocked(data?.hoursRemaining);
    case "name_required": return C.nameNeeded;
    case "empty_selection": return C.pickLevel;
    case "invalid_phone": return C.phoneInvalid;
    default: return C.saveFailed;
  }
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

type PhoneResult = { kind: "free" | "shell" | "same"; phone: string } | { kind: "refused"; text: string } | null;

const CoachEditTeacher = () => {
  const C = useCopy(PEOPLE);
  const { ext = "" } = useParams();
  const navigate = useNavigate();
  const { data, failed, reload } = useLoad(() => coach.getTeacher(ext), [ext]);
  const { data: people } = useLoad(() => coach.getPeople(), []);
  const t = data?.teacher;

  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("teacher");
  const [levels, setLevels] = useState<string[]>([]);
  const [school, setSchool] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneResult, setPhoneResult] = useState<PhoneResult>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!t) return;
    setName(t.name || "");
    setRole(t.isPrincipal ? "principal" : "teacher");
    setLevels(t.levels || []);
    setSchool(t.schoolExtId || "");
  }, [t]);

  const options = (people?.schools || []).map((s) => ({ value: s.schoolExtId, label: s.name }));
  if (t?.schoolExtId && !options.some((o) => o.value === t.schoolExtId)) {
    options.unshift({ value: t.schoolExtId, label: t.schoolName || t.schoolExtId });
  }

  const startRole: Role = t?.isPrincipal ? "principal" : "teacher";
  const changes = {
    name: !!t && name.trim() !== "" && name.trim() !== (t.name || "").trim(),
    role: !!t && role !== startRole,
    level: !!t && !sameSet(levels, t.levels || []),
    school: !!t && !!school && school !== t.schoolExtId,
  };
  const dirty = changes.name || changes.role || changes.level || changes.school;

  const toggleLevel = (b: string) => {
    setError(null);
    setLevels((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : LEVELS.filter((x) => x === b || cur.includes(x))));
  };

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true); setError(null);
    try {
      // One field at a time, each through its own /observe writer.
      if (changes.name) await coach.editTeacher(ext, "name", name.trim());
      if (changes.role) await coach.editTeacher(ext, "role", role);
      if (changes.level) await coach.editTeacher(ext, "level", LEVELS.filter((b) => levels.includes(b)));
      if (changes.school) await coach.moveTeacher(ext, school);
      navigate(`/portal/coach/teacher/${ext}`);
    } catch (e: any) {
      setError(reasonText(C, e?.response?.data));
      reload();
    } finally { setBusy(false); }
  };

  const checkPhone = async () => {
    if (!phone.trim() || busy) return;
    setBusy(true); setPhoneResult(null);
    try {
      const r = await coach.editTeacher(ext, "phone_check", phone.trim());
      const kind = r.outcome === "shell" ? "shell" : r.outcome === "unchanged" ? "same" : "free";
      setPhoneResult({ kind, phone: r.phone || "" });
    } catch (e: any) {
      const d = e?.response?.data;
      setPhoneResult({ kind: "refused", text: d?.reason === "taken" ? (d?.heading || C.saveFailed) : reasonText(C, d) });
    } finally { setBusy(false); }
  };

  const changePhone = async () => {
    if (!phoneResult || (phoneResult.kind !== "free" && phoneResult.kind !== "shell") || busy) return;
    setBusy(true);
    try {
      const r = await coach.editTeacher(ext, "phone", phoneResult.phone);
      // Her id in the app IS her number: open her page at the new one.
      navigate(`/portal/coach/teacher/${r.phone || phoneResult.phone}`);
    } catch (e: any) {
      const d = e?.response?.data;
      setPhoneResult({ kind: "refused", text: d?.reason === "taken" ? (d?.heading || C.saveFailed) : reasonText(C, d) });
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await coach.removeTeacher(ext);
      navigate(t?.emis ? `/portal/coach/school/${t.emis}` : "/portal/coach/people");
    } catch (e: any) { setError(reasonText(C, e?.response?.data)); setConfirmRemove(false); } finally { setBusy(false); }
  };

  const label = "px-1 text-sm font-semibold text-[#4b5563]";
  const input = "min-h-[56px] w-full rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[17px] font-medium text-[#1d2025] outline-none focus:border-[#33374a] focus:ring-1 focus:ring-[#33374a]";
  const pill = (on: boolean) => `flex min-h-[56px] flex-1 items-center justify-center rounded-xl text-base font-semibold ${on ? "bg-[#33374a] text-white" : "text-[#4b5563]"}`;

  return (
    <PeopleFrame title={C.editTeacher} crumb={t?.name || undefined} backTo={`/portal/coach/teacher/${ext}`}
      dock={t ? (
        <BottomButton onClick={save} disabled={!dirty || busy}>
          <Check className="h-5 w-5" aria-hidden="true" />{C.save}
        </BottomButton>
      ) : undefined}>
      {failed && <LoadFailed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {t && (
        <>
          <label className="flex flex-col gap-2">
            <span className={label}>{C.nameLabel}</span>
            <input aria-label={C.nameLabel} className={input} type="text" value={name} dir="auto"
              onChange={(e) => { setName(e.target.value); setError(null); }} />
          </label>

          <div className="flex flex-col gap-2">
            <span className={label}>{C.phoneLabel}</span>
            <div className="flex gap-2">
              <input aria-label={C.phoneLabel} className={`${input} flex-1`} type="tel" inputMode="tel" dir="ltr"
                placeholder={formatPhone(t.phone) || ""}
                value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneResult(null); }} />
              <button type="button" onClick={checkPhone} disabled={!phone.trim() || busy}
                className="min-h-[56px] shrink-0 rounded-2xl border border-[#e5e7eb] bg-white px-4 text-[15px] font-semibold text-[#33374a] disabled:text-[#9ca3af]">
                {C.checkNumber}
              </button>
            </div>
            {phoneResult && (
              <div className="flex flex-wrap items-center gap-2" data-testid="phone-result">
                {phoneResult.kind === "refused" && <StatusChip text={phoneResult.text} tone="waiting" className="h-auto min-h-[26px] whitespace-normal py-1" />}
                {phoneResult.kind === "same" && <StatusChip text={C.phoneSame} tone="info" />}
                {(phoneResult.kind === "free" || phoneResult.kind === "shell") && (
                  <>
                    <StatusChip text={phoneResult.kind === "free" ? C.phoneFree : C.phoneShell} tone={phoneResult.kind === "free" ? "done" : "info"} tick={phoneResult.kind === "free"} />
                    <button type="button" onClick={changePhone} disabled={busy}
                      className="ms-auto min-h-[56px] rounded-xl bg-[#33374a] px-4 text-[15px] font-semibold text-white">
                      {C.changeNumber}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className={label}>{C.roleLabel}</span>
            <div className="flex gap-1 rounded-2xl border border-[#e5e7eb] bg-white p-1" role="radiogroup" aria-label={C.roleLabel}>
              {(["teacher", "principal"] as Role[]).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={role === r} className={pill(role === r)}
                  onClick={() => { setRole(r); setError(null); }}>
                  {r === "principal" ? C.rolePrincipal : C.roleTeacher}
                </button>
              ))}
            </div>
            {role === "principal" && !t.isPrincipal && <div className="flex" data-testid="role-note"><StatusChip text={C.canObserve} tone="waiting" /></div>}
          </div>

          <div className="flex flex-col gap-2">
            <span className={label}>{C.teachingLevel}</span>
            <div className="[display:grid] grid-cols-3 gap-2.5" role="group" aria-label={C.teachingLevel}>
              {LEVELS.map((b) => {
                const on = levels.includes(b);
                return (
                  <button key={b} type="button" role="checkbox" aria-checked={on} onClick={() => toggleLevel(b)}
                    className={`min-h-[60px] rounded-[14px] border text-base font-semibold shadow-[0_1px_3px_rgba(16,24,40,0.06)] ${on ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#e5e7eb] bg-white text-[#374151]"}`}>
                    {C.levelNames[b]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={label}>{C.schoolLabel}</span>
            <SelectBox label={C.schoolLabel} value={school} onChange={(v) => { setSchool(v); setError(null); }} options={options}
              icon={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#e3eefc] text-[#1d6fd8]"><School className="h-5 w-5" aria-hidden="true" /></span>} />
          </div>

          {error && <div className="flex" data-testid="edit-error"><StatusChip text={error} tone="waiting" className="h-auto min-h-[26px] whitespace-normal py-1" /></div>}

          {!confirmRemove ? (
            <button type="button" onClick={() => setConfirmRemove(true)}
              className="mt-1 flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold text-[#c8331f]">
              <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />{C.removeFromSchool}
            </button>
          ) : (
            <div className="mt-1 flex gap-2.5" data-testid="remove-confirm">
              <BottomButton tone="outline" onClick={() => setConfirmRemove(false)}>{C.keep}</BottomButton>
              <BottomButton tone="danger" onClick={remove} disabled={busy}>{C.remove}</BottomButton>
            </div>
          )}
        </>
      )}
    </PeopleFrame>
  );
};

export default CoachEditTeacher;
