import { useEffect, useMemo, useRef, useState } from "react";
import { useObserveRoutes } from "../observe/observeRoutes";
import { useNavigate, useParams } from "react-router-dom";
import { leader } from "../../services/api";
import type { DraftIndicator, DraftMove, DraftOption, DraftSection, EvidenceReview, Obs612Draft, ObservationDraft } from "../../services/api";
import { cn } from "@/lib/utils";
import { useCopy } from "../../teacher/i18n";
import { LoadState } from "../../teacher/lessons/LoadState";
import { RatingScale, SelectField, StatusChip, StepBar, Tray } from "../../teacher/ui";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { BottomButton } from "../ui";
import ReportsFrame from "./ReportsFrame";
import { REPORTS } from "./copy";
import { dropForm, heldForm, keepForm, restoreOver } from "./formKeep";
import { countChanges, initialValues, isObs612Draft, rungName, titleOf, type Values } from "./formModel";
import { OBSERVATION_STEPS, SCREEN_STEP } from "./paths";
import { teacherNameOf, useObservationView } from "./useObservationView";
import { PlanSource } from "../observe/PlanState";
import { V6Part } from "./V6Parts";
import { MIN_REASON, v6Problems, type V6Problems } from "./v6Model";
import Obs612Form from "./Obs612Form";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { AutoText, DockV7, FormChips, IndicatorV7, Legend, PartTitle, SaveTrayV7, v7Changes, v7Crumb } from "./FormV7";
import { V6FormV7 } from "./FormV7List";
import { dropV7 } from "./evidenceReview";

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
 *
 * bd-ra8xu.40 — an FDE (obs612) visit's draft says `kind: 'obs612'`: its form is FDE's, not this review form, and
 * Obs612Form fills it (the FICO draft has no `kind` and is unchanged).
 *
 * bd-o15qnr.28 (v7) — on the v6/v7 switch (useFlowV6: a coach on portal_coach_flow_v2, or a principal on the principal
 * app it names) the same form is drawn in the v7 look (FormV7.tsx; #188's boards m9-ff-v6, m9-ff-save, p9-ff-v6): same
 * state, keys, rules and save. Off (or while /config is read), today's screen, unchanged.
 *
 * bd-o15qnr.31 (#188, 21 Nov: the Feedback Form review, LOCKED ~10:05) — on the switch a FICO17 v6 draft is drawn
 * collapsed (FormV7List.tsx: sections → one row per indicator → one indicator alone; the NIETE Teaching Assistant's
 * evidence as rows the coach keeps, edits, removes or adds to). The same keys and the same save, with the evidence
 * reviews beside them (`evidence_review`); every text box sized to its text.
 */
const AREA = "w-full rounded-xl border border-[#d1d5db] bg-white p-3 text-[16px] leading-snug text-[#1d2025]";

function Field({ id, label, value, onChange, readOnly, auto = false }: { id: string; label: string; value: string; onChange: (v: string) => void; readOnly: boolean; auto?: boolean }) {
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
      {auto
        ? <AutoText id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(AREA, FOCUS)} />
        : <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} dir="auto" className={cn(AREA, FOCUS)} />}
    </div>
  );
}

export default function FeedbackForm() {
  const C = useCopy(REPORTS);
  const { id = "" } = useParams();
  const routes = useObserveRoutes();
  const navigate = useNavigate();
  const v7 = useFlowV6() === true;
  const W7 = useCopy(FLOW_V7) as FlowV7Copy;
  const { view } = useObservationView(id);
  const home = routes.observation(id);
  const [draft, setDraft] = useState<ObservationDraft | null>(null);
  const [fde, setFde] = useState<Obs612Draft | null>(null);
  const [load, setLoad] = useState<"loading" | "error" | "ok">("loading");
  // bd-tfya0m — the bot answered 409 no_analysis: this observation has no draft to check (no form, no Save).
  const [noAnalysis, setNoAnalysis] = useState(false);
  const [tick, setTick] = useState(0);
  const [start, setStart] = useState<Values>({});
  const [values, setValues] = useState<Values>({});
  const [part, setPart] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // bd-ra8xu.40 — a FICO17 v6 part's refusals (the v6 Flow's rules), and the bot's own when it refuses a save.
  const [problems, setProblems] = useState<V6Problems>({});
  const [refused, setRefused] = useState<string[]>([]);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    setLoad("loading");
    leader.getObservationDraft(id)
      .then((got) => {
        if (!live) return;
        const d: ObservationDraft | Obs612Draft = got;
        if (isObs612Draft(d)) { setFde(d); setLoad("ok"); return; }
        const v = initialValues(d);
        // bd-tfya0m — her answers kept on this phone (a reload, or a Save that came back 502) are laid back over the
        // bot's, on the part she was on; a read-only form (the report is out) never takes them.
        const kept = d.editable === false ? null : heldForm(id);
        if (d.editable === false) dropForm(id);
        setDraft(d); setStart(v); setValues(restoreOver(v, kept));
        if (kept) setPart(Math.max(0, Math.min(kept.part, d.sections.length - 1)));
        setLoad("ok");
      })
      .catch((err) => {
        if (!live) return;
        const res = (err as { response?: { status?: number; data?: { reason?: string } } })?.response;
        if (res?.status === 409 && res.data?.reason === "no_analysis") { setNoAnalysis(true); setLoad("ok"); return; }
        setLoad("error");
      });
    return () => { live = false; };
  }, [id, tick]);

  const name = teacherNameOf(view);
  const readOnly = !!draft && draft.editable === false;

  // bd-tfya0m — keep every change on this phone as she makes it (only while something differs from the bot's).
  useEffect(() => {
    if (!draft || readOnly || !id) return;
    const changed = Object.keys(values).some((k) => values[k] !== start[k]);
    if (changed) keepForm(id, values, part); else dropForm(id);
  }, [draft, readOnly, id, values, start, part]);
  const sections = draft?.sections ?? [];
  const total = sections.length;
  const section: DraftSection | undefined = sections[Math.min(part, Math.max(0, total - 1))];
  const last = part >= total - 1;
  const changes = useMemo(() => countChanges(start, values), [start, values]);
  const set = (k: string) => (v: string) => setValues((cur) => ({ ...cur, [k]: v }));
  const options = useMemo(() => (draft?.scale ?? []).map((o) => ({ id: o.id, label: rungName(o.title) })), [draft]);
  const face = (rid: string) => (rid === "na" ? C.na : rid);

  if (fde) return <Obs612Form id={id} draft={fde} name={name} home={home} />;

  const minReason = draft?.minReason ?? MIN_REASON;
  // A v6 part goes on only when its rules hold, as the v6 Flow refuses its screen; the reasons show at each field.
  const partOk = () => {
    if (readOnly || !section || section.kind !== "v6") return true;
    const p = v6Problems(section, values, minReason);
    setProblems(p);
    if (Object.keys(p).length) { top.current?.scrollIntoView?.({ block: "start" }); return false; }
    return true;
  };
  const go = (n: number) => { setProblems({}); setPart(n); top.current?.scrollIntoView?.({ block: "start" }); };
  const back = () => (part > 0 ? go(part - 1) : navigate(home));

  const save = async (review?: Record<string, EvidenceReview>) => {
    setSaving(true);
    setProblem(null);
    try {
      // bd-o15qnr.31 — the evidence reviews only from the v7 form, and only when there are some: today's call otherwise.
      if (review) await leader.saveObservationDraft(id, values, review);
      else await leader.saveObservationDraft(id, values);
      dropForm(id); // the bot has them now
      dropV7(id);
      navigate(home, { replace: true });
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: { reason?: string; errors?: Record<string, string> } } })?.response;
      const status = res?.status;
      // bd-ra8xu.40 — the bot refused a v6 review with the v6 Flow's own reasons (in her language): show them.
      const reasons = status === 400 && res?.data?.reason === "v6_review" ? Object.values(res.data.errors || {}) : [];
      setRefused(reasons);
      setProblem(reasons.length ? C.fixThese : status === 409 ? C.notEditable : C.saveFailed);
      setSaving(false);
      setConfirm(false);
    }
  };

  const dock = draft ? (
    <>
      <BottomButton tone="outline" onClick={back}>{C.back}</BottomButton>
      {!last
        ? <BottomButton onClick={() => { if (partOk()) go(part + 1); }}>{C.next}</BottomButton>
        : readOnly ? null : <BottomButton onClick={() => { if (partOk()) setConfirm(true); }}>{C.saveForm}</BottomButton>}
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

  const moveCard = (m: DraftMove, n: number, scale: readonly DraftOption[], v7look = false) => {
    const rk = `fid_r_${m.k}`;
    const ek = `fid_e_${m.k}`;
    return (
      <section key={m.k} data-testid="move" id={v7look ? `ff-move-${m.k}` : undefined} tabIndex={v7look ? -1 : undefined} className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5")}>
        <span className="text-[13px] font-bold uppercase tracking-wide text-[#6b7280]">{C.moveOf(m.k, n)}</span>
        <p className="whitespace-pre-line text-[16px] font-semibold leading-snug" dir="auto">{m.plan}</p>
        {readOnly
          ? <StatusChip text={titleOf(scale, values[rk])} tone="info" className="self-start" />
          : <SelectField label={C.verdict} title={C.verdict} value={values[rk] || null} options={scale.map((o) => ({ value: o.id, label: o.title }))} onChange={set(rk)} />}
        <Field id={ek} label={C.whatSeen} value={values[ek] ?? ""} onChange={set(ek)} readOnly={readOnly} auto={v7look} />
      </section>
    );
  };

  // Drawn the same in both looks.
  const movesPart = (s: Extract<DraftSection, { kind: "moves" }>, d: ObservationDraft, v7look = false) => (
    <>
      <PlanSource lp={view?.lessonPlan} />
      {s.header && <p className="whitespace-pre-line rounded-2xl bg-[#eaf6ef] p-3.5 text-[14px] leading-relaxed text-[#2f7a52]" dir="auto">{s.header}</p>}
      {s.moves.length === 0 && s.fallback && <p className={cn(LIST_CARD, "p-3.5 text-[15px] leading-relaxed")} dir="auto">{s.fallback}</p>}
      {s.moves.map((m) => moveCard(m, s.moves.length, d.fidelityScale, v7look))}
    </>
  );
  const problemBox = problem && (
    <div role="alert" className="flex flex-col gap-1.5 rounded-2xl bg-[#fee4e2] p-4 text-[16px] font-semibold text-[#c8331f]">
      {problem}
      {refused.length > 0 && (
        <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-[15px] font-normal">
          {refused.map((r) => <li key={r} dir="auto">{r}</li>)}
        </ul>
      )}
    </div>
  );
  const loadAndEmpty = (
    <>
      <LoadState status={load} empty={false} onRetry={() => setTick((n) => n + 1)} />
      {noAnalysis && (
        <p data-testid="no-analysis" role="alert" className="rounded-2xl bg-[#fef3c7] px-4 py-4 text-[16px] font-semibold text-[#b45309]">{C.noAnalysis}</p>
      )}
    </>
  );

  // bd-o15qnr.31 — a FICO17 v6 draft on the switch: every section collapsed (FormV7List.tsx).
  if (v7 && draft && sections.some((s) => s.kind === "v6")) {
    return (
      <V6FormV7 id={id} draft={draft} values={values} start={start} setValues={setValues} readOnly={readOnly} name={name}
        minReason={minReason} principal={!routes.coachGate} moves={(s) => movesPart(s, draft, true)}
        onLeave={() => navigate(home)} onSave={(review) => { void save(review); }} confirm={confirm} setConfirm={setConfirm}
        saving={saving} problem={problemBox} head={<>{loadAndEmpty}<div ref={top} /></>} />
    );
  }

  // bd-o15qnr.28 — the v7 look (FormV7.tsx): the same parts, keys, rules and save as below.
  if (v7) {
    const dockV7 = draft ? (
      <DockV7 single={last && readOnly}>
        <BottomButton tone="outline" onClick={back}>{C.back}</BottomButton>
        {!last
          ? <BottomButton onClick={() => { if (partOk()) go(part + 1); }}>{C.next}</BottomButton>
          : readOnly ? null : <BottomButton onClick={() => { if (partOk()) setConfirm(true); }}>{C.saveForm}</BottomButton>}
      </DockV7>
    ) : undefined;
    return (
      <ReportsFrame title={C.formTitle} crumb={name ? v7Crumb(W7, name, readOnly) : C.observation} onBack={back} dock={dockV7} testId="coach-feedback-form">
        {loadAndEmpty}
        <div ref={top} />
        {draft && section && (
          <>
            <FormChips label={draft.rubric?.label} />
            <StepBar total={total} current={part + 1} label={C.partOf(part + 1, total)} />
            {readOnly && <p className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.readOnly}</p>}
            <PartTitle text={`${section.letter}. ${section.title}`} />
            {!readOnly && section.kind !== "moves" && <Legend principal={!routes.coachGate} />}
            {section.kind === "moves" ? (
              movesPart(section, draft, true)
            ) : section.kind === "v6" ? null : (
              <>
                {section.notes.map((n) => <p key={n.slice(0, 40)} className="whitespace-pre-line rounded-2xl bg-[#eaf6ef] p-3.5 text-[14px] leading-relaxed text-[#2f7a52]" dir="auto">{n}</p>)}
                {section.indicators.map((ind) => (
                  <IndicatorV7 key={ind.id} ind={ind} scale={draft.scale} values={values} start={start} set={set} readOnly={readOnly} dc={!draft.saved} />
                ))}
              </>
            )}
            {problemBox}
          </>
        )}
        <SaveTrayV7 open={confirm} saving={saving} onSave={() => { void save(); }} onClose={() => { if (!saving) setConfirm(false); }}
          counts={v7Changes(draft ?? { sections: [], saved: false }, start, values)} />
      </ReportsFrame>
    );
  }

  return (
    <ReportsFrame title={C.formTitle} crumb={name ? C.stepCrumb(name, SCREEN_STEP.form, OBSERVATION_STEPS) : C.observation} onBack={back} dock={dock} testId="coach-feedback-form">
      {loadAndEmpty}
      <div ref={top} />
      {draft && section && (
        <>
          {draft.rubric?.label && (
            <span data-testid="rubric-label" dir="ltr" className="self-end px-1 text-[10px] leading-none text-[#9ca3af]">{draft.rubric.label}</span>
          )}
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
            movesPart(section, draft)
          ) : section.kind === "v6" ? (
            <V6Part section={section} values={values} start={start} set={set} readOnly={readOnly} problems={problems} minReason={minReason} />
          ) : (
            <>
              {section.notes.map((n) => <p key={n.slice(0, 40)} className="whitespace-pre-line rounded-2xl bg-[#eaf6ef] p-3.5 text-[14px] leading-relaxed text-[#2f7a52]" dir="auto">{n}</p>)}
              {section.indicators.map(indicatorCard)}
            </>
          )}
          {problemBox}
        </>
      )}

      <Tray open={confirm} title={C.saveTitle} onClose={() => { if (!saving) setConfirm(false); }}>
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-[16px] font-semibold">{changes.ratings + changes.notes === 0 ? C.noChanges : C.changesSummary(changes.ratings, changes.notes)}</p>
          <button type="button" onClick={() => { void save(); }} disabled={saving}
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
