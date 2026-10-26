import { useLang, type Lang } from "../../../teacher/i18n";
import { CodeText, CountSpan, DateText, LibraryText } from "../count";
import { COPY } from "../copy";
import { pick, t, tx } from "../text";
import type { Step, StripHit } from "../types";

/**
 * bd-sex15q.15 — one open step on S1 (DESIGN §3 S1, COPY §S1 steps): the library's step text verbatim, the sub line
 * (code · school · set date · check date, by the step's check rule), the three-dot strip of the next three recordings
 * and the chip (It worked / Not yet / n recordings to come).
 *
 * The strip is never red (m-ui rule 4): done is filled indigo, partial is half-filled indigo, not done is an indigo
 * outline, a recording not in yet is a grey outline. Hits arrive oldest first; the strip is padded to three.
 */
const INDIGO = "#4f46e5";
const GREY = "#d1d5db";

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

function Dot({ kind, label }: { kind: DotKind; label: string | null }) {
  const colour = kind === "missing" ? GREY : INDIGO;
  const background = kind === "done" ? INDIGO
    : kind === "partial" ? `linear-gradient(90deg, ${INDIGO} 50%, transparent 50%)`
      : "transparent";
  return (
    <span
      data-dot={kind}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className="inline-block h-[18px] w-[18px] rounded-full border-2 rtl:-scale-x-100"
      style={{ borderColor: colour, background }}
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
  const base = "inline-flex min-h-[28px] items-center rounded-full px-2.5 text-[13px] font-semibold";
  if (step.chip === "worked") {
    return <span data-testid="step-chip" data-chip="worked" className={`${base} bg-[#e8f6ee] text-[#1f7a4c]`}>{t("chip.worked", lang)}</span>;
  }
  if (step.chip === "not_yet") {
    return <span data-testid="step-chip" data-chip="not_yet" className={`${base} bg-[#f3f4f6] text-[#374151]`}>{t("chip.not_yet", lang)}</span>;
  }
  return (
    <CountSpan count={{ n: step.to_come, d: 3, window_id: windowId }} className={`${base} bg-[#eef2ff] text-[#312e81]`}>
      <span data-testid="step-chip" data-chip="to_come">
        {step.to_come === 1 ? t("chip.to_come.one", lang) : t("chip.to_come", lang, { n: step.to_come })}
      </span>
    </CountSpan>
  );
}

export function StepRow({ step, windowId }: { step: Step; windowId: string }) {
  const lang = useLang();
  const code = <CodeText lang={lang}>{step.code.code}</CodeText>;
  const school = <CodeText lang={lang}>{step.school.school_name}</CodeText>;
  const set = <DateText iso={step.set_on} lang={lang} short />;
  const sub = step.check_rule === "visit"
    ? tx("s1.steps.row.sub", lang, { code, school, date_short: set, date: <DateText iso={step.visit?.date ?? step.check_by} lang={lang} /> })
    : tx("s1.steps.row.sub14", lang, { code, school, date_short: set, date: <DateText iso={step.check_by} lang={lang} /> });
  return (
    <li data-testid="step-row" data-step={step.id} className="flex flex-col gap-1.5 border-b border-[#f3f4f6] py-3 last:border-b-0">
      <LibraryText as="p" className="text-[15.5px] font-semibold leading-snug text-[#1d2025]">{pick(step.step, lang)}</LibraryText>
      <p className="text-[13px] leading-snug text-[#6b7280] [overflow-wrap:anywhere]">{sub}</p>
      <div className="flex flex-wrap items-center gap-2.5">
        <StepStrip step={step} />
        <StepChip step={step} windowId={windowId} />
      </div>
    </li>
  );
}
