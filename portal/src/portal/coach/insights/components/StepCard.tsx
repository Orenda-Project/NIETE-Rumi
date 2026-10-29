import { useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../../../teacher/i18n";
import { coachip, isStepConflict } from "../api";
import { CodeText, DateText, LibraryText } from "../count";
import { insightsPaths } from "../paths";
import { pick, t, tx } from "../text";
import type { Step, WDetail } from "../types";
import { StepTick } from "./StepRow";
import { Eyebrow as CpEyebrow } from "../../../coachip-ui/Band";
import { Button } from "../../../coachip-ui/Button";
import { Surface } from "../../../coachip-ui/Surface";

/**
 * bd-sex15q.15 — S2's step card (G1: the cycle closes in one fold). The library's step for one teacher code, the check
 * line (the server's text with a literal "{date}" slot this card fills, API R3), "Set this step for T-xx" and "Full step".
 *
 * Setting posts R10's six keys and nothing else (A11: an unknown key is a 400). The school is the step code's own school
 * as S2 lists it (R10 checks it is that teacher's current school); the source session is the moment's only when the
 * moment is the same code's lesson, because R10 accepts only that teacher's session. 201 shows the step's check date,
 * 409 says an open step already exists, anything else says it could not be done.
 *
 * R6 (bd-sex15q.46, merged_S2_390): the card is S2's ONE raised surface; "Set this step for T-xx" is the screen's ONE
 * primary (green, navy label, full width, inside the 704 px fold); "Full step" a quiet green-ink link beside the play.
 */
export function stepSchoolId(d: WDetail): string | null {
  const code = d.step_card?.code;
  if (!code) return null;
  const listed = d.schools.find((s) => s.codes.some((c) => c.code.code_id === code.code_id));
  if (listed) return listed.school.school_id;
  if (d.moment && d.moment.code.code_id === code.code_id) return d.moment.school.school_id;
  return d.card.where_first?.school.school_id ?? null;
}

/**
 * fix-r5 s2 item 8 (design-qa 072739/073633, qa-coach 073256, panel 094000): the card's done form. After a Set (201), or
 * when R3 sends `step_card.code` null because the coach already has an open step on this move (read from `home.steps`),
 * the card says the step is set and when it is checked, keeps "Full step" and "Play the moment in the debrief", and
 * carries the tick (item 7). Never nothing.
 */
function DoneCard({ detail, step: initial }: { detail: WDetail; step: Step }) {
  const lang = useLang();
  const [step, setStep] = useState<Step>(initial);
  const codeNode = <CodeText lang={lang}>{step.code.code}</CodeText>;
  return (
    <Surface testId="step-card" data-state="done">
      <CpEyebrow>{tx("s2.step.eyebrow", lang, { code: codeNode })}</CpEyebrow>
      <LibraryText as="p" className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{pick(step.step, lang)}</LibraryText>
      <p data-testid="step-done" role="status" className="rounded-[12px] bg-cp-green-tint px-3 py-2.5 text-[15px] font-semibold text-cp-green-ink">
        {tx("s5.set.done", lang, { date: <DateText iso={step.check_by} lang={lang} /> })}
      </p>
      <StepTick step={step} onTicked={setStep} />
      <div className="flex flex-wrap items-center gap-3">
        {detail.moment && (
          <Button variant="secondary" size="md" to={`${insightsPaths.w(detail.card.w_id)}#moment`} testId="step-play" className="flex-1">
            <span>{t("s5.play", lang)}</span>
          </Button>
        )}
        <Link
          to={insightsPaths.move(detail.card.w_id, step.school.school_id)}
          data-testid="step-full"
          className="flex min-h-[44px] items-center px-1 text-[15px] font-semibold text-cp-green-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green"
        >
          {t("s2.step.full", lang)}
        </Link>
      </div>
    </Surface>
  );
}

/** The coach's open step on this move, for the done form when R3 has no code left to offer (oldest first, as home lists them). */
export function openStepFor(wId: string, steps: readonly Step[] | null | undefined): Step | null {
  return (steps ?? []).find((s) => s.w_id === wId && (s.status === "open" || s.status === "deferred")) ?? null;
}

export default function StepCard({ detail, openStep = null }: { detail: WDetail; openStep?: Step | null }) {
  const lang = useLang();
  const sc = detail.step_card;
  const [state, setState] = useState<{ kind: "idle" | "saving" | "conflict" | "failed" } | { kind: "done"; step: Step }>({ kind: "idle" });
  if (state.kind === "done") return <DoneCard detail={detail} step={state.step} />;
  if (sc && !sc.code && openStep) return <DoneCard detail={detail} step={openStep} />;
  if (!sc || !sc.code) return null;
  const code = sc.code;
  const schoolId = stepSchoolId(detail);
  const codeNode = <CodeText lang={lang}>{code.code}</CodeText>;
  const [before, ...rest] = pick(sc.check_line, lang).split("{date}");

  const set = () => {
    if (!schoolId || state.kind === "saving") return;
    setState({ kind: "saving" });
    const body = {
      code_id: code.code_id,
      school_id: schoolId,
      w_id: detail.card.w_id,
      i_id: sc.i_id,
      source_session_id: detail.moment && detail.moment.code.code_id === code.code_id ? detail.moment.session.session_id : null,
      rm_note_id: null,
    };
    coachip.setStep(body).then(
      (r) => setState({ kind: "done", step: r.step }),
      (e) => setState({ kind: isStepConflict(e) ? "conflict" : "failed" }),
    );
  };

  return (
    <Surface testId="step-card">
      <CpEyebrow>
        {tx("s2.step.eyebrow", lang, { code: codeNode })}
        {/* R3 picks the moment and the step's code independently: when they are two teachers, the eyebrow says so, on
            its own line's spare width so the card still ends above the fold */}
        {detail.moment && detail.moment.code.code_id !== code.code_id && (
          <>{lang === "ur" ? "، " : " · "}<span data-testid="step-other">{t("s2.step.other", lang)}</span></>
        )}
      </CpEyebrow>
      {/* the teacher's one step is the card's headline; the intervention's title is on S5, one tap away ("Full step"),
          so the card ends above the 704 px fold (G1, B v2) */}
      <LibraryText as="p" className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{pick(sc.teacher_step, lang)}</LibraryText>
      <LibraryText as="p" className="text-[13px] leading-[1.45] text-cp-ink-3">
        {before}
        {rest.length > 0 && <DateText iso={sc.check_by.date} lang={lang} />}
        {rest.join("{date}")}
      </LibraryText>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          testId="step-set"
          onClick={set}
          disabled={state.kind === "saving" || !schoolId}
          aria-busy={state.kind === "saving" ? "true" : undefined}
          block
          className="!whitespace-normal text-center"
        >
          <span>{tx("s2.step.set", lang, { code: codeNode })}</span>
        </Button>
        <Link
          to={insightsPaths.move(detail.card.w_id, schoolId)}
          data-testid="step-full"
          className="flex min-h-[44px] items-center px-1 text-[15px] font-semibold text-cp-green-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green"
        >
          {t("s2.step.full", lang)}
        </Link>
      </div>
      {state.kind === "conflict" && (
        <p data-testid="step-conflict" role="status" className="text-[15px] text-cp-ink-2">{tx("s5.conflict", lang, { code: codeNode })}</p>
      )}
      {state.kind === "failed" && (
        <p data-testid="step-failed" role="status" className="text-[15px] text-cp-ink-2">{t("e.failed_load", lang)}</p>
      )}
    </Surface>
  );
}
