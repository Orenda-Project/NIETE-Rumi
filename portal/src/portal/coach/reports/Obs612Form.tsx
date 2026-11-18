import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { leader } from "../../services/api";
import type { Obs612Draft, Obs612ErrorCode, Obs612Field, Obs612Part, Obs612Refusal } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { ConfirmTray, RatingScale, SelectField, StatusChip, StepBar } from "../../teacher/ui";
import { FOCUS, GRID, LIST_CARD } from "../../teacher/ui/styles";
import { BottomButton } from "../ui";
import ReportsFrame from "./ReportsFrame";
import { REPORTS } from "./copy";
import { rungName } from "./formModel";
import { OBSERVATION_STEPS, SCREEN_STEP } from "./paths";

/**
 * bd-ra8xu.40 — an FDE (obs612) visit's form, on the portal: what the coach fills on WhatsApp in FDE's Flow, here, on
 * the kit. FeedbackForm opens it when the draft says `kind: 'obs612'`.
 *
 * The parts are the Flow's screens (the bot sends them: obs612/portal.js), a StepBar over them. Each item with its
 * options (Yes/No, 1 to 4, Level 0 to 3 with FDE's level text), the tool's own boxes (comments, observations, Section 1,
 * the development plan, the feedback), and FDE's label ('FDE v1') in very small type. Mobile first: one column, 56px
 * choices, the coach's own text in its own direction.
 *
 * Saving is the Flow's: "Next part" saves every answer and stays on a part the bot's check refuses (each field marked);
 * "Save draft" saves part-way; "Submit" first asks the bot what is still missing (a save), then, with nothing missing,
 * asks her in a tray and submits. A refused Submit (400) marks the refused fields and opens the first. Once sealed,
 * her answers are read only. Nothing here sends WhatsApp anything: the bot's portal Submit does not either.
 *
 * Words: FDE's own (items, levels, headings, labels it prints) come from the API, in English as FDE printed them; ours
 * are REPORTS.fde (en/ur).
 */
type Values = Record<string, string>;
type Errors = Record<string, Obs612ErrorCode>;

const AREA = "w-full rounded-xl border border-[#d1d5db] bg-white p-3 text-[16px] leading-snug text-[#1d2025]";
const BAD = "border-[#c8331f]";
const NOTE = "rounded-2xl p-4 text-[16px] font-semibold";

const isField = (p: Obs612Part): p is Obs612Field => p.type === "field";
const fieldsOf = (parts: Obs612Part[]) => parts.filter(isField);

/** Every field of the form, valued from the draft ('' for none), so every answer is sent, as the Flow sends them. */
function valuesOf(d: Obs612Draft): Values {
  const v: Values = {};
  for (const s of d.sections) for (const f of fieldsOf(s.parts)) v[f.name] = d.values[f.name] == null ? "" : String(d.values[f.name]);
  return v;
}

type Refusal = { reason?: string; missing?: Obs612Refusal["missing"]; errors?: Obs612Refusal["errors"] };
function refusalOf(err: unknown): { status: number | null; body: Refusal } {
  const r = (err as { response?: { status?: number; data?: unknown } })?.response;
  return { status: typeof r?.status === "number" ? r.status : null, body: (r?.data && typeof r.data === "object" ? r.data : {}) as Refusal };
}

export default function Obs612Form({ id, draft: first, name, home }: { id: string; draft: Obs612Draft; name: string | null; home: string }) {
  const C = useCopy(REPORTS);
  const W = C.fde;
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Obs612Draft>(first);
  const [values, setValues] = useState<Values>(() => valuesOf(first));
  const [part, setPart] = useState(0);
  const [shown, setShown] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const readOnly = !draft.editable;
  const total = draft.sections.length;
  const section = draft.sections[Math.min(part, Math.max(0, total - 1))];
  const last = part >= total - 1;
  const set = (k: string) => (v: string) => { setValues((cur) => ({ ...cur, [k]: v })); setNote(null); };

  const go = (n: number) => { setPart(n); setNote(null); top.current?.scrollIntoView?.({ block: "start" }); };
  const back = () => (part > 0 ? go(part - 1) : navigate(home));
  const firstPartWith = (errs: Errors) => {
    const i = draft.sections.findIndex((s) => fieldsOf(s.parts).some((f) => errs[f.name]));
    return i < 0 ? part : i;
  };

  /** A save of every answer: the form as the bot now holds it, and its check. */
  const store = async (): Promise<Obs612Draft> => {
    const d = await leader.saveObs612Form(id, values, false);
    setDraft(d);
    setValues(valuesOf(d));
    return d;
  };
  const failed = (err: unknown, fallback: string) => {
    const { status, body } = refusalOf(err);
    if (status === 409) setNote({ ok: false, text: body.reason === "visit_closed" ? W.closed : C.notEditable });
    else setNote({ ok: false, text: fallback });
  };

  // A part's fields marked from the bot's check: the ones it still refuses, and none it now takes.
  const mark = (d: Obs612Draft, names: string[]) => setShown((cur) => {
    const out: Errors = { ...cur };
    for (const k of names) { if (d.errors[k]) out[k] = d.errors[k]; else delete out[k]; }
    return out;
  });

  const next = async () => {
    if (readOnly) { go(part + 1); return; }
    setBusy(true);
    try {
      const d = await store();
      const names = fieldsOf(section.parts).map((f) => f.name);
      mark(d, [...names, ...Object.keys(shown)]);
      if (names.some((k) => d.errors[k])) setNote({ ok: false, text: W.fixThese });
      else go(part + 1);
    } catch (err) {
      failed(err, C.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      const d = await store();
      mark(d, Object.keys(shown));
      setNote({ ok: true, text: W.saved });
    } catch (err) {
      failed(err, C.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const refused = (errs: Errors, missing: string[]) => {
    setShown(errs);
    go(firstPartWith(errs));
    setNote({ ok: false, text: W.missing(Math.max(missing.length, Object.keys(errs).length)) });
  };

  const askSubmit = async () => {
    setBusy(true);
    try {
      const d = await store();
      if (d.missing.length || Object.keys(d.errors).length) refused(d.errors, d.missing);
      else setConfirm(true);
    } catch (err) {
      failed(err, C.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      await leader.saveObs612Form(id, values, true);
      navigate(home, { replace: true });
    } catch (err) {
      const { status, body } = refusalOf(err);
      if (status === 400 && body.reason === "obs612_incomplete") refused((body.errors || {}) as Errors, body.missing || []);
      else failed(err, W.submitFailed);
      setBusy(false);
    }
  };

  const dock = readOnly ? (
    <>
      <BottomButton tone="outline" onClick={back}>{C.back}</BottomButton>
      {!last && <BottomButton onClick={next}>{C.next}</BottomButton>}
    </>
  ) : (
    <>
      <BottomButton tone="outline" onClick={saveDraft} disabled={busy}>{W.saveDraft}</BottomButton>
      {last
        ? <BottomButton onClick={askSubmit} disabled={busy}>{W.submit}</BottomButton>
        : <BottomButton onClick={next} disabled={busy}>{C.next}</BottomButton>}
    </>
  );

  const labelOf = (f: Obs612Field): string => {
    if (f.role === "item") return f.short || (f.n != null ? W.itemNo(f.n) : f.text || "");
    if (f.role === "comment") return W.comments;
    if (f.role === "observation") return W.observations;
    if (f.role === "line") return W.feedbackLine;
    return f.text || f.name;
  };
  const titleOf = (f: Obs612Field, v: string) => (f.options || []).find((o) => o.id === v)?.title || v;

  const errorLine = (f: Obs612Field) => (shown[f.name] ? (
    <p id={`err-${f.name}`} data-testid={`err-${f.name}`} className="m-0 text-[14px] font-semibold text-[#c8331f]">{W.errors[shown[f.name]]}</p>
  ) : null);

  const item = (f: Obs612Field) => {
    const label = labelOf(f);
    // The group is named by FDE's words for the item; its chip shows only FDE's number (13 Nov: no "Item N").
    const groupName = f.short || f.text || label;
    const v = values[f.name] || "";
    const bad = !!shown[f.name];
    const opts = f.options || [];
    let choices = null;
    if (readOnly) {
      choices = v ? <StatusChip text={titleOf(f, v)} tone="info" className="self-start" /> : null;
    } else if (f.kind === "points") {
      choices = (
        <>
          <RatingScale name={groupName} value={v || null} options={opts.map((o) => ({ id: o.id, label: rungName(o.title) }))} onChange={(k) => set(f.name)(String(k))} />
          {v ? <span className="text-[14px] font-semibold text-[#4b5563]" dir="auto">{titleOf(f, v)}</span> : null}
        </>
      );
    } else {
      // Yes/No side by side; Levels one under another, each with FDE's text of what the level looks like.
      const wide = f.kind === "level";
      choices = (
        <div role="radiogroup" aria-label={groupName} aria-describedby={bad ? `err-${f.name}` : undefined}
          className={cn(GRID, "gap-2", wide ? "grid-cols-1" : "grid-cols-2")}>
          {opts.map((o) => {
            const on = v === o.id;
            return (
              <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => set(f.name)(o.id)}
                className={cn("flex min-h-[56px] flex-col justify-center gap-0.5 rounded-[14px] border px-3 py-2 text-start", wide ? "items-start" : "items-center",
                  on ? "border-[#33374a] bg-[#33374a] text-white" : "border-[#e5e7eb] bg-white text-[#374151]", bad && !on && BAD, FOCUS)}>
                <span className="text-[16px] font-bold" dir="auto">{o.title}</span>
                {o.description ? <span className={cn("text-[13px] leading-snug", on ? "text-white" : "text-[#6b7280]")} dir="auto">{o.description}</span> : null}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <section key={f.name} data-testid="fde-item" className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5", bad && BAD)}>
        <StatusChip text={label} tone="score" className="self-start" />
        {f.text ? <p className="m-0 text-[16px] font-semibold leading-snug" dir="auto">{f.text}</p> : null}
        {choices}
        {errorLine(f)}
      </section>
    );
  };

  const field = (f: Obs612Field) => {
    if (f.role === "item") return item(f);
    const label = labelOf(f);
    const v = values[f.name] || "";
    const bad = !!shown[f.name];
    const fid = `fde-${f.name}`;
    if (readOnly) {
      if (!v) return null;
      return (
        <div key={f.name} className="flex flex-col gap-0.5 px-1">
          <span className="text-[13px] font-semibold text-[#6b7280]" dir="auto">{label}</span>
          <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed" dir="auto">{f.options ? titleOf(f, v) : v}</p>
        </div>
      );
    }
    const head = (
      <label htmlFor={fid} className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-[#6b7280]">
        <span dir="auto">{label}</span>
        {!f.required ? <span className="text-[12px] font-medium text-[#9ca3af]">{W.optional}</span> : null}
      </label>
    );
    let input;
    if (f.input === "dropdown") {
      input = (
        <div className="flex flex-col gap-1.5">
          <SelectField label={label} title={label} value={v || null} onChange={set(f.name)} className={bad ? BAD : undefined}
            options={(f.options || []).map((o) => ({ value: o.id, label: o.title, sub: o.description }))} />
          {!f.required && v ? (
            <button type="button" onClick={() => set(f.name)("")} className={cn("min-h-[44px] self-start rounded-xl px-3 text-[14px] font-semibold text-[#33374a] underline", FOCUS)}>{W.clear}</button>
          ) : null}
        </div>
      );
      return <div key={f.name} className="flex flex-col gap-1">{input}{errorLine(f)}</div>;
    }
    const common = { id: fid, value: v, "aria-invalid": bad || undefined, "aria-describedby": bad ? `err-${f.name}` : undefined };
    if (f.input === "textarea") {
      input = <textarea {...common} dir="auto" rows={3} maxLength={f.max || undefined} onChange={(e) => set(f.name)(e.target.value)} className={cn(AREA, bad && BAD, FOCUS)} />;
    } else if (f.input === "number") {
      input = <input {...common} dir="auto" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} onChange={(e) => set(f.name)(e.target.value)} className={cn(AREA, "min-h-[56px]", bad && BAD, FOCUS)} />;
    } else {
      input = <input {...common} dir="auto" type="text" maxLength={f.max || undefined} onChange={(e) => set(f.name)(e.target.value)} className={cn(AREA, "min-h-[56px]", bad && BAD, FOCUS)} />;
    }
    return <div key={f.name} className="flex flex-col gap-1">{head}{input}{errorLine(f)}</div>;
  };

  const partView = (p: Obs612Part, i: number) => {
    if (p.type === "heading") return <h2 key={i} className="mx-1 mt-1 text-[20px] font-semibold leading-[1.25]" dir="auto">{p.text}</h2>;
    if (p.type === "sub") return <h3 key={i} className="mx-1 mt-2 text-[16px] font-semibold text-[#4b5563]" dir="auto">{p.role ? W.subs[p.role] : p.text}</h3>;
    if (p.type === "context") {
      return (
        <section key={i} data-testid="fde-context" className={cn(LIST_CARD, "flex flex-col p-3.5")}>
          {p.rows.map((r, n) => (
            <div key={r.key} className={cn("flex items-baseline gap-3 py-1.5 text-[15px]", n ? "border-t border-[#f0f1f3]" : "")}>
              <span className="min-w-0 flex-1 text-[#6b7280]" dir="auto">{r.label}</span>
              <b className="font-semibold" dir="auto">{r.value ?? C.dash}</b>
            </div>
          ))}
        </section>
      );
    }
    if (p.type === "levels") {
      return (
        <section key={i} data-testid="fde-levels" className={cn(LIST_CARD, "flex flex-col p-3.5")}>
          <span className="pb-1 text-[13px] font-semibold text-[#6b7280]" dir="auto">{p.label}</span>
          {p.rows.map((r) => (
            <div key={r.key} className="flex items-baseline gap-3 py-1 text-[14px]">
              <span className="min-w-0 flex-1" dir="auto">{`${r.n}. ${r.name}`}</span>
              <b className="shrink-0 font-semibold" dir="auto">{r.level ?? W.notScored}</b>
            </div>
          ))}
        </section>
      );
    }
    if (p.type === "score") {
      return (
        <section key={i} data-testid="fde-score" className={cn(LIST_CARD, "flex flex-col gap-1 p-3.5")}>
          <span className="text-[13px] font-semibold text-[#6b7280]">{W.scoreSoFar}</span>
          <b className="text-[20px] font-bold tabular-nums" dir="ltr">{`${p.total} / ${p.max} (${p.pct}%)`}</b>
          {p.band ? (
            <span className="flex items-baseline gap-2 text-[14px]">
              <span className="text-[#6b7280]">{W.rating}</span>
              <b className="font-semibold" dir="auto">{p.band}</b>
            </span>
          ) : null}
        </section>
      );
    }
    return field(p);
  };

  return (
    <ReportsFrame title={C.formTitle} crumb={name ? C.stepCrumb(name, SCREEN_STEP.form, OBSERVATION_STEPS) : C.observation} onBack={back} dock={dock} testId="coach-fde-form">
      <div ref={top} />
      {section && (
        <>
          <StepBar total={total} current={part + 1} label={C.partOf(part + 1, total)} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
            <span className="text-[13px] font-semibold text-[#4b5563]" dir="auto">{draft.toolName}</span>
            {draft.sealed ? <StatusChip text={W.submitted} tone="done" tick /> : null}
            <span data-testid="rubric-label" className="ms-auto text-[10px] leading-none text-[#9ca3af]" dir="ltr">{draft.label}</span>
          </div>
          {readOnly && !draft.sealed ? <p className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.readOnly}</p> : null}
          {section.parts.map(partView)}
          {note && (
            <div role={note.ok ? "status" : "alert"} className={cn(NOTE, note.ok ? "bg-[#eaf6ef] text-[#2f7a52]" : "bg-[#fee4e2] text-[#c8331f]")}>{note.text}</div>
          )}
        </>
      )}

      <ConfirmTray open={confirm} title={W.submitTitle} warning={W.noChangesAfter} onClose={() => setConfirm(false)}
        confirmLabel={W.yesSubmit} onConfirm={submit} cancelLabel={C.keepChecking} testId="fde-submit-tray" />
    </ReportsFrame>
  );
}
