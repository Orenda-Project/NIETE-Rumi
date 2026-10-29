import { useState } from "react";
import { useLang, type Lang } from "../../../teacher/i18n";
import { coachip } from "../api";
import { CodeText, CountSpan, DateText, LibraryText } from "../count";
import { COPY } from "../copy";
import { pick, t, tx } from "../text";
import { LRI, PDI } from "../format";
import { dropPart, NO_PART } from "./parts";
import type { Step, StripHit } from "../types";

/**
 * bd-sex15q.15 — one open step on S1 (DESIGN §3 S1, COPY §S1 steps): the library's step text verbatim, the sub line
 * (code · school · set date · check date, by the step's check rule), the three-dot strip of the next three recordings
 * and the chip (It worked / Not yet / n recordings to come).
 *
 * The strip is never red (m-ui rule 4). R6 (bd-sex15q.46, DESIGN_SYSTEM §6/§7 Dots): done is filled green (strength),
 * partial is half green, not done is a navy outline (notice), a recording not in yet is a grey track outline; 14 px.
 * Hits arrive oldest first; the strip is padded to three.
 */

type DotKind = "done" | "partial" | "not_done" | "missing";

/** The legend's three words ("done · partial · not done"), for the dots' labels. */
export function legendWords(lang: Lang): [string, string, string] {
  const parts = COPY["s1.steps.legend"][lang].split(lang === "ur" ? "، " : " · ");
  return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
}

function kindOf(hit: StripHit | undefined): DotKind {
  if (!hit) return "missing";
  if (hit.hit === true) return "done";
  if (hit.hit === "partial") return "partial";
  return "not_done";
}

const DOT: Record<DotKind, string> = {
  done: "border-cp-green bg-cp-green",
  partial: "border-cp-green bg-[linear-gradient(90deg,var(--cp-green)_50%,white_50%)]",
  not_done: "border-cp-navy bg-white",
  missing: "border-cp-track bg-white",
};

function Dot({ kind, label }: { kind: DotKind; label: string | null }) {
  return (
    <span
      data-dot={kind}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={`inline-block h-3.5 w-3.5 rounded-full border-[1.5px] rtl:-scale-x-100 ${DOT[kind]}`}
    />
  );
}

export function StepStrip({ step }: { step: Step }) {
  const lang = useLang();
  const [done, partial, notDone] = legendWords(lang);
  const label: Record<DotKind, string | null> = { done, partial, not_done: notDone, missing: null };
  const slots = [0, 1, 2].map((i) => kindOf(step.strip.hits[i]));
  return (
    <span data-testid="step-strip" className="flex items-center gap-1.5">
      {slots.map((k, i) => <Dot key={i} kind={k} label={label[k]} />)}
    </span>
  );
}

export function StepChip({ step, windowId }: { step: Step; windowId: string }) {
  const lang = useLang();
  const base = "inline-flex min-h-[28px] items-center rounded-full px-3 text-[13px] font-semibold";
  if (step.chip === "worked") {
    return <span data-testid="step-chip" data-chip="worked" className={`${base} bg-cp-green text-cp-navy`}>{t("chip.worked", lang)}</span>;
  }
  if (step.chip === "not_yet") {
    return <span data-testid="step-chip" data-chip="not_yet" className={`${base} bg-cp-navy-tint text-cp-ink-2`}>{t("chip.not_yet", lang)}</span>;
  }
  return (
    <CountSpan count={{ n: step.to_come, d: 3, window_id: windowId }} className={`${base} bg-cp-green-tint text-cp-green-ink`}>
      <span data-testid="step-chip" data-chip="to_come">
        {step.to_come === 1 ? t("chip.to_come.one", lang) : t("chip.to_come", lang, { n: step.to_come })}
      </span>
    </CountSpan>
  );
}

/**
 * fix-r5 s2 item 7b (qa-coach 073255, panel 094000/094002): the coach's tick, "It happened / Not yet" (s5.tick.yes/no),
 * posting R11 `/steps/:id/tick`. Shown on every open (or deferred, R11 allows it) step whose tick is still pending: the
 * coach may tick before the check date, so the chips do not wait for it (the conservative reading of the panel's "from
 * the check date"). Once ticked, the row says the tick from the server's answer (`coach_tick`); the strip's chip stays.
 */
export function StepTick({ step, onTicked }: { step: Step; onTicked: (s: Step) => void }) {
  const lang = useLang();
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  if (step.coach_tick !== "pending") {
    return (
      <p data-testid="step-ticked" data-tick={step.coach_tick} className="text-[13px] font-semibold leading-[1.45] text-cp-navy">
        {t("s1.steps.row.ticked", lang, { tick: t(step.coach_tick === "yes" ? "s5.tick.yes" : "s5.tick.no", lang) })}
      </p>
    );
  }
  if (step.status !== "open" && step.status !== "deferred") return null;
  const tick = (v: "yes" | "no") => {
    if (state === "saving") return;
    setState("saving");
    coachip.tick(step.id, v).then(
      (r) => { setState("idle"); onTicked(r.step); },
      () => setState("failed"),
    );
  };
  const chip = "cp-press min-h-[44px] rounded-[12px] px-4 text-[14px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green disabled:opacity-60";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2" aria-busy={state === "saving" ? "true" : undefined}>
        <button type="button" data-testid="step-tick-yes" disabled={state === "saving"} onClick={() => tick("yes")}
          className={`${chip} border-2 border-cp-navy bg-white text-cp-navy`}>{t("s5.tick.yes", lang)}</button>
        <button type="button" data-testid="step-tick-no" disabled={state === "saving"} onClick={() => tick("no")}
          className={`${chip} border border-cp-hairline bg-white text-cp-ink-2`}>{t("s5.tick.no", lang)}</button>
      </div>
      {state === "failed" && (
        <p data-testid="step-tick-failed" role="status" className="text-[13px] text-cp-ink-2">{t("e.failed_load", lang)}</p>
      )}
    </div>
  );
}

export function StepRow({ step: initial, windowId }: { step: Step; windowId: string }) {
  const lang = useLang();
  const [step, setStep] = useState<Step>(initial);
  // fix-r5 s2 item 17 (design-qa 073629): in Urdu the code and the school are two LTR atoms around an Urdu comma; drawn
  // apart, the comma attached to the wrong one ("S-01 ،T-04"). They go out as ONE isolated LTR run with their comma, and
  // the template's own "، " before {school} is dropped with the school's slot. English keeps its two atoms.
  const pair = lang === "ur";
  const code = pair
    ? <span data-code="" dir="ltr" className="[unicode-bidi:isolate]">{`${LRI}${step.code.code}، ${step.school.school_name}${PDI}`}</span>
    : <CodeText lang={lang}>{step.code.code}</CodeText>;
  const school = pair ? NO_PART : <CodeText lang={lang}>{step.school.school_name}</CodeText>;
  const set = <DateText iso={step.set_on} lang={lang} short />;
  const filled = step.check_rule === "visit"
    ? tx("s1.steps.row.sub", lang, { code, school, date_short: set, date: <DateText iso={step.visit?.date ?? step.check_by} lang={lang} /> })
    : tx("s1.steps.row.sub14", lang, { code, school, date_short: set, date: <DateText iso={step.check_by} lang={lang} /> });
  const sub = pair ? dropPart(filled, NO_PART) : filled;
  return (
    <li data-testid="step-row" data-step={step.id} className="flex flex-col gap-1.5 border-t border-cp-hairline py-4 first:border-t-0 first:pt-2">
      <LibraryText as="p" className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{pick(step.step, lang)}</LibraryText>
      <p data-testid="step-sub" className="text-[13px] leading-[1.45] text-cp-ink-3 [overflow-wrap:anywhere]">{sub}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <StepStrip step={step} />
        <StepChip step={step} windowId={windowId} />
      </div>
      <StepTick step={step} onTicked={setStep} />
    </li>
  );
}
