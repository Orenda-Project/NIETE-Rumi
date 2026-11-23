import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { leader } from "../../services/api";
import type { Obs612Draft, Obs612ErrorCode, Obs612Field, Obs612Part, Obs612Refusal } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { ConfirmTray, RatingScale, SelectField, StatusChip, StepBar } from "../../teacher/ui";
import { FOCUS, GRID, LIST_CARD, OUTLINE_WIDE, PRIMARY_WIDE } from "../../teacher/ui/styles";
import { BottomButton } from "../ui";
import ReportsFrame from "./ReportsFrame";
import { REPORTS } from "./copy";
import { rungName } from "./formModel";
import { OBSERVATION_STEPS, SCREEN_STEP } from "./paths";
import { useFlowV6 } from "../flow/useCoachFlowV2";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { FORM_V7, type FormV7Copy } from "../flow/copyV7form";
import { clockOf } from "../../teacher/ui";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import {
  AboutLine, AutoText, DcEvidenceBox, DcNote, DcQuoteRow, DockV7, FormChips, FormToast, Legend, Levels, PartNote, PartTitle, TextBox, focusField, urduOf,
  useFormToast, v7Crumb,
} from "./FormV7";
import { IndicatorNav, IndicatorRow, IndicatorRows, SectionChips, SectionHead, SectionList, type SectionInfo } from "./FormV7Nav";
import { heldV7, keepV7 } from "./evidenceReview";

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
 *
 * bd-o15qnr.28 (v7; #188's boards m9-ff-fico-s, m9-ff-fde) — on the v6/v7 switch (useFlowV6) the same form in the v7
 * look, saved part by part: the rubric, the tool and the class's grade as a chip; "Saved 10:58 AM" beside it once a part
 * is saved; each item's levels as the kit's radio rows; Back and Next part, and BOTH save what changed on the part (no
 * "Save draft": nothing is left unsaved by moving); FDE says it has no Rumi levels; a score is a count, never a %
 * (the operator, 20 Nov: only the debrief score is a %). Off (or while /config is read), today's screen, unchanged.
 *
 * bd-o15qnr.31 (#188, 21 Nov) — on the switch every text box is sized to its text (AutoText), and moving on with gaps
 * ("Next part", or a refused Submit) shows a short counted toast ("2 items still need a level") AND scrolls to and
 * focuses the first unfilled item; the inline marks stay.
 *
 * bd-o15qnr.39.1 (#204, the operator 22 Nov) — on the switch, a FICO-S indicator the Digital Coach gave evidence for
 * (the bot's `dcEvidence`) shows it once, read only, in the "Digital Coach's evidence" box after its levels: its line
 * and each quote as an evidence row (time + quote). None: no box. Its N/A (C2, C3 on v1.2) is already a 5th radio row.
 * The Evidence box below stays the observer's own field, saved as before.
 */
type Values = Record<string, string>;
type Errors = Record<string, Obs612ErrorCode>;

/*
 * bd-o15qnr.40.6 (queue #229, the operator 23 Nov ~15:50: "why is 6-12 so different looking than the 1-5 one? Can they be
 * the same?") — on the switch, a FICO-S draft whose sections say what they are (the bot's `kind`, `sec`, `code`…) is drawn
 * with the 1-5 form's own pieces (FormV7Nav.tsx) and moves as it does: its sections as rows (A-E, then the checks and the
 * feedback), a section's indicators as rows, one indicator alone (Previous / Next, the line under the name with FICO-S's
 * scoring note folded in as its hint, the levels with the Digital Coach's marked on its card, "Changed from …" and "Why
 * you changed it", the Digital Coach's evidence, the observer's Evidence, "Agree and next"). Only the rubric's content
 * differs. Saving stays the bot's FICO-S save (every answer); Submit asks the bot, then the tray. An indicator the Digital
 * Coach set is green once its rules hold AND the observer agreed it (kept on this phone, as the 1-5 form keeps its
 * agreed); one the observer sets alone is green once its rules hold. An older bot (no `kind`): the parts, as before.
 */
type FsInd = { code: string; name: string; item: Obs612Field; ev: Obs612Field | null; chg: Obs612Field | null; none: string | null; star: string | null };
type FsGroup = { key: string; short: string; title: string; kind: "indicators" | "checklist" | "feedback"; inds: FsInd[]; parts: Obs612Part[] };
type FsAt = { at: "sections" } | { at: "section"; key: string } | { at: "indicator"; key: string; code: string };
type FsSlot = { key: string; code: string | null; label: string };
/** FICO-S's own minimums (the bot's EVIDENCE_MIN and its change-reason rule). */
const FS_EVIDENCE_MIN = 20;
const FS_CHANGE_MIN = 20;
const chars = (v: string | undefined) => Array.from(String(v ?? "").trim()).length;

function fsGroupsOf(sections: Obs612Draft["sections"], short: { checks: string; feedback: string }): FsGroup[] {
  const out: FsGroup[] = [];
  for (const s of sections) {
    if (s.kind === "intro" && s.sec) out.push({ key: s.sec, short: s.sec, title: `${s.sec}. ${s.title ?? ""}`.trim(), kind: "indicators", inds: [], parts: s.parts });
    else if (s.kind === "indicator" && s.code) {
      const g = out.find((x) => x.key === s.sec && x.kind === "indicators");
      const fields = fieldsOf(s.parts);
      const item = fields.find((f) => f.role === "item");
      if (!g || !item) continue;
      const subs = s.parts.filter((p): p is Extract<Obs612Part, { type: "sub" }> => p.type === "sub");
      g.inds.push({
        code: s.code, name: s.name || s.code, item,
        ev: fields.find((f) => f.name === `ev_${s.code}`) ?? null,
        chg: fields.find((f) => f.name === `chg_${s.code}`) ?? null,
        none: subs.find((p) => p.dc === "none")?.text ?? null,
        star: s.starred ? (subs.find((p) => !p.dc)?.text ?? null) : null,
      });
    } else if (s.kind === "checklist" || s.kind === "feedback") {
      const head = s.parts.find((p) => p.type === "heading");
      out.push({ key: s.kind, short: s.kind === "checklist" ? short.checks : short.feedback, title: head && head.type === "heading" ? head.text : s.kind, kind: s.kind, inds: [], parts: s.parts });
    }
  }
  return out.filter((g) => g.kind !== "indicators" || g.inds.length > 0);
}

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
  const v7 = useFlowV6() === true;
  const F = useCopy(FORM_V7) as FormV7Copy;
  const W7 = useCopy(FLOW_V7) as FlowV7Copy;
  const kit = useKitCopy();
  // bd-o15qnr.28 — when a part was last saved here (an ISO stamp), for the v7 look's "Saved 10:58 AM".
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<Obs612Draft>(first);
  const [values, setValues] = useState<Values>(() => valuesOf(first));
  const [part, setPart] = useState(0);
  const [shown, setShown] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  // bd-o15qnr.31 — v7: the gaps toast, and the field to focus once the part it is on is drawn.
  const { toast, show, hide } = useFormToast();
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    focusField(target);
  });

  const readOnly = !draft.editable;
  // bd-o15qnr.40.6 — FICO-S on the 1-5 form's pieces: where it is, and what the observer agreed (kept on this phone).
  const fsOn = v7 && draft.tool === "ficos" && draft.sections.some((x) => x.kind === "indicator");
  const fsGroups = useMemo(() => fsGroupsOf(draft.sections, { checks: F.checksShort, feedback: F.feedbackShort }), [draft.sections, F.checksShort, F.feedbackShort]);
  const [fsAt, setFsAt] = useState<FsAt>({ at: "sections" });
  // bd-o15qnr.40.9 — an indicator's one line (its item field's `about`), for the "Indicator to work on" rows.
  const aboutByCode = useMemo(() => {
    const out: Record<string, string> = {};
    for (const x of draft.sections) for (const f of fieldsOf(x.parts)) if (f.role === "item" && f.about) out[f.name] = f.about;
    return out;
  }, [draft.sections]);
  const [agreed, setAgreed] = useState<Set<string>>(() => new Set(heldV7(id)?.checked ?? []));
  useEffect(() => { if (fsOn && !readOnly && agreed.size) keepV7(id, agreed, {}); }, [fsOn, id, agreed, readOnly]);
  const total = draft.sections.length;
  const section = draft.sections[Math.min(part, Math.max(0, total - 1))];
  const last = part >= total - 1;
  // Queue #218 (FICO-S v1.2): a level that follows another arrives on N/A when that one is set to its level (C3 after
  // C1 = 1), unless the observer already chose it; they can change it. The rule is the bot's (the field's `follows`).
  const followers = draft.sections.flatMap((s) => fieldsOf(s.parts)).filter((f) => f.follows);
  const set = (k: string) => (v: string) => {
    setValues((cur) => {
      const next = { ...cur, [k]: v };
      for (const f of followers) {
        if (f.follows?.code === k && v === f.follows.level && !(cur[f.name] ?? "") && (f.options || []).some((o) => o.id === "NA")) next[f.name] = "NA";
      }
      return next;
    });
    setNote(null);
  };

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
    setSavedAt(new Date().toISOString());
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

  /** v7: a counted toast for the refused fields, and the first of them (in the form's order) focused. */
  const gaps = (errs: Errors, names: string[]) => {
    const bad = names.filter((k) => errs[k]);
    if (!bad.length) return false;
    show(bad.every((k) => errs[k] === "item") ? F.needLevel(bad.length) : F.needAnswer(bad.length));
    const f = draft.sections.flatMap((x) => fieldsOf(x.parts)).find((x) => x.name === bad[0]);
    focusNext.current = f && f.role === "item" ? `fde-item-${f.name}` : `fde-${bad[0]}`;
    return true;
  };

  const next = async () => {
    if (readOnly) { go(part + 1); return; }
    setBusy(true);
    try {
      const d = await store();
      const names = fieldsOf(section.parts).map((f) => f.name);
      mark(d, [...names, ...Object.keys(shown)]);
      if (v7 && gaps(d.errors, names)) return;
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
    if (fsOn) {
      // bd-o15qnr.40.6: open the first indicator (or section) the bot refused, as the 1-5 form opens its first gap
      for (const g of fsGroups) {
        const ind = g.inds.find((i) => [i.item.name, i.ev?.name, i.chg?.name].some((k) => k && errs[k]));
        if (ind) { setFsAt({ at: "indicator", key: g.key, code: ind.code }); break; }
        if (g.kind !== "indicators" && fieldsOf(g.parts).some((f) => errs[f.name])) { setFsAt({ at: "section", key: g.key }); break; }
      }
      gaps(errs, draft.sections.flatMap((x) => fieldsOf(x.parts)).map((f) => f.name));
      return;
    }
    go(firstPartWith(errs));
    if (v7) { gaps(errs, draft.sections.flatMap((x) => fieldsOf(x.parts)).map((f) => f.name)); return; }
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

  // bd-o15qnr.28 — v7: Back saves what changed on the part first (as Next does), then goes back.
  const stored = valuesOf(draft);
  const dirty = Object.keys(values).some((k) => (values[k] ?? "") !== (stored[k] ?? ""));
  const backSaving = async () => {
    if (readOnly || !dirty) { back(); return; }
    setBusy(true);
    try {
      await store();
      setBusy(false);
      back();
    } catch (err) {
      failed(err, C.saveFailed);
      setBusy(false);
    }
  };

  const dock = v7 ? (
    <DockV7 single={readOnly && last}>
      <BottomButton tone="outline" onClick={backSaving} disabled={busy}>{C.back}</BottomButton>
      {readOnly
        ? (!last ? <BottomButton onClick={next}>{C.next}</BottomButton> : null)
        : last
          ? <BottomButton onClick={askSubmit} disabled={busy}>{W.submit}</BottomButton>
          : <BottomButton onClick={next} disabled={busy}>{C.next}</BottomButton>}
    </DockV7>
  ) : readOnly ? (
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
    } else if (v7) {
      // bd-o15qnr.28 — every item's choices as the kit's radio rows (FDE's own titles and level words, as data).
      // bd-o15qnr.40.5 (queue #229): the Digital Coach's level marked ON its card, as the grades 1-5 form does (purple edge,
      // "Digital Coach" at its end, spoken with the card), with the You · Digital Coach legend above.
      const dcLevel = f.dcLevel && opts.some((o) => o.id === f.dcLevel) ? f.dcLevel : null;
      choices = (
        <>
          {dcLevel ? <Legend principal={false} /> : null}
          <RatingScale look="radio" name={groupName} value={v || null} onChange={(k) => set(f.name)(String(k))}
            dcValue={dcLevel} dcTag={F.rumiTag} copy={{ digitalCoach: F.rumisLevel }}
            options={opts.map((o) => ({ id: o.id, label: o.title, description: o.description }))} />
        </>
      );
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
    const dcEv = v7 && f.dcEvidence && (f.dcEvidence.because || f.dcEvidence.items.length) ? f.dcEvidence : null;
    const dcBox = dcEv ? (
      <DcEvidenceBox boxId="dc-box">
        {dcEv.because ? (
          <p data-testid="dc-summary" className="m-0 py-1 text-[15px] leading-relaxed text-[#1d2025] [unicode-bidi:plaintext]" dir="auto" {...urduOf(dcEv.because)}>{dcEv.because}</p>
        ) : null}
        {dcEv.items.map((q, n) => <DcQuoteRow key={`${q.time ?? ""}-${n}`} time={q.time} quote={q.quote} first={n === 0 && !dcEv.because} />)}
      </DcEvidenceBox>
    ) : null;
    return (
      <Fragment key={f.name}>
      <section data-testid="fde-item" id={v7 ? `fde-item-${f.name}` : undefined} className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5", bad && BAD)}>
        {v7 && f.about ? (
          // bd-o15qnr.37: a FICO-S indicator says what it looks at once, under its name (AboutLine after the heading);
          // the card keeps the rest of its words: the scoring note, the N/A note, "How: …".
          <div className="flex flex-col items-start gap-1.5">
            <StatusChip text={label} tone="score" />
            {f.notes ? <p data-testid="fde-notes" className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-[#4b5563] [unicode-bidi:plaintext]" dir="auto">{f.notes}</p> : null}
          </div>
        ) : v7 ? (
          // bd-o15qnr.28 — v7: the code chip and FDE's words for the item on one line (m9-ff-fde, m9-ff-fico-s).
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip text={label} tone="score" />
            {f.text ? <p className="m-0 min-w-0 flex-1 text-[16px] font-semibold leading-[1.3]" dir="auto">{f.text}</p> : null}
          </div>
        ) : (
          <>
            <StatusChip text={label} tone="score" className="self-start" />
            {f.text ? <p className="m-0 text-[16px] font-semibold leading-snug" dir="auto">{f.text}</p> : null}
          </>
        )}
        {choices}
        {errorLine(f)}
      </section>
      {dcBox}
      </Fragment>
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
            options={(f.options || []).map((o) => {
              // bd-o15qnr.40.9: an indicator's code is the row's tile ("A" over "1"); its second line is the indicator's
              // own line, never its name again
              const code = /^([A-Z])(\d{1,2})$/.exec(o.id);
              const again = !!o.description && o.title.includes(o.description);
              return { value: o.id, label: o.title, sub: aboutByCode[o.id] || (again ? undefined : o.description), ...(code ? { prefix: code[1], number: code[2] } : {}) };
            })} />
          {!f.required && v ? (
            <button type="button" onClick={() => set(f.name)("")} className={cn("min-h-[44px] self-start rounded-xl px-3 text-[14px] font-semibold text-[#33374a] underline", FOCUS)}>{W.clear}</button>
          ) : null}
        </div>
      );
      return <div key={f.name} id={v7 ? fid : undefined} className="flex flex-col gap-1">{input}{errorLine(f)}</div>;
    }
    const common = { id: fid, value: v, "aria-invalid": bad || undefined, "aria-describedby": bad ? `err-${f.name}` : undefined };
    if (f.input === "textarea") {
      input = v7
        ? <AutoText {...common} maxLength={f.max || undefined} onChange={(e) => set(f.name)(e.target.value)} className={cn(AREA, bad && BAD, FOCUS)} />
        : <textarea {...common} dir="auto" rows={3} maxLength={f.max || undefined} onChange={(e) => set(f.name)(e.target.value)} className={cn(AREA, bad && BAD, FOCUS)} />;
    } else if (f.input === "number") {
      input = <input {...common} dir="auto" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} onChange={(e) => set(f.name)(e.target.value)} className={cn(AREA, "min-h-[56px]", bad && BAD, FOCUS)} />;
    } else {
      input = <input {...common} dir="auto" type="text" maxLength={f.max || undefined} onChange={(e) => set(f.name)(e.target.value)} className={cn(AREA, "min-h-[56px]", bad && BAD, FOCUS)} />;
    }
    return <div key={f.name} className="flex flex-col gap-1">{head}{input}{errorLine(f)}</div>;
  };

  // bd-o15qnr.37: the indicator (item field) under a heading that carries its line on what it looks at, if any.
  const aboutUnder = (i: number): Obs612Field | null => {
    const parts = section ? section.parts : [];
    for (let j = i + 1; j < parts.length; j += 1) {
      const q = parts[j];
      if (q.type === "heading") return null;
      if (q.type === "field" && q.role === "item" && q.about) return q;
    }
    return null;
  };

  const partView = (p: Obs612Part, i: number) => {
    if (p.type === "heading") {
      if (v7) {
        const about = aboutUnder(i);
        return (
          <Fragment key={i}>
            <PartTitle text={p.text} />
            {about?.about ? <AboutLine text={about.about} rubric={draft.rubricId} code={about.name} /> : null}
          </Fragment>
        );
      }
      return <h2 key={i} className="mx-1 mt-1 text-[20px] font-semibold leading-[1.25]" dir="auto">{p.text}</h2>;
    }
    // bd-o15qnr.40.5 — on the switch, "The Digital Coach chose N" is said on the card itself (dcLevel), not as a line.
    if (p.type === "sub" && v7 && p.dc === "chose") return null;
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
          <b className="text-[20px] font-bold tabular-nums" dir="ltr">{v7 ? `${p.total} / ${p.max}` : `${p.total} / ${p.max} (${p.pct}%)`}</b>
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

  if (fsOn) {
    const isDirty = () => Object.keys(values).some((k) => (values[k] ?? "") !== (stored[k] ?? ""));
    const changed = (ind: FsInd) => !!ind.item.dcLevel && !!values[ind.item.name] && values[ind.item.name] !== ind.item.dcLevel;
    const gapsOf = (ind: FsInd): Errors => {
      const out: Errors = {};
      if (!(ind.item.options || []).some((o) => o.id === (values[ind.item.name] ?? ""))) out[ind.item.name] = "item";
      if (ind.ev && ind.ev.required && chars(values[ind.ev.name]) < FS_EVIDENCE_MIN) out[ind.ev.name] = "evidence";
      if (ind.chg && changed(ind) && chars(values[ind.chg.name]) < FS_CHANGE_MIN) out[ind.chg.name] = "change";
      return out;
    };
    const indDone = (ind: FsInd, ag = agreed) => readOnly || (Object.keys(gapsOf(ind)).length === 0 && (!ind.item.dcLevel || ag.has(ind.code)));
    const fieldDone = (f: Obs612Field) => readOnly || !f.required
      || (f.kind === "yes_no" ? ["yes", "no"].includes(values[f.name] ?? "") : chars(values[f.name]) > 0);
    const infoOf = (g: FsGroup, ag = agreed): SectionInfo => {
      const flags = g.kind === "indicators" ? g.inds.map((i) => indDone(i, ag)) : fieldsOf(g.parts).filter((f) => f.required).map(fieldDone);
      const done = flags.filter(Boolean).length;
      return { flags, done, total: flags.length, complete: done === flags.length };
    };
    const yellowWith = (ag: Set<string>): FsSlot[] => fsGroups.flatMap((g) => (g.kind === "indicators"
      ? g.inds.filter((i) => !indDone(i, ag)).map((i) => ({ key: g.key, code: i.code, label: F.nextToCheck(i.code, i.name) }))
      : (infoOf(g, ag).complete ? [] : [{ key: g.key, code: null, label: F.nextToCheck(g.short, "").trim() }])));
    const yellow = yellowWith(agreed);
    const left = fsGroups.filter((g) => !infoOf(g).complete).length;
    const nextSlot = (key: string, ag: Set<string>): FsSlot | null => {
      const list = yellowWith(ag);
      const i = Math.max(0, fsGroups.findIndex((g) => g.key === key));
      for (const g of [...fsGroups.slice(i), ...fsGroups.slice(0, i)]) { const hit = list.find((y) => y.key === g.key); if (hit) return hit; }
      return null;
    };
    const toTop = () => top.current?.scrollIntoView?.({ block: "start" });
    const moveTo = (to: FsAt) => { setShown({}); setNote(null); setFsAt(to); toTop(); };
    /** Leave a view: what changed is saved first (as the parts' Back and Next did). */
    const saveThen = async (then: () => void, names: string[] = []) => {
      if (readOnly || !isDirty()) { then(); return; }
      setBusy(true);
      try {
        const d = await store();
        if (names.length) { mark(d, names); if (gaps(d.errors, names)) return; }
        then();
      } catch (err) {
        failed(err, C.saveFailed);
      } finally {
        setBusy(false);
      }
    };
    const open = (slot: FsSlot) => moveTo(slot.code ? { at: "indicator", key: slot.key, code: slot.code } : { at: "section", key: slot.key });
    const fsBack = () => saveThen(() => {
      if (fsAt.at === "indicator") moveTo({ at: "section", key: fsAt.key });
      else if (fsAt.at === "section") moveTo({ at: "sections" });
      else navigate(home);
    });
    const submitAll = () => {
      if (yellow.length) {
        show(F.toCheck(yellow.length));
        const g = fsGroups.find((x) => !infoOf(x).complete);
        if (g) focusField(`ff-sec-${g.key}`);
        return;
      }
      void askSubmit();
    };
    const chip = [draft.label, draft.toolName && draft.toolName !== draft.label ? draft.toolName : null, draft.grade ? F.gradeShort(draft.grade) : null]
      .filter(Boolean).join(" · ");
    const saved = savedAt ? clockOf(savedAt, kit.am, kit.pm) : null;
    const frame = (crumb: string, dock: ReactNode, body: ReactNode) => (
      <ReportsFrame title={C.formTitle} crumb={crumb} onBack={fsBack} dock={dock} testId="coach-fde-form" dockSpace>
        <div ref={top} />
        {body}
        {note && (
          <div role={note.ok ? "status" : "alert"} className={cn(NOTE, note.ok ? "bg-[#eaf6ef] text-[#2f7a52]" : "bg-[#fee4e2] text-[#c8331f]")}>{note.text}</div>
        )}
        <FormToast toast={toast} onDone={hide} />
        <ConfirmTray open={confirm} title={W.submitTitle} warning={W.noChangesAfter} onClose={() => setConfirm(false)}
          confirmLabel={W.yesSubmit} onConfirm={submit} cancelLabel={C.keepChecking} testId="fde-submit-tray" />
      </ReportsFrame>
    );
    const crumbBase = name ? v7Crumb(W7, name, readOnly) : C.observation;

    /* ── the sections ── */
    if (fsAt.at === "sections") {
      const dock = readOnly ? undefined : (
        <DockV7 single>
          <button type="button" onClick={submitAll} disabled={busy} aria-disabled={left > 0 || undefined}
            className={cn(PRIMARY_WIDE, left > 0 && "bg-[#e5e7eb] text-[#6b7280]", FOCUS)}>
            {left > 0 ? F.submitLeft(left) : W.submit}
          </button>
        </DockV7>
      );
      return frame(crumbBase, dock, (
        <>
          <FormChips label={chip} saved={saved} extra={draft.sealed ? <StatusChip text={W.submitted} tone="done" tick /> : null} />
          {readOnly && !draft.sealed ? <p className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.readOnly}</p> : null}
          <SectionList items={fsGroups.map((g) => ({ key: g.key, title: g.title, info: infoOf(g) }))} onOpen={(key) => moveTo({ at: "section", key })} />
        </>
      ));
    }

    const g = fsGroups.find((x) => x.key === fsAt.key) ?? fsGroups[0];
    const chips = (
      <SectionChips items={fsGroups.map((x) => ({ key: x.key, short: x.short, title: x.title, info: infoOf(x) }))} current={g.key}
        onOpen={(key) => saveThen(() => moveTo({ at: "section", key }))} />
    );

    /* ── a section ── */
    if (fsAt.at === "section" || g.kind !== "indicators") {
      const info = infoOf(g);
      const names = fieldsOf(g.parts).map((f) => f.name);
      const next = nextSlot(g.key, agreed);
      const dock = (
        <DockV7 single>
          {next && !(next.key === g.key && !next.code)
            ? <BottomButton onClick={() => saveThen(() => open(next), names)} disabled={busy}>{next.label}</BottomButton>
            : <BottomButton onClick={() => saveThen(() => moveTo({ at: "sections" }), names)} disabled={busy}>{F.doneChecking}</BottomButton>}
        </DockV7>
      );
      return frame(crumbBase, dock, (
        <>
          {chips}
          <div data-testid="ff-section" className="flex flex-col gap-2.5">
            <SectionHead title={g.title} info={info} />
            {g.kind === "indicators" ? (
              <IndicatorRows>
                {g.inds.map((ind, i) => {
                  const v = values[ind.item.name] ?? "";
                  return (
                    <IndicatorRow key={ind.code} code={ind.code} name={ind.name} first={i === 0} done={info.flags[i]}
                      line={ind.item.dcEvidence?.because || ind.none || ind.item.about || null}
                      words={v ? titleOf(ind.item, v) : null}
                      onOpen={() => moveTo({ at: "indicator", key: g.key, code: ind.code })} />
                  );
                })}
              </IndicatorRows>
            ) : g.parts.map((p, i) => (p.type === "heading" ? null : partView(p, i)))}
          </div>
        </>
      ));
    }

    /* ── one indicator ── */
    const list = g.inds;
    const index = Math.max(0, list.findIndex((x) => x.code === fsAt.code));
    const ind = list[index];
    const lv = values[ind.item.name] ?? "";
    const options = (ind.item.options || []).map((o) => ({ id: o.id, label: o.title, description: o.description }));
    const isChanged = changed(ind);
    // bd-o15qnr.40.8 (queue #229, the operator 23 Nov): a box with a minimum says the real reason with its count, under a
    // live counter; the reason shows after Agree and next or leaving the box, never while typing.
    const minOf = (k: string) => (k === ind.ev?.name ? FS_EVIDENCE_MIN : k === ind.chg?.name ? FS_CHANGE_MIN : 0);
    const problem = (k: string | undefined) => {
      if (!k || !shown[k]) return null;
      const min = minOf(k);
      if (min && ["evidence", "change", "text"].includes(shown[k])) return F.tooShort(chars(values[k]), min);
      return W.errors[shown[k]] ?? null;
    };
    const counter = (k: string, min: number) => {
      const n = chars(values[k]);
      return <span data-testid="char-count" className={cn("px-1 text-[13px] tabular-nums", n >= min ? "text-[#2f7a52]" : "text-[#6b7280]")}>{F.charCount(n, min)}</span>;
    };
    const typing = (k: string) => (v: string) => {
      set(k)(v);
      setShown((cur) => { if (!cur[k]) return cur; const next = { ...cur }; delete next[k]; return next; });
    };
    const leave = (k: string, min: number, code: Obs612ErrorCode) => () => {
      if (chars(values[k]) < min) setShown((cur) => ({ ...cur, [k]: code }));
    };
    const dcEv = ind.item.dcEvidence && (ind.item.dcEvidence.because || ind.item.dcEvidence.items.length) ? ind.item.dcEvidence : null;
    const dcBox = ind.star || ind.none || dcEv ? (
      <DcEvidenceBox boxId="dc-box">
        {ind.star ? <DcNote text={ind.star} /> : null}
        {ind.none ? <DcNote text={ind.none} /> : null}
        {dcEv?.because ? (
          <p data-testid="dc-summary" className="m-0 py-1 text-[15px] leading-relaxed text-[#1d2025] [unicode-bidi:plaintext]" dir="auto" {...urduOf(dcEv.because)}>{dcEv.because}</p>
        ) : null}
        {(dcEv?.items ?? []).map((q, n) => <DcQuoteRow key={`${q.time ?? ""}-${n}`} time={q.time} quote={q.quote} first={n === 0 && !dcEv?.because && !ind.star && !ind.none} />)}
      </DcEvidenceBox>
    ) : null;
    const agree = async () => {
      const local = gapsOf(ind);
      if (Object.keys(local).length) { setShown(local); gaps(local, Object.keys(local)); return; }
      setBusy(true);
      try {
        const d = isDirty() ? await store() : draft;
        const names = [ind.item.name, ind.ev?.name, ind.chg?.name].filter((k): k is string => !!k);
        mark(d, names);
        if (gaps(d.errors, names)) return;
        const ag = new Set(agreed).add(ind.code);
        setAgreed(ag);
        const after = [...list.slice(index + 1), ...list.slice(0, index)].find((x) => !indDone(x, ag));
        moveTo(after ? { at: "indicator", key: g.key, code: after.code } : { at: "section", key: g.key });
      } catch (err) {
        failed(err, C.saveFailed);
      } finally {
        setBusy(false);
      }
    };
    const dock = readOnly ? undefined : (
      <DockV7 single><BottomButton onClick={agree} disabled={busy}>{F.agreeNext}</BottomButton></DockV7>
    );
    return frame(F.indicatorCrumb(name || C.formTitle, g.key, index + 1, list.length), dock, (
      <section data-testid="ff-indicator" className="flex flex-col gap-2.5">
        <IndicatorNav code={ind.code} name={ind.name} index={index} count={list.length}
          onGo={(n) => moveTo({ at: "indicator", key: g.key, code: list[n].code })} />
        {ind.item.about ? <AboutLine text={ind.item.about} hint={ind.item.notes || null} rubric={draft.rubricId} code={ind.code} /> : null}
        <div data-testid="ff-card" className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5")}>
          {!readOnly && ind.item.dcLevel ? <Legend principal={false} /> : null}
          {isChanged && !readOnly ? <StatusChip text={F.changedFrom(titleOf(ind.item, ind.item.dcLevel || ""))} tone="waiting" className="self-start" /> : null}
          {readOnly
            ? (lv ? <StatusChip text={titleOf(ind.item, lv)} tone="info" className="self-start" /> : null)
            : (
              <div id={`fde-item-${ind.item.name}`} className="flex flex-col gap-1">
                <Levels name={ind.item.short || ind.name} value={lv} options={options} dc={ind.item.dcLevel ?? null} onChange={set(ind.item.name)} />
                {errorLine(ind.item)}
              </div>
            )}
          {ind.chg && ((isChanged && !readOnly) || (readOnly && values[ind.chg.name])) ? (
            <div data-testid="why-changed" className="flex flex-col gap-2.5 rounded-2xl border border-[#fde7b0] bg-[#fffbeb] p-3">
              <TextBox id={`fde-${ind.chg.name}`} label={F.whyChanged} value={values[ind.chg.name] ?? ""} onChange={typing(ind.chg.name)} readOnly={readOnly}
                problem={problem(ind.chg.name)} hint={readOnly ? null : counter(ind.chg.name, FS_CHANGE_MIN)} onBlur={leave(ind.chg.name, FS_CHANGE_MIN, "change")} />
            </div>
          ) : null}
          {dcBox}
          {ind.ev ? (
            <TextBox id={`fde-${ind.ev.name}`} label={F.evidence} value={values[ind.ev.name] ?? ""} onChange={typing(ind.ev.name)} readOnly={readOnly}
              problem={problem(ind.ev.name)} hint={readOnly || !ind.ev.required ? null : counter(ind.ev.name, FS_EVIDENCE_MIN)}
              onBlur={ind.ev.required ? leave(ind.ev.name, FS_EVIDENCE_MIN, "evidence") : undefined} />
          ) : null}
        </div>
        {readOnly ? <button type="button" onClick={fsBack} className={cn(OUTLINE_WIDE, FOCUS)}>{F.doneChecking}</button> : null}
      </section>
    ));
  }

  if (v7) {
    const items = section ? fieldsOf(section.parts).some((f) => f.role === "item") : false;
    // FDE (not FICO-S, which has Rumi's levels): said once, under the part's title.
    const noteAt = !readOnly && items && draft.tool !== "ficos" ? Math.max(0, section.parts.findIndex((p) => p.type === "heading")) : -1;
    const chip = [draft.label, draft.toolName && draft.toolName !== draft.label ? draft.toolName : null, draft.grade ? F.gradeShort(draft.grade) : null]
      .filter(Boolean).join(" · ");
    const saved = savedAt ? clockOf(savedAt, kit.am, kit.pm) : null;
    return (
      <ReportsFrame title={C.formTitle} crumb={name ? v7Crumb(W7, name, readOnly) : C.observation} onBack={backSaving} dock={dock} testId="coach-fde-form" dockSpace>
        <div ref={top} />
        {section && (
          <>
            <FormChips label={chip} saved={saved} extra={draft.sealed ? <StatusChip text={W.submitted} tone="done" tick /> : null} />
            <StepBar total={total} current={part + 1} label={C.partOf(part + 1, total)} />
            {readOnly && !draft.sealed ? <p className="px-1 text-[13px] font-semibold text-[#6b7280]">{C.readOnly}</p> : null}
            {section.parts.map((p, i) => (
              <Fragment key={i}>
                {partView(p, i)}
                {i === noteAt ? <PartNote text={F.noRumiLevels} /> : null}
              </Fragment>
            ))}
            {!readOnly ? <PartNote text={F.savedPartByPart} /> : null}
            {note && (
              <div role={note.ok ? "status" : "alert"} className={cn(NOTE, note.ok ? "bg-[#eaf6ef] text-[#2f7a52]" : "bg-[#fee4e2] text-[#c8331f]")}>{note.text}</div>
            )}
          </>
        )}

        <FormToast toast={toast} onDone={hide} />
        <ConfirmTray open={confirm} title={W.submitTitle} warning={W.noChangesAfter} onClose={() => setConfirm(false)}
          confirmLabel={W.yesSubmit} onConfirm={submit} cancelLabel={C.keepChecking} testId="fde-submit-tray" />
      </ReportsFrame>
    );
  }

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
