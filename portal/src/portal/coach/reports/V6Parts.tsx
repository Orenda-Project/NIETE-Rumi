import { cn } from "@/lib/utils";
import type { V6Indicator, V6Option } from "../../services/api";
import { useCopy } from "../../teacher/i18n";
import { RatingScale, StatusChip } from "../../teacher/ui";
import type { RatingOption } from "../../teacher/ui/RatingScale";
import { FOCUS, LIST_CARD } from "../../teacher/ui/styles";
import { REPORTS, type ReportsCopy } from "./copy";
import type { Values } from "./formModel";
import { changedFromRumi, type V6Problem, type V6Problems, type V6Section } from "./v6Model";

/**
 * bd-ra8xu.40 — one part (C, D or F) of a FICO17 v6 visit on the Feedback Form: what the WhatsApp v6 review Flow shows on
 * that screen, on the kit. Each level is the kit's RatingScale, stacked so each level says what it means (the rubric's
 * words, as the Flow's radio list); the Digital Coach's level is ringed. Rumi's 11 keep his evidence and "to improve"
 * editable; the six are set from the room, with Rumi's evidence above (read only) and a reason; D2 takes its two counts;
 * the part asks "why you changed it" once one of Rumi's levels on it is changed. The rubric's words are DATA (the bot's).
 */
const AREA = "w-full rounded-xl border border-[#d1d5db] bg-white p-3 text-[16px] leading-snug text-[#1d2025]";
const NUMBER = "h-14 w-full rounded-xl border border-[#d1d5db] bg-white px-3 text-[18px] font-semibold tabular-nums text-[#1d2025]";

function problemText(C: ReportsCopy, p: V6Problem | undefined, min: number): string | null {
  if (!p) return null;
  if (p === "atLeast") return C.atLeast(min);
  return C[p];
}

function Problem({ text }: { text: string | null }) {
  return text ? <p role="alert" className="m-0 text-[14px] font-semibold text-[#c8331f]">{text}</p> : null;
}

/** A level's face on the kit's scale: its number, or N/A / Couldn't tell; the rubric's title and words beside it. */
export function v6RatingOptions(options: readonly V6Option[], C: ReportsCopy): RatingOption[] {
  return options.map((o) => {
    if (o.id === "NA") return { id: o.id, text: C.na, label: o.title.replace(/^N\/A\s*·\s*/, ""), description: o.description || undefined };
    if (o.id === "IE") return { id: o.id, text: C.couldntTell, description: o.description || undefined };
    return { id: o.id, label: o.title, description: o.description || undefined };
  });
}

function TextField({ id, label, value, onChange, readOnly, problem }: {
  id: string; label: string; value: string; onChange: (v: string) => void; readOnly: boolean; problem?: string | null;
}) {
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
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} dir="auto"
        aria-invalid={problem ? true : undefined} className={cn(AREA, FOCUS, problem && "border-[#c8331f]")} />
      <Problem text={problem ?? null} />
    </div>
  );
}

export function V6Part({ section, values, start, set, readOnly, problems, minReason }: {
  section: V6Section; values: Values; start: Values; set: (k: string) => (v: string) => void;
  readOnly: boolean; problems: V6Problems; minReason: number;
}) {
  const C = useCopy(REPORTS);
  const why = (k: string) => problemText(C, problems[k], minReason);
  const changed = section.indicators.some((ind) => changedFromRumi(ind, values));
  const chgKey = `chg_${section.letter}`;

  const levelOf = (ind: V6Indicator) => {
    const rk = `r_${ind.field}`;
    const options = v6RatingOptions(ind.options, C);
    if (readOnly) {
      const o = options.find((x) => x.id === values[rk]);
      return o ? <StatusChip text={[o.text ?? o.id, o.label].filter(Boolean).join(" · ")} tone="info" className="self-start" /> : null;
    }
    return (
      <>
        <RatingScale stacked name={ind.name} value={values[rk] || null} options={options}
          dcValue={ind.kind === "dc" ? ind.rumi : null} onChange={set(rk)} />
        <Problem text={why(rk)} />
      </>
    );
  };

  return (
    <>
      {section.indicators.map((ind) => (
        <section key={ind.id} data-testid="indicator" className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5")}>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusChip text={ind.id} tone="score" />
            <h3 className="m-0 text-[17px] font-semibold leading-[1.3]" dir="auto">{ind.name}</h3>
            {ind.kind === "combined" && <StatusChip text={C.fromRoom} tone="info" />}
          </div>
          {ind.kind === "combined" && ind.body && (
            <div className="flex flex-col gap-1 rounded-2xl bg-[#eaf6ef] p-3.5">
              <span className="text-[13px] font-semibold text-[#2f7a52]">{C.fromRecording}</span>
              <p className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-[#2f7a52]" dir="auto">{ind.body}</p>
            </div>
          )}
          {levelOf(ind)}
          {ind.kind === "dc" && changedFromRumi(ind, values) && !readOnly && (
            <StatusChip text={C.changedFrom(start[`r_${ind.field}`] || "—")} tone="waiting" className="self-start" />
          )}
          {ind.kind === "combined" ? (
            <>
              <TextField id={`why_${ind.field}`} label={C.whyLevel} value={values[`why_${ind.field}`] ?? ""}
                onChange={set(`why_${ind.field}`)} readOnly={readOnly} problem={why(`why_${ind.field}`)} />
              {ind.d2 && (
                readOnly ? (
                  <p className="m-0 text-[15px]">{`${C.d2Children}: ${values.d2_children || "—"} · ${C.d2QuietLater}: ${values.d2_quiet_later || "—"}`}</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="[display:grid] grid-cols-2 gap-2.5">
                      {([["d2_children", C.d2Children], ["d2_quiet_later", C.d2QuietLater]] as const).map(([k, label]) => (
                        <div key={k} className="flex flex-col gap-1">
                          <label htmlFor={k} className="text-[13px] font-semibold text-[#6b7280]">{label}</label>
                          <input id={k} inputMode="numeric" pattern="[0-9]*" value={values[k] ?? ""} onChange={(e) => set(k)(e.target.value)}
                            aria-invalid={problems.d2_children ? true : undefined} className={cn(NUMBER, FOCUS, problems.d2_children && "border-[#c8331f]")} />
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
              <TextField id={`ev_${ind.field}`} label={C.whatSeen} value={values[`ev_${ind.field}`] ?? ""} onChange={set(`ev_${ind.field}`)} readOnly={readOnly} />
              <TextField id={`imp_${ind.field}`} label={C.toImprove} value={values[`imp_${ind.field}`] ?? ""} onChange={set(`imp_${ind.field}`)} readOnly={readOnly} />
            </>
          )}
        </section>
      ))}
      {(changed || (readOnly && values[chgKey])) && (
        <section className={cn(LIST_CARD, "flex flex-col gap-2.5 p-3.5")}>
          <TextField id={chgKey} label={C.whyChanged} value={values[chgKey] ?? ""} onChange={set(chgKey)} readOnly={readOnly} problem={why(chgKey)} />
        </section>
      )}
    </>
  );
}
