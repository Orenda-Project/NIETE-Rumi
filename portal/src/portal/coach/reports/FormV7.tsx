import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes, type TouchEvent as ReactTouchEvent } from "react";
import { X } from "lucide-react";
import { useKitCopy } from "../../teacher/ui/useKitCopy";
import { cn } from "@/lib/utils";
import type { DraftIndicator, DraftOption, DraftSection, ObservationDraft } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { RatingScale, StatusChip, Tray } from "../../teacher/ui";
import type { RatingOption } from "../../teacher/ui/RatingScale";
import { FOCUS, GRID, LIST_CARD, OUTLINE_WIDE, PRIMARY_WIDE, ROW_DIVIDER } from "../../teacher/ui/styles";
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
 *
 * bd-o15qnr.39.1 (#204, the operator 22 Nov) — on FICO17 v6.1 and FICO-S v1.2: the Digital Coach's findings in ONE box,
 * "Digital Coach's evidence" (DcEvidenceBox; none when it heard nothing); a v6 indicator's N/A is a 5th level card, not
 * a pill (asideOf); one of the six's line under its name also says how to fill it (AboutLine's `hint`).
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

/** A swipe this far sideways, or down, sends the toast away (bd-o15qnr.40.8). */
const SWIPE_X = 60;
const SWIPE_Y = 40;

/**
 * The toast over the dock: a short line, and Undo when there is one. bd-o15qnr.40.8 (queue #229, the operator 23 Nov:
 * "swipe-to-dismiss (swipe sideways or down, plus a tap/close)"): it follows the finger and goes with a swipe sideways or
 * down, or its close (×); it still times out by itself.
 */
export function FormToast({ toast, onDone }: { toast: FormToastState; onDone: () => void }) {
  const kit = useKitCopy();
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  if (!toast) return null;
  const at = (t: { clientX: number; clientY: number } | undefined) => (t ? { x: t.clientX, y: t.clientY } : null);
  const onStart = (e: ReactTouchEvent) => { start.current = at(e.touches[0]); setDrag({ x: 0, y: 0 }); };
  const onMove = (e: ReactTouchEvent) => {
    const p = at(e.touches[0]);
    if (start.current && p) setDrag({ x: p.x - start.current.x, y: Math.max(0, p.y - start.current.y) });
  };
  const onEnd = (e: ReactTouchEvent) => {
    const p = at(e.changedTouches[0]);
    const s0 = start.current;
    start.current = null;
    setDrag({ x: 0, y: 0 });
    if (s0 && p && (Math.abs(p.x - s0.x) >= SWIPE_X || p.y - s0.y >= SWIPE_Y)) onDone();
  };
  return (
    <div data-testid="ff-toast" role="status" aria-live="polite" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
      style={drag.x || drag.y ? { transform: `translate(${drag.x}px, ${drag.y}px)`, opacity: Math.max(0.3, 1 - (Math.abs(drag.x) + drag.y) / 200) } : undefined}
      className="fixed inset-x-4 bottom-[104px] z-40 mx-auto flex min-h-[56px] max-w-[420px] touch-none items-center gap-1 rounded-[14px] bg-[#1f2429] ps-4 pe-1 text-[15px] text-white shadow-[0_8px_20px_rgba(0,0,0,0.25)]">
      <span className="min-w-0 flex-1" dir="auto">{toast.text}</span>
      {toast.action ? (
        <button type="button" onClick={() => { toast.action?.run(); onDone(); }}
          className={cn("min-h-[56px] shrink-0 rounded-xl px-3 font-bold text-[#9be3bd]", FOCUS)}>{toast.action.label}</button>
      ) : null}
      <button type="button" aria-label={kit.close} onClick={onDone}
        className={cn("flex h-14 w-12 shrink-0 items-center justify-center rounded-xl text-white/80", FOCUS)}>
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
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
/**
 * bd-o15qnr.48 (#244) — a section's "Next to check: C1 Quality of Questions Asked by the Teacher" on ONE line inside the
 * button's padding, cut with "…" (it wrapped edge to edge at 390 px); its name keeps every word. min-w-0: the dock is a
 * grid, whose item would otherwise grow to the uncut line.
 */
export function NextButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid="ff-next-check"
      className={cn(PRIMARY_WIDE, "min-w-0 disabled:bg-[#e5e7eb] disabled:text-[#9ca3af]", FOCUS)}>
      <span className="min-w-0 truncate" dir="auto">{label}</span>
    </button>
  );
}

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

export function TextBox({ id, label, value, onChange, readOnly, problem, hint, onBlur }: {
  id: string; label: string; value: string; onChange: (v: string) => void; readOnly: boolean; problem?: string | null;
  /** bd-o15qnr.40.8 — a muted line under the box (a live character count); and what leaving the box does. */
  hint?: ReactNode; onBlur?: () => void;
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
      <AutoText id={id} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        aria-invalid={problem ? true : undefined} className={cn(FIELD, FOCUS, problem && "border-[#c8331f]")} />
      {hint}
      <Problem text={problem ?? null} />
    </div>
  );
}

/**
 * bd-o15qnr.37 (#204, the operator 22 Nov ~00:15) — under an indicator's name: one plain line on what it looks at, muted,
 * two lines at most; and "Examples", which opens that indicator in the "?" guide, only when the guide (#217) has it.
 * FICO17 v6.1 (FormV7List) and FICO-S v1.2 (Obs612Form), coach and principal alike.
 */
export function AboutLine({ text, rubric, code, hint }: { text: string; rubric: string; code: string; hint?: string | null }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  const guide = useIndicatorGuide();
  const examples = !!guide && guide.has(rubric, code);
  // bd-o15qnr.39.1 (#204, the operator 22 Nov): one of the six also says how to fill it, after its line (the bot's
  // `hint`: D2 "Chorus answers don't count."), in the same muted line; never clamped then, so the hint is never cut.
  return (
    <div data-testid="ff-about" className="flex flex-col items-start gap-0.5 px-1">
      <p className={cn("m-0 text-[14px] leading-snug text-[#6b7280] [unicode-bidi:plaintext] rtl:leading-[1.9]", !hint && "line-clamp-2")} dir="auto" {...urduOf(text)}>
        {text}
        {hint ? <>{" "}<span data-testid="ff-hint">{hint}</span></> : null}
      </p>
      {examples ? (
        <button type="button" onClick={() => guide.open(rubric, code)}
          className={cn("min-h-[44px] text-[13px] font-semibold text-[#6e52e0] underline underline-offset-2", FOCUS)}>{F.examples}</button>
      ) : null}
    </div>
  );
}

/**
 * bd-o15qnr.39.1 (#204, the operator 22 Nov: "not applicable should also just be a regular 5th option") — a FICO17 v6
 * indicator's N/A ("NA", only where the rubric offers it) is a 5th level card after the four, the same radio, named in
 * its own words ("N/A · No child was wrong") with its line from the rubric data. An old review's Couldn't tell ("IE") and
 * an older FICO review's "na" stay pills after the levels. The value saved is the option's id, as before.
 */
const asideOf = (o: RatingOption): RatingOption => {
  if (o.id === "NA") return { id: o.id, label: [o.text, o.label].filter(Boolean).join(" · "), description: o.description };
  return o.id === "IE" || o.id === "na" ? { ...o, aside: true } : o;
};

/* ── bd-o15qnr.39.1: the Digital Coach's evidence, one box ─────────────────────────────────────────────────────── */

/** A lesson time as a chip (the FICO17 form's TimeChip plays the lesson from it when the recording is on the page). */
export const TIME_CHIP = "inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-[#eef0ff] px-2.5 text-[13px] font-bold tabular-nums text-[#3b3fb0]";

/**
 * bd-o15qnr.39.1 (#204, the operator 22 Nov) — ONE box, titled "Digital Coach's evidence", on every indicator where the
 * Digital Coach gave evidence (FICO17 v6.1's eleven and six, FICO-S v1.2): only its findings, as evidence rows. The
 * caller draws it only when there is something in it (heard nothing: no box). `boxId` names the inner box for tests.
 */
export function DcEvidenceBox({ children, boxId }: { children: ReactNode; boxId?: string }) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <div data-testid="dc-evidence" className="flex flex-col gap-1">
      <span className={LABEL}>{F.dcEvidence}</span>
      <div data-testid={boxId} className="flex flex-col gap-1 rounded-2xl border border-[#e5e7eb] bg-[#fafafb] px-3 py-2.5">{children}</div>
    </div>
  );
}

/** One finding read only: its time (a plain chip, or `chip` when the caller has a playable one) and the quote. */
export function DcQuoteRow({ time, quote, first, chip }: { time: string | null; quote: string; first: boolean; chip?: ReactNode }) {
  return (
    <div data-testid="dc-row" className={cn("flex items-start gap-2 py-1", !first && ROW_DIVIDER)}>
      {chip ?? (time ? <span data-testid="ff-time" dir="ltr" className={cn(TIME_CHIP, "mt-1")}>{time}</span> : null)}
      <span className="min-w-0 flex-1 py-1 text-[15px] leading-relaxed text-[#1d2025] [unicode-bidi:plaintext]" dir="auto" {...urduOf(quote)}>{`“${quote}”`}</span>
    </div>
  );
}

/** What the Digital Coach said instead of snippets (D2's counts, N/A, couldn't tell, starred): a muted row in the box. */
export function DcNote({ text }: { text: string }) {
  return <p data-testid="dc-note" className="m-0 py-1 text-[14px] leading-relaxed text-[#6b7280] [unicode-bidi:plaintext]" dir="auto" {...urduOf(text)}>{text}</p>;
}

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
export function SaveTrayV7({ open, saving, slow = false, onSave, onClose, counts }: {
  open: boolean; saving: boolean; slow?: boolean; onSave: () => void; onClose: () => void; counts: ReturnType<typeof v7Changes>;
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
        {/* bd-o15qnr.38 — no answer yet after a few seconds: her answers are kept on this phone (the button still says Saving). */}
        {saving && slow && <p role="status" className="m-0 px-1 text-center text-[15px] font-semibold text-[#b45309]">{C.keptOnPhone}</p>}
        <button type="button" onClick={onClose} disabled={saving} className={cn(OUTLINE_WIDE, FOCUS)}>{C.keepChecking}</button>
        <p className="m-0 text-center text-[13px] text-[#6b7280]">{F.nextStep(W7.steps[2].current)}</p>
      </div>
    </Tray>
  );
}
