import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { DraftIndicator, DraftOption, DraftSection, ObservationDraft } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { RatingScale, StatusChip, Tray } from "../../teacher/ui";
import type { RatingOption } from "../../teacher/ui/RatingScale";
import { FOCUS, GRID, LIST_CARD, OUTLINE_WIDE, PRIMARY_WIDE } from "../../teacher/ui/styles";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { FORM_V7, type FormV7Copy } from "../flow/copyV7form";
import { REPORTS, type ReportsCopy } from "./copy";
import { rungName, titleOf, type Values } from "./formModel";
import { Problem } from "./V6Parts";
import { useIndicatorGuide } from "./indicatorGuide";

/**
 * bd-o15qnr.28 (queue #204, v7; #188's LOCK round, "Screens #206 found with no design", row 10) — the Feedback Form
 * review screens in the v6/v7 look, drawn ONLY when the v6/v7 switch is on (useFlowV6); off, FeedbackForm and Obs612Form
 * draw today's screens untouched. Boards: m9-ff-v6 (+ -ur), m9-ff-save, m9-ff-fico-s, m9-ff-fde, p9-ff-v6.
 *
 *   the crumb       "<teacher> · Now: Fill the form" (the status line's words); once read only, "<teacher> · Form filled"
 *   chips           the rubric (and, for FICO-S / FDE, the tool and the class's grade) as a chip; "Saved 10:58 AM" once
 *                   a part is saved (FICO-S and FDE save part by part)
 *   the legend      Coach score (the principal: Your level) · Rumi's level, ringed purple
 *   one indicator   its code as a chip and its name; "Changed from <Rumi's level>" above the levels; the levels as the
 *                   kit's RatingScale look="radio" (Rumi's row edged purple, tagged "Rumi"; N/A and Couldn't tell as
 *                   pills); Evidence and To improve; one of the six: "From the recording" read only, then "Why this
 *                   level (20 letters at least)"
 *   the part        ONE amber "Why you changed it" when one of Rumi's levels on it is changed
 *   the Save tray   "<n> ratings · <levels> and <notes> changed from Rumi's", Save and continue, Keep checking,
 *                   "Next: Record the debrief"
 *
 * Same keys, same rules, same saves as today (formModel.ts, v6Model.ts): only the look changes. Words: copyV7form.ts,
 * reports/copy.ts and flow/copyV7.ts; the rubric's levels and the bot's text are data.
 *
 * bd-o15qnr.31 (#188, 21 Nov) — a FICO17 v6 draft is drawn collapsed (FormV7List.tsx: sections, one row per indicator,
 * one indicator alone, evidence option B with editing); this file keeps the pieces both share and the older FICO
 * review's paged look. Every text box is sized to its text (AutoText: one row to start, as tall as its words, no inner
 * scroll; each paragraph its own direction, unicode-bidi: plaintext), and a gap is a short toast (FormToast).
 */

const FIELD = "w-full rounded-xl border border-[#d1d5db] bg-white px-3 py-2.5 text-[16px] leading-snug text-[#1d2025]";
const LABEL = "text-[13px] font-bold text-[#6b7280]";
const CARD = cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5");

/** Urdu content (any Arabic-script letter): Nastaliq and right to left whatever the app's language (index.css data-urdu). */
const URDU = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const urduOf = (text: string | null | undefined): { lang?: "ur"; "data-urdu"?: "" } => (URDU.test(text ?? "") ? { lang: "ur", "data-urdu": "" } : {});

/**
 * bd-o15qnr.31 — a text box sized to its text: one row to start, as tall as its words as they are typed (no inner
 * scroll), each paragraph its own direction (English left to right, Urdu right to left; `unicode-bidi: plaintext`).
 */
export const AutoText = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "rows" | "dir"> & { value: string }>(
  function AutoText({ value, className, ...rest }, ref) {
    const own = useRef<HTMLTextAreaElement | null>(null);
    const fit = useCallback(() => {
      const el = own.current;
      if (!el) return;
      el.style.height = "auto";
      // Hidden (a closed tray): nothing to measure; the next change fits it.
      if (!el.scrollHeight) { el.style.height = ""; return; }
      el.style.height = `${el.scrollHeight + Math.max(0, el.offsetHeight - el.clientHeight)}px`;
    }, []);
    useLayoutEffect(fit, [value, fit]);
    useEffect(() => {
      window.addEventListener("resize", fit);
      return () => window.removeEventListener("resize", fit);
    }, [fit]);
    const attach = (el: HTMLTextAreaElement | null) => {
      own.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    };
    return (
      <textarea ref={attach} rows={1} dir="auto" value={value} data-autosize="" {...urduOf(value)} {...rest}
        className={cn("min-h-[56px] resize-none overflow-hidden [unicode-bidi:plaintext]", className)} />
    );
  },
);

/** How long a gap's toast stays (niete-portal: nothing vanishes before she can read it); Undo's is the operator's 5 s. */
export const GAP_MS = 10_000;
export const UNDO_MS = 5_000;
export type FormToastState = { text: string; ms: number; n: number; action?: { label: string; run: () => void } } | null;

/** One toast at a time, gone after its time (a new one restarts the clock). */
export function useFormToast() {
  const [toast, setToast] = useState<FormToastState>(null);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.ms);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback((text: string, ms = GAP_MS, action?: { label: string; run: () => void }) => {
    setToast((cur) => ({ text, ms, action, n: (cur?.n ?? 0) + 1 }));
  }, []);
  const hide = useCallback(() => setToast(null), []);
  return { toast, show, hide };
}

/** The toast over the dock: a short line, and Undo when there is one. */
export function FormToast({ toast, onDone }: { toast: FormToastState; onDone: () => void }) {
  if (!toast) return null;
  return (
    <div data-testid="ff-toast" role="status" aria-live="polite"
      className="fixed inset-x-4 bottom-[104px] z-40 mx-auto flex min-h-[56px] max-w-[420px] items-center gap-3 rounded-[14px] bg-[#1f2429] ps-4 pe-2 text-[15px] text-white shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
      <span className="min-w-0 flex-1" dir="auto">{toast.text}</span>
      {toast.action ? (
        <button type="button" onClick={() => { toast.action?.run(); onDone(); }}
          className={cn("min-h-[56px] shrink-0 rounded-xl px-3 font-bold text-[#9be3bd]", FOCUS)}>{toast.action.label}</button>
      ) : null}
    </div>
  );
}

/** Scroll a field into view and put the focus on it (a level group: its chosen level, else the first). */
export function focusField(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  const target = (el.matches("textarea, input, button, select, [tabindex]") ? el : null)
    ?? el.querySelector<HTMLElement>('[role="radio"][tabindex="0"], [role="radio"], textarea, input, button')
    ?? el;
  target.scrollIntoView?.({ block: "center" });
  target.focus?.({ preventScroll: true });
  return true;
}

/** The crumb: the teacher, then where the form is (the status line's own words). */
export function v7Crumb(W7: FlowV7Copy, name: string, filled: boolean): string {
  return `${name} · ${filled ? W7.steps[1].done : W7.now(W7.steps[1].current)}`;
}

/** The rubric (and the tool, the class) as a chip; the Saved stamp beside it. */
export function FormChips({ label, saved, extra }: { label?: string | null; saved?: string | null; extra?: ReactNode }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  if (!label && !saved && !extra) return null;
  return (
    <div data-testid="form-chips" className="flex flex-wrap items-center gap-2 px-1">
      {label ? <span data-testid="rubric-label" className="inline-flex"><StatusChip text={label} tone="info" /></span> : null}
      {saved ? <StatusChip text={F.savedAt(saved)} tone="done" tick /> : null}
      {extra}
    </div>
  );
}

/**
 * Whose level is which: yours filled, the Digital Coach's ringed purple. bd-o15qnr.36 (the operator 21 Nov ~14:20):
 * it reads "You · Digital Coach", the coach's and the principal's alike.
 */
export function Legend(_props: { principal: boolean }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <div data-testid="legend" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[13px] font-medium text-[#4b5563]">
      <span className="flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded-full bg-[#33374a]" />{F.legendYou}</span>
      <span aria-hidden="true" className="text-[#9ca3af]">{" · "}</span>
      <span className="flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded-full border-[3px] border-[#6e52e0]" />{F.legendDc}</span>
    </div>
  );
}

export function PartTitle({ text }: { text: string }) {
  return <h2 className="mx-1 mt-0.5 text-[20px] font-light leading-[1.3]" dir="auto">{text}</h2>;
}

/** A plain line under a part's title (FDE: no Rumi levels; FICO-S / FDE: saved part by part). */
export function PartNote({ text }: { text: string }) {
  return <p className="m-0 px-1 text-[14px] leading-snug text-[#6b7280]">{text}</p>;
}

/** The dock: Back (1) beside the next step (2), as the boards draw it; Back alone takes the width. */
export function DockV7({ children, single = false }: { children: ReactNode; single?: boolean }) {
  return <div data-testid="form-dock" className={cn(GRID, "w-full gap-2.5", single ? "grid-cols-1" : "grid-cols-[1fr_2fr]")}>{children}</div>;
}

export function Head({ code, name }: { code: string; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip text={code} tone="score" />
      <h3 className="m-0 min-w-0 flex-1 text-[16px] font-semibold leading-[1.3]" dir="auto">{name}</h3>
    </div>
  );
}

export function TextBox({ id, label, value, onChange, readOnly, problem }: {
  id: string; label: string; value: string; onChange: (v: string) => void; readOnly: boolean; problem?: string | null;
}) {
  if (readOnly) {
    return value ? (
      <div className="flex flex-col gap-0.5">
        <span className={LABEL}>{label}</span>
        <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed" dir="auto">{value}</p>
      </div>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <AutoText id={id} value={value} onChange={(e) => onChange(e.target.value)}
        aria-invalid={problem ? true : undefined} className={cn(FIELD, FOCUS, problem && "border-[#c8331f]")} />
      <Problem text={problem ?? null} />
    </div>
  );
}

/**
 * bd-o15qnr.37 (#204, the operator 22 Nov ~00:15) — under an indicator's name: one plain line on what it looks at, muted,
 * two lines at most; and "Examples", which opens that indicator in the "?" guide, only when the guide (#217) has it.
 * FICO17 v6.1 (FormV7List) and FICO-S v1.2 (Obs612Form), coach and principal alike.
 */
export function AboutLine({ text, rubric, code }: { text: string; rubric: string; code: string }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  const guide = useIndicatorGuide();
  const examples = !!guide && guide.has(rubric, code);
  return (
    <div data-testid="ff-about" className="flex flex-col items-start gap-0.5 px-1">
      <p className="m-0 line-clamp-2 text-[14px] leading-snug text-[#6b7280] [unicode-bidi:plaintext] rtl:leading-[1.9]" dir="auto" {...urduOf(text)}>{text}</p>
      {examples ? (
        <button type="button" onClick={() => guide.open(rubric, code)}
          className={cn("min-h-[44px] text-[13px] font-semibold text-[#6e52e0] underline underline-offset-2", FOCUS)}>{F.examples}</button>
      ) : null}
    </div>
  );
}

/** Rumi's evidence for one of the six: read only, dashed, never a box the coach types in. */
export function ReadOnlyBox({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <p className="m-0 whitespace-pre-line rounded-xl border border-dashed border-[#d1d5db] bg-[#f9fafb] px-3 py-2.5 text-[14px] leading-relaxed text-[#374151] [unicode-bidi:plaintext]" dir="auto">{text}</p>
    </div>
  );
}

/** N/A and Couldn't tell go after the four levels, as pills. */
const asideOf = (o: RatingOption): RatingOption => (o.id === "NA" || o.id === "IE" || o.id === "na" ? { ...o, aside: true } : o);

export function Levels({ name, value, options, dc, onChange }: {
  name: string; value: string; options: RatingOption[]; dc: string | null; onChange: (v: string) => void;
}) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <RatingScale look="radio" name={name} value={value || null} options={options.map(asideOf)} dcValue={dc} dcTag={F.rumiTag}
      copy={{ digitalCoach: F.rumisLevel }} onChange={(k) => onChange(String(k))} />
  );
}

/** A level's words: its name, or N/A / Couldn't tell (with the indicator's own N/A words). */
export function levelWords(options: RatingOption[], id: string | null | undefined): string | null {
  const o = options.find((x) => x.id === id);
  if (!o) return id || null;
  return o.label && !o.text ? o.label : [o.text, o.label].filter(Boolean).join(" · ");
}

/** An older FICO review's indicator (bd-4404s7.5), in the v7 look; the Digital Coach's level is Rumi's until the coach saves. */
export function IndicatorV7({ ind, scale, values, start, set, readOnly, dc }: {
  ind: DraftIndicator; scale: readonly DraftOption[]; values: Values; start: Values; set: (k: string) => (v: string) => void;
  readOnly: boolean; dc: boolean;
}) {
  const C = useCopy(REPORTS) as ReportsCopy;
  const F = useCopy(FORM_V7) as FormV7Copy;
  const rk = `r_${ind.field}`;
  const options: RatingOption[] = scale.map((o) => (o.id === "na" ? { id: o.id, text: C.na, label: rungName(o.title) } : { id: o.id, label: rungName(o.title) }));
  const was = start[rk] === "na" ? C.na : rungName(titleOf(scale, start[rk]));
  return (
    <section data-testid="indicator" className={CARD}>
      <Head code={ind.id} name={ind.name} />
      {!readOnly && values[rk] !== start[rk] && <StatusChip text={F.changedFrom(was)} tone="waiting" className="self-start" />}
      {readOnly
        ? (values[rk] ? <StatusChip text={titleOf(scale, values[rk])} tone="info" className="self-start" /> : null)
        : <Levels name={ind.name} value={values[rk] || ""} options={options} dc={dc ? (start[rk] || null) : null} onChange={set(rk)} />}
      <TextBox id={`ev_${ind.field}`} label={F.evidence} value={values[`ev_${ind.field}`] ?? ""} onChange={set(`ev_${ind.field}`)} readOnly={readOnly} />
      <TextBox id={`imp_${ind.field}`} label={C.toImprove} value={values[`imp_${ind.field}`] ?? ""} onChange={set(`imp_${ind.field}`)} readOnly={readOnly} />
    </section>
  );
}

/**
 * What the Save tray counts: the levels set (r_<field>), and the levels and notes changed from where the form started
 * (Rumi's, until the coach has saved once). The six set from the room are the coach's, never Rumi's, so setting one is
 * not a change; the coach's own reasons (why_, chg_, D2's counts) are not notes changed.
 */
export function v7Changes(draft: Pick<ObservationDraft, "sections" | "saved">, start: Values, values: Values) {
  const own = new Set<string>();
  for (const s of draft.sections as DraftSection[]) {
    if (s.kind === "v6") for (const ind of s.indicators) if (ind.kind === "combined") own.add(`r_${ind.field}`);
  }
  let levels = 0;
  let notes = 0;
  for (const k of Object.keys(values)) {
    if ((values[k] ?? "") === (start[k] ?? "")) continue;
    if (/^(r|fid_r)_/.test(k)) { if (!own.has(k)) levels += 1; } else if (/^(ev|imp|fid_e)_/.test(k)) notes += 1;
  }
  const rated = Object.keys(values).filter((k) => /^r_/.test(k) && String(values[k] ?? "").trim() !== "").length;
  return { rated, levels, notes, fromRumi: !draft.saved };
}

/** The Save tray (m9-ff-save). */
export function SaveTrayV7({ open, saving, onSave, onClose, counts }: {
  open: boolean; saving: boolean; onSave: () => void; onClose: () => void; counts: ReturnType<typeof v7Changes>;
}) {
  const C = useCopy(REPORTS) as ReportsCopy;
  const F = useCopy(FORM_V7) as FormV7Copy;
  const W7 = useCopy(FLOW_V7) as FlowV7Copy;
  const changes = counts.levels + counts.notes === 0 ? C.noChanges : F.changedSummary(counts.levels, counts.notes, counts.fromRumi);
  return (
    <Tray open={open} title={C.saveTitle} onClose={onClose} testId="save-tray">
      <div className="flex flex-col gap-3 pb-2">
        <p className="m-0 px-1 text-[15px] leading-snug text-[#4b5563]">{`${F.ratings(counts.rated)} · ${changes}`}</p>
        <button type="button" onClick={onSave} disabled={saving} className={cn(PRIMARY_WIDE, "disabled:opacity-60", FOCUS)}>
          {saving ? C.saving : C.saveContinue}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className={cn(OUTLINE_WIDE, FOCUS)}>{C.keepChecking}</button>
        <p className="m-0 text-center text-[13px] text-[#6b7280]">{F.nextStep(W7.steps[2].current)}</p>
      </div>
    </Tray>
  );
}
