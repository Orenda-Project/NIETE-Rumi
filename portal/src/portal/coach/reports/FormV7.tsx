import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DraftIndicator, DraftOption, DraftSection, ObservationDraft, V6Indicator } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { RatingScale, StatusChip, Tray } from "../../teacher/ui";
import type { RatingOption } from "../../teacher/ui/RatingScale";
import { FOCUS, GRID, LIST_CARD, OUTLINE_WIDE, PRIMARY_WIDE } from "../../teacher/ui/styles";
import { FLOW_V7, type FlowV7Copy } from "../flow/copyV7";
import { FORM_V7, type FormV7Copy } from "../flow/copyV7form";
import { REPORTS, type ReportsCopy } from "./copy";
import { rungName, titleOf, type Values } from "./formModel";
import { changedFromRumi, type V6Problems, type V6Section } from "./v6Model";
import { Problem, problemText, v6RatingOptions } from "./V6Parts";

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
 */

const FIELD = "w-full rounded-xl border border-[#d1d5db] bg-white px-3 py-2.5 text-[16px] leading-snug text-[#1d2025]";
const LABEL = "text-[13px] font-bold text-[#6b7280]";
const CARD = cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5");

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

/** Whose level is which: the coach's filled, Rumi's ringed purple. */
export function Legend({ principal }: { principal: boolean }) {
  const C = useCopy(REPORTS) as ReportsCopy;
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <div data-testid="legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[13px] font-medium text-[#4b5563]">
      <span className="flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded-full bg-[#33374a]" />{principal ? F.yourLevel : C.legendYours}</span>
      <span className="flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded-full border-[3px] border-[#6e52e0]" />{F.rumisLevel}</span>
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

function Head({ code, name }: { code: string; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip text={code} tone="score" />
      <h3 className="m-0 min-w-0 flex-1 text-[16px] font-semibold leading-[1.3]" dir="auto">{name}</h3>
    </div>
  );
}

function TextBox({ id, label, value, onChange, readOnly, problem }: {
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
      <textarea id={id} dir="auto" value={value} rows={3} onChange={(e) => onChange(e.target.value)}
        aria-invalid={problem ? true : undefined} className={cn(FIELD, FOCUS, problem && "border-[#c8331f]")} />
      <Problem text={problem ?? null} />
    </div>
  );
}

/** Rumi's evidence for one of the six: read only, dashed, never a box the coach types in. */
function ReadOnlyBox({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <p className="m-0 whitespace-pre-line rounded-xl border border-dashed border-[#d1d5db] bg-[#f9fafb] px-3 py-2.5 text-[14px] leading-relaxed text-[#374151]" dir="auto">{text}</p>
    </div>
  );
}

/** N/A and Couldn't tell go after the four levels, as pills. */
const asideOf = (o: RatingOption): RatingOption => (o.id === "NA" || o.id === "IE" || o.id === "na" ? { ...o, aside: true } : o);

function Levels({ name, value, options, dc, onChange }: {
  name: string; value: string; options: RatingOption[]; dc: string | null; onChange: (v: string) => void;
}) {
  const F = useCopy(FORM_V7) as FormV7Copy;
  return (
    <RatingScale look="radio" name={name} value={value || null} options={options.map(asideOf)} dcValue={dc} dcTag={F.rumiTag}
      copy={{ digitalCoach: F.rumisLevel }} onChange={(k) => onChange(String(k))} />
  );
}

/** A level's words: its name, or N/A / Couldn't tell (with the indicator's own N/A words). */
function levelWords(options: RatingOption[], id: string | null | undefined): string | null {
  const o = options.find((x) => x.id === id);
  if (!o) return id || null;
  return o.label && !o.text ? o.label : [o.text, o.label].filter(Boolean).join(" · ");
}

/** bd-ra8xu.40's v6 part (C, D or F), in the v7 look: the same fields, keys and rules as V6Part. */
export function V6PartV7({ section, values, start, set, readOnly, problems, minReason }: {
  section: V6Section; values: Values; start: Values; set: (k: string) => (v: string) => void;
  readOnly: boolean; problems: V6Problems; minReason: number;
}) {
  const C = useCopy(REPORTS) as ReportsCopy;
  const F = useCopy(FORM_V7) as FormV7Copy;
  const why = (k: string) => problemText(C, problems[k], minReason);
  const changed = section.indicators.some((ind) => changedFromRumi(ind, values));
  const chgKey = `chg_${section.letter}`;

  const card = (ind: V6Indicator) => {
    const rk = `r_${ind.field}`;
    const options = v6RatingOptions(ind.options, C);
    const level = readOnly
      ? (values[rk] ? <StatusChip text={levelWords(options, values[rk]) || C.dash} tone="info" className="self-start" /> : null)
      : (
        <>
          <Levels name={ind.name} value={values[rk] || ""} options={options} dc={ind.kind === "dc" ? ind.rumi : null} onChange={set(rk)} />
          <Problem text={why(rk)} />
        </>
      );
    return (
      <section key={ind.id} data-testid="indicator" className={CARD}>
        <Head code={ind.id} name={ind.name} />
        {ind.kind === "dc" && !readOnly && changedFromRumi(ind, values) && (
          <StatusChip text={F.changedFrom(levelWords(options, ind.rumi) || C.dash)} tone="waiting" className="self-start" />
        )}
        {ind.kind === "combined" ? (
          <>
            {ind.body ? <ReadOnlyBox label={C.fromRecording} text={ind.body} /> : null}
            {level}
            <TextBox id={`why_${ind.field}`} label={F.whyLevelMin(minReason)} value={values[`why_${ind.field}`] ?? ""}
              onChange={set(`why_${ind.field}`)} readOnly={readOnly} problem={why(`why_${ind.field}`)} />
            {ind.d2 && (
              readOnly ? (
                <p className="m-0 text-[15px]">{`${C.d2Children}: ${values.d2_children || C.dash} · ${C.d2QuietLater}: ${values.d2_quiet_later || C.dash}`}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className={cn(GRID, "grid-cols-2 gap-2.5")}>
                    {([["d2_children", C.d2Children], ["d2_quiet_later", C.d2QuietLater]] as const).map(([k, label]) => (
                      <div key={k} className="flex flex-col gap-1">
                        <label htmlFor={k} className={LABEL}>{label}</label>
                        <input id={k} dir="auto" inputMode="numeric" pattern="[0-9]*" value={values[k] ?? ""} onChange={(e) => set(k)(e.target.value)}
                          aria-invalid={problems.d2_children ? true : undefined}
                          className={cn(FIELD, "min-h-[56px] text-[18px] font-semibold tabular-nums", FOCUS, problems.d2_children && "border-[#c8331f]")} />
                      </div>
                    ))}
                  </div>
                  <Problem text={why("d2_children")} />
                </div>
              )
            )}
          </>
        ) : (
          <>
            {level}
            <TextBox id={`ev_${ind.field}`} label={F.evidence} value={values[`ev_${ind.field}`] ?? ""} onChange={set(`ev_${ind.field}`)} readOnly={readOnly} />
            <TextBox id={`imp_${ind.field}`} label={C.toImprove} value={values[`imp_${ind.field}`] ?? ""} onChange={set(`imp_${ind.field}`)} readOnly={readOnly} />
          </>
        )}
      </section>
    );
  };

  return (
    <>
      {section.indicators.map(card)}
      {(changed || (readOnly && values[chgKey])) && (
        <section data-testid="why-changed" className="flex flex-col gap-2.5 rounded-2xl border border-[#fde7b0] bg-[#fffbeb] p-3.5">
          <TextBox id={chgKey} label={F.whyChanged} value={values[chgKey] ?? ""} onChange={set(chgKey)} readOnly={readOnly} problem={why(chgKey)} />
        </section>
      )}
    </>
  );
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
