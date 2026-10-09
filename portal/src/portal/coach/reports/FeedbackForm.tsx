import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { leader } from "../../services/api";
import type { DraftIndicator, DraftMove, DraftOption, DraftSection, ObservationDraft } from "../../services/api";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { LoadState } from "../../teacher/lessons/LoadState";
import { RatingScale, SelectField, StatusChip, StepBar, Tray } from "../../teacher/ui";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { BottomButton } from "../ui";
import ReportsFrame from "./ReportsFrame";
import { REPORTS } from "./copy";
import { countChanges, initialValues, rungName, titleOf, type Values } from "./formModel";
import { observationPath } from "./paths";
import { teacherNameOf, useObservationView } from "./useObservationView";

/**
 * bd-4404s7.5 — Feedback Form, step 2 of 5 (Blueprint Coach_FeedbackForm): the WhatsApp review form, in the portal, on the
 * kit. The parts are the form's own screens (B, C, D, F), a StepBar over them, a legend (her rating filled, the Digital
 * Coach's ringed), one card per indicator — the kit's RatingScale on the scale the bot returns (FICO: 0 Not observed,
 * 1 Developing, 2 Proficient, N/A), what was seen, to improve — and, for the lesson plan, each move's verdict.
 *
 * It sends the same keys as the WhatsApp form (formModel.ts) so the bot saves it through the very function the form's last
 * screen calls. After the teacher has the report the answers are read only (draft.editable === false): her ratings as words.
 *
 * The Digital Coach's own rating is marked only while the draft is unsaved: once she has saved, the route returns HER
 * answers and no longer holds the Digital Coach's (see the report's gap list).
 */
const AREA = "w-full rounded-xl border border-[#d1d5db] bg-white p-3 text-[16px] leading-snug text-[#1d2025]";

function Field({ id, label, value, onChange, readOnly }: { id: string; label: string; value: string; onChange: (v: string) => void; readOnly: boolean }) {
  if (readOnly) {
    return value ? (
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-[#6b7280]">{label}</span>
        <p className="whitespace-pre-line text-[15px] leading-relaxed" dir="auto">{value}</p>
      </div>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-semibold text-[#6b7280]">{label}</label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} dir="auto" className={cn(AREA, FOCUS)} />
    </div>
  );
}

export default function FeedbackForm() {
  const C = useCopy(REPORTS);
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { view } = useObservationView(id);
  const home = observationPath(id);
  const [draft, setDraft] = useState<ObservationDraft | null>(null);
  const [load, setLoad] = useState<"loading" | "error" | "ok">("loading");
  const [tick, setTick] = useState(0);
  const [start, setStart] = useState<Values>({});
  const [values, setValues] = useState<Values>({});
  const [part, setPart] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    setLoad("loading");
    leader.getObservationDraft(id)
      .then((d) => { if (live) { const v = initialValues(d); setDraft(d); setStart(v); setValues(v); setLoad("ok"); } })
      .catch(() => { if (live) setLoad("error"); });
    return () => { live = false; };
  }, [id, tick]);

  const name = teacherNameOf(view);
  const readOnly = !!draft && draft.editable === false;
  const sections = draft?.sections ?? [];
  const total = sections.length;
  const section: DraftSection | undefined = sections[Math.min(part, Math.max(0, total - 1))];
  const last = part >= total - 1;
  const changes = useMemo(() => countChanges(start, values), [start, values]);
  const set = (k: string) => (v: string) => setValues((cur) => ({ ...cur, [k]: v }));
  const options = useMemo(() => (draft?.scale ?? []).map((o) => ({ id: o.id, label: rungName(o.title) })), [draft]);
  const face = (rid: string) => (rid === "na" ? C.na : rid);

  const go = (n: number) => { setPart(n); top.current?.scrollIntoView?.({ block: "start" }); };
  const back = () => (part > 0 ? go(part - 1) : navigate(home));

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      await leader.saveObservationDraft(id, values);
      navigate(home);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setProblem(status === 409 ? C.notEditable : C.saveFailed);
      setSaving(false);
      setConfirm(false);
    }
  };

  const dock = draft ? (
    <>
      <BottomButton tone="outline" onClick={back}>{C.back}</BottomButton>
      {!last
        ? <BottomButton onClick={() => go(part + 1)}>{C.next}</BottomButton>
        : readOnly ? null : <BottomButton onClick={() => setConfirm(true)}>{C.saveForm}</BottomButton>}
    </>
  ) : undefined;

  const indicatorCard = (ind: DraftIndicator) => {
    const rk = `r_${ind.field}`;
    const changed = values[rk] !== start[rk];
    return (
      <section key={ind.id} data-testid="indicator" className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5")}>
        <div className="flex items-center gap-2.5">
          <StatusChip text={ind.id} tone="score" />
          <h3 className="m-0 text-[17px] font-semibold leading-[1.3]" dir="auto">{ind.name}</h3>
        </div>
        {readOnly ? (
          values[rk] ? <StatusChip text={titleOf(draft?.scale ?? [], values[rk])} tone="info" className="self-start" /> : null
        ) : (
          <RatingScale name={ind.name} value={values[rk] || null} dcValue={draft?.saved ? null : (start[rk] || null)} options={options} onChange={set(rk)} />
        )}
        {changed && !readOnly && <StatusChip text={C.changedFrom(face(start[rk] || "—"))} tone="waiting" className="self-start" />}
        <Field id={`ev_${ind.field}`} label={C.whatSeen} value={values[`ev_${ind.field}`] ?? ""} onChange={set(`ev_${ind.field}`)} readOnly={readOnly} />
        <Field id={`imp_${ind.field}`} label={C.toImprove} value={values[`imp_${ind.field}`] ?? ""} onChange={set(`imp_${ind.field}`)} readOnly={readOnly} />
      </section>
    );
  };

  const moveCard = (m: DraftMove, n: number, scale: readonly DraftOption[]) => {
    const rk = `fid_r_${m.k}`;
    const ek = `fid_e_${m.k}`;
    return (
      <section key={m.k} data-testid="move" className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5")}>
        <span className="text-[13px] font-bold uppercase tracking-wide text-[#6b7280]">{C.moveOf(m.k, n)}</span>
        <p className="whitespace-pre-line text-[16px] font-semibold leading-snug" dir="auto">{m.plan}</p>
        {readOnly
          ? <StatusChip text={titleOf(scale, values[rk])} tone="info" className="self-start" />
          : <SelectField label={C.verdict} title={C.verdict} value={values[rk] || null} options={scale.map((o) => ({ value: o.id, label: o.title }))} onChange={set(rk)} />}
        <Field id={ek} label={C.whatSeen} value={values[ek] ?? ""} onChange={set(ek)} readOnly={readOnly} />
      </section>
    );
  };

  return (
    <ReportsFrame title={C.formTitle} crumb={name ? C.stepCrumb(name, 2, 5) : C.observation} onBack={back} dock={dock} testId="coach-feedback-form">
      <LoadState status={load} empty={false} onRetry={() => setTick((n) => n + 1)} />
      <div ref={top} />
      {draft && section && (
        <>
          <StepBar total={total} current={part + 1} label={C.partOf(part + 1, total)} />
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[13px] font-semibold text-[#4b5563]" data-testid="legend">
              <span className="flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded-full bg-[#33374a]" />{C.legendYours}</span>
              <span className="flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-[#48b078]" />{C.legendDc}</span>
            </div>
          )}
          {readOnly && <p className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.readOnly}</p>}
          <h2 className="mx-1 mt-1 text-[22px] font-semibold leading-[1.2]" dir="auto">{section.letter}. {section.title}</h2>
          {section.kind === "moves" ? (
            <>
              {section.header && <p className="whitespace-pre-line rounded-2xl bg-[#eaf6ef] p-3.5 text-[14px] leading-relaxed text-[#2f7a52]" dir="auto">{section.header}</p>}
              {section.moves.length === 0 && section.fallback && <p className={cn(LIST_CARD, "p-3.5 text-[15px] leading-relaxed")} dir="auto">{section.fallback}</p>}
              {section.moves.map((m) => moveCard(m, section.moves.length, draft.fidelityScale))}
            </>
          ) : (
            <>
              {section.notes.map((n) => <p key={n.slice(0, 40)} className="whitespace-pre-line rounded-2xl bg-[#eaf6ef] p-3.5 text-[14px] leading-relaxed text-[#2f7a52]" dir="auto">{n}</p>)}
              {section.indicators.map(indicatorCard)}
            </>
          )}
          {problem && <div role="alert" className="rounded-2xl bg-[#fee4e2] p-4 text-[16px] font-semibold text-[#c8331f]">{problem}</div>}
        </>
      )}

      <Tray open={confirm} title={C.saveTitle} onClose={() => { if (!saving) setConfirm(false); }}>
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-[16px] font-semibold">{changes.ratings + changes.notes === 0 ? C.noChanges : C.changesSummary(changes.ratings, changes.notes)}</p>
          <button type="button" onClick={save} disabled={saving}
            className={cn("flex min-h-[56px] items-center justify-center rounded-2xl bg-[#33374a] text-base font-semibold text-white disabled:opacity-60", FOCUS)}>
            {saving ? C.saving : C.saveContinue}
          </button>
          <button type="button" onClick={() => setConfirm(false)} disabled={saving}
            className={cn("flex min-h-[56px] items-center justify-center rounded-2xl border border-[#d1d5db] bg-white text-base font-semibold text-[#33374a]", FOCUS)}>{C.keepChecking}</button>
        </div>
      </Tray>
    </ReportsFrame>
  );
}
