import { Check, ChevronRight, GraduationCap, Hourglass, Lock, PenLine, Play, RotateCcw, XCircle } from 'lucide-react';
import { useCopy } from '../i18n';
import { TRAINING, TRAINING_INNER } from './copy';
import { shortDate } from '../../newui/range';
import { isWritten, LETTERS, useModuleExam } from '../../newui/training/TrainingModuleExam';
import { StatusChip, Tray } from '../ui';
import { answerStates } from './inner';
import { AnswerBack, Choices, DockButton, Dots, HeroCard, V2Row, WrittenBox } from './parts';
import { LoadState, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.12 — the I-SAPS module exam (v28 canvas TrainingModuleExam + TrainingExamResult): the gate,
 * one question per screen with each answer saved on its own (the autosave chip), and her sittings — the
 * latest as a status card (Being graded / Not passed / Passed), her answers in a tray, earlier ones as rows.
 * The paper, the draft restore, the 800ms autosave, submit and Try again are useModuleExam's, unchanged.
 */
export function ModuleExamPage() {
  const T = useCopy(TRAINING_INNER);
  const C = useCopy(TRAINING);
  const x = useModuleExam();
  const { paths, title, questions, q, qs, index, save, problem, sending, gate, attempts, g, latest, earlier, result, canRetake, opening } = x;
  const problemChip = problem ? <StatusChip text={problem} tone="error" /> : null;
  const saveChip = save === 'saving' ? <StatusChip text={T.saving} tone="info" />
    : save === 'saved' ? <StatusChip text={T.saved} tone="done" tick />
      : save === 'error' ? <StatusChip text={T.notSaved} tone="error" /> : null;

  /* ── one question per screen ──────────────────────────────────────────── */
  if (questions && q) {
    const counter = <span className="inline-flex h-[30px] shrink-0 items-center rounded-full border border-[#e5e7eb] bg-white px-3 text-[13px] font-bold tabular-nums text-[#374151]">{T.of(index + 1, qs.length)}</span>;
    const chosen = x.answers[q.id] ? [Number(x.answers[q.id]) - 1] : [];
    const dock = x.last
      ? <DockButton icon={Check} onClick={x.submit} disabled={!x.answered(q) || sending} testId="training-module-exam-submit">{sending ? T.sending : T.submit}</DockButton>
      : <DockButton icon={ChevronRight} iconFlips onClick={() => x.setIndex((i) => i + 1)} disabled={!x.answered(q)} testId="training-module-exam-next">{T.next}</DockButton>;
    return (
      <TrainingPageV2 crumb={T.crumb()} title={title} backTo={paths.home} onBack={x.back} right={counter} dock={dock}>
        <Dots total={qs.length} current={index} label={T.questionOf(index + 1, qs.length)} />
        {saveChip || problemChip ? <div className="flex flex-wrap gap-1.5 px-1">{saveChip}{problemChip}</div> : null}
        <p dir="auto" className="whitespace-pre-line px-1 text-[20px] font-bold leading-[1.4] rtl:leading-[2]">{q.question_text}</p>
        {isWritten(q) ? (
          <WrittenBox label={T.writtenAnswer} value={x.answers[q.id] || ''} floor={0} onChange={(v) => x.setAnswer(q.id, v)} disabled={sending} />
        ) : (
          <Choices
            key={q.id}
            label={T.answers}
            options={q.options || []}
            images={q.option_images}
            states={answerStates((q.options || []).length, chosen, undefined)}
            value={chosen}
            onChange={(v) => x.setAnswer(q.id, v.length ? String(v[0] + 1) : '')}
            disabled={sending}
          />
        )}
      </TrainingPageV2>
    );
  }

  /* ── the gate and her sittings ────────────────────────────────────────── */
  const loading = gate.loading || attempts.loading;
  const gateWord = (g?.cta || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  let hero = null;
  if (result && result.passed !== null && !latest) {
    hero = (
      <HeroCard icon={result.passed ? Check : XCircle} tone={result.passed ? 'done' : 'quiet'} title={result.passed ? T.passed : T.notPassed} live>
        {result.score !== null && result.total !== null ? <StatusChip text={T.of(result.score, result.total)} tone="info" /> : null}
      </HeroCard>
    );
  } else if (latest) {
    const tally = <StatusChip text={T.mcq(latest.mcq_correct, latest.mcq_served)} tone="info" />;
    hero = latest.status === 'pending_review'
      ? <HeroCard icon={Hourglass} tone="waiting" title={T.beingGraded} live>{tally}</HeroCard>
      : latest.status === 'failed'
        ? <HeroCard icon={XCircle} tone="quiet" title={T.notPassed} live>{tally}<StatusChip text={T.need(latest.mcq_needed)} tone="info" /></HeroCard>
        : <HeroCard icon={Check} tone="done" title={T.passed} live>{tally}</HeroCard>;
  } else if (g && g.available) {
    hero = <HeroCard icon={GraduationCap} title={T.ready}><StatusChip text={T.writtenAnswer} tone="info" /></HeroCard>;
  } else if (g) {
    hero = (
      <HeroCard icon={Lock} tone="quiet" title={T.locked}>
        {gateWord && gateWord.toLowerCase() !== T.locked.toLowerCase() ? <StatusChip text={gateWord} tone="info" /> : null}
      </HeroCard>
    );
  }
  const offerStart = !loading && g && ((!latest && g.available) || (latest && canRetake));

  return (
    <TrainingPageV2
      crumb={T.crumb()}
      title={title}
      backTo={paths.home}
      dock={offerStart ? (
        <DockButton icon={latest ? RotateCcw : Play} onClick={x.start} disabled={opening} testId="training-module-exam-start">{latest ? T.retry : T.startExam}</DockButton>
      ) : undefined}
    >
      <LoadState loading={loading && !gate.data} failed={!gate.loading && !!gate.error} onRetry={() => { gate.reload(); attempts.reload(); }} />
      {!gate.loading && !gate.error && !g ? <HeroCard icon={GraduationCap} tone="quiet" title={T.noExam} /> : null}
      {!loading ? hero : null}
      {problemChip ? <div className="flex flex-wrap justify-center gap-1.5">{problemChip}</div> : null}

      {latest ? (
        <>
          <V2Row icon={PenLine} title={T.myAnswers} onPress={() => x.setAnswersOpen(true)} testId="training-exam-answers" />
          <Tray open={x.answersOpen} title={T.myAnswers} onClose={() => x.setAnswersOpen(false)}>
            <ol className="flex flex-col gap-2.5">
              {latest.answers.map((a) => {
                const n = Number(a.chosen_option);
                const picked = !a.is_open_ended && Number.isInteger(n) && n >= 1 ? a.options[n - 1] : undefined;
                const shown = a.is_open_ended ? (a.answer_text || T.notTaken) : (picked ?? T.notTaken);
                const mark = a.is_open_ended && !latest.crq.held && latest.crq.score !== null ? T.of(latest.crq.score, latest.crq.max) : null;
                const letter = !a.is_open_ended && picked !== undefined ? LETTERS[n - 1] : null;
                return (
                  <AnswerBack
                    key={`${latest.id}-${a.index}`}
                    question={a.question_text}
                    answer={shown}
                    score={letter ?? mark}
                    feedback={a.is_open_ended && !latest.crq.held ? latest.crq.feedback : null}
                  />
                );
              })}
            </ol>
          </Tray>
        </>
      ) : null}

      {earlier.length ? (
        <div data-testid="training-exam-earlier" className="flex flex-col gap-2.5">
          <h2 className="mx-1 mt-2 text-[20px] font-light">{T.earlier}</h2>
          {earlier.map((a) => (
            <V2Row
              key={a.id}
              icon={a.status === 'passed' ? Check : a.status === 'failed' ? XCircle : Hourglass}
              title={a.status === 'passed' ? T.passed : a.status === 'failed' ? T.notPassed : T.beingGraded}
              sub={C.joined(shortDate((a.completed_at || a.started_at).slice(0, 10)), T.mcq(a.mcq_correct, a.mcq_served))}
              end="none"
            />
          ))}
        </div>
      ) : null}
    </TrainingPageV2>
  );
}
