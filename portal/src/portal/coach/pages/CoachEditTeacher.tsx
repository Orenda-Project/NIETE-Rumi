import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Lock, School, Trash2 } from "lucide-react";
import { coach } from "../../services/api";
import { COACH_COPY as C } from "../copy";
import { CoachPage, Card, SelectBox, BottomButton, Chip, Loading, Failed, useLoad, formatPhone } from "../ui";

/**
 * bd-o15qnr.11 — Edit teacher (v22 EditTeacher.dc.html).
 *
 * Saved through the WhatsApp /observe teacher admin and nothing else: a new
 * school MOVES her (commitAdd), Remove from school takes her off it
 * (commitRemovals). The bot refuses a school the coach does not hold.
 *
 * Name, role and teaching level are shown, not edited: /observe has no writer
 * for them (its Flow offers only Add — which moves — and Remove), and the
 * operator ruled out adding a second one.
 */
const reasonText = (reason?: string) => (reason === "not_my_school" ? C.notYourSchool : C.saveFailed);

function Info({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center gap-3 border-t border-[#e5e7eb] px-4 first:border-t-0">
      <span className="w-20 shrink-0 text-[13px] font-semibold text-[#6b7280]">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[16px] font-medium" data-testid={testId} dir="auto">{children}</span>
    </div>
  );
}

const CoachEditTeacher = () => {
  const { ext = "" } = useParams();
  const navigate = useNavigate();
  const { data, failed, reload } = useLoad(() => coach.getTeacher(ext), [ext]);
  const { data: people } = useLoad(() => coach.getPeople(), []);
  const t = data?.teacher;
  const [school, setSchool] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => { if (t?.schoolExtId) setSchool(t.schoolExtId); }, [t?.schoolExtId]);

  const options = (people?.schools || []).map((s) => ({ value: s.schoolExtId, label: s.name }));
  if (t?.schoolExtId && !options.some((o) => o.value === t.schoolExtId)) {
    options.unshift({ value: t.schoolExtId, label: t.schoolName || t.schoolExtId });
  }
  const changed = !!t && !!school && school !== t.schoolExtId;

  const fail = (e: any) => setError(reasonText(e?.response?.data?.reason));

  const save = async () => {
    if (!changed || busy) return;
    setBusy(true); setError(null);
    try {
      await coach.moveTeacher(ext, school);
      navigate(`/portal/coach/teacher/${ext}`);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await coach.removeTeacher(ext);
      navigate(t?.emis ? `/portal/coach/school/${t.emis}` : "/portal/coach/people");
    } catch (e) { fail(e); setConfirmRemove(false); } finally { setBusy(false); }
  };

  return (
    <CoachPage title={C.editTeacher} crumb={t?.name || undefined} backTo={`/portal/coach/teacher/${ext}`}
      dock={t ? (
        <BottomButton onClick={save} disabled={!changed || busy}>
          <Check className="h-5 w-5" aria-hidden="true" />{C.save}
        </BottomButton>
      ) : undefined}>
      {failed && <Failed onRetry={reload} />}
      {!data && !failed && <Loading />}
      {t && (
        <>
          <Card className="flex flex-col overflow-hidden">
            <Info label={C.nameLabel} testId="edit-name">{t.name}</Info>
            <Info label={C.phoneLabel} testId="edit-phone">
              <Lock className="h-4 w-4 shrink-0 text-[#9ca3af]" aria-hidden="true" />{formatPhone(t.phone) || C.dash}
            </Info>
            <Info label={C.roleLabel} testId="edit-role">{t.isPrincipal ? C.rolePrincipal : C.roleTeacher}</Info>
          </Card>

          <div className="flex flex-col gap-2">
            <span className="px-1 text-sm font-semibold text-[#4b5563]">{C.schoolLabel}</span>
            <SelectBox label={C.schoolLabel} value={school} onChange={(v) => { setSchool(v); setError(null); }} options={options}
              icon={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#e3eefc] text-[#1d6fd8]"><School className="h-5 w-5" aria-hidden="true" /></span>} />
          </div>

          {error && <div className="flex" data-testid="edit-error"><Chip tone="warn">{error}</Chip></div>}

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
    </CoachPage>
  );
};

export default CoachEditTeacher;
