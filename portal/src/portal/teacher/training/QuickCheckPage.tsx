import { Check, ChevronRight, ClipboardCheck, Play, RotateCcw, X } from 'lucide-react';
import { useCopy } from '../i18n';
import { cn } from '@/lib/utils';
import { TRAINING, TRAINING_INNER } from './copy';
import { quickCheckNext, useQuickCheck } from '../../newui/training/TrainingQuiz';
import { ListRow, StatusChip } from '../ui';
import { CARD } from '../ui/styles';
import { answerStates } from './inner';
import { Choices, DockButton, DockRow, Dots, HeroCard } from './parts';
import { LoadState, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.12 — the quick check (v28 canvas TrainingQuiz + TrainingQuizResult): one question per screen
 * (dots, the question, big answers; Check marks it — her pick green or red, the right one never shown; Next;
 * Submit on the last), then the result (a score ring, Passed or Not passed, a row per question, Up next;
 * Continue and Try again). The paper, saving, marking and finishing are useQuickCheck's, unchanged.
 */
export function QuickCheckPage() {
  const T = useCopy(TRAINING_INNER);
  const C = useCopy(TRAINING);
  const q = useQuickCheck();
  const { paths, moduleId, detail, courseId, result, modules, levels, partTitle, partUrl } = q;

  if (result) {
    const attempt = result.attempt;
    const { after, courseUrl, pct } = quickCheckNext({ attempt, modules: modules.data, levels: levels.data, detail: detail.data, moduleId, courseId, paths, partUrl });
    return (
      <TrainingPageV2
        crumb={T.crumb(partTitle)}
        title={T.quickCheck}
        backTo={partUrl}
        dock={(
          <DockRow>
            <DockButton icon={Play} to={after ? paths.unit(after.id) : courseUrl} testId="training-result-continue">{T.continue}</DockButton>
            <DockButton icon={RotateCcw} outline onClick={q.again} testId="training-try-again">{T.retry}</DockButton>
          </DockRow>
        )}
      >
        <HeroCard
          title={attempt.is_passed ? T.passed : T.notPassed}
          ring={{ value: attempt.max_score > 0 ? attempt.score / attempt.max_score : 0, text: T.of(attempt.score, attempt.max_score) }}
          live
          testId="training-quiz-result"
        >
          <StatusChip text={T.pct(pct)} tone={attempt.is_passed ? 'done' : 'info'} />
        </HeroCard>
        {result.results.length ? (
          <>
            <h2 className="mx-1 mt-2 text-[20px] font-light">{T.answers}</h2>
            <section aria-label={T.answers} className={cn(CARD, 'overflow-hidden')}>
              {result.results.map((r, i) => (
                <div key={r.question_id} data-testid={`training-quiz-result-q-${r.question_index}`} className={cn('flex min-h-[60px] items-center gap-3.5 py-2 pe-3.5 ps-3 text-[16px] font-semibold', i > 0 && 'border-t border-[#f0f1f3]')}>
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', r.is_correct ? 'bg-[#eaf6ef] text-[#2f7a52]' : 'bg-[#f3f4f6] text-[#6b7280]')}>
                    {r.is_correct ? <Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" /> : <X className="h-5 w-5" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="flex-1">{T.questionN(r.question_index + 1)}</span>
                  <StatusChip text={r.is_correct ? T.correct : T.notCorrect} tone={r.is_correct ? 'done' : 'error'} />
                </div>
              ))}
            </section>
          </>
        ) : null}
        {after ? (
          <>
            <h2 className="mx-1 mt-2 text-[20px] font-light">{C.upNext}</h2>
            <ListRow label={after.title} subtitle={after.duration_seconds > 0 ? T.minutes(after.duration_seconds) : undefined} prefix={C.partPrefix} number={[...(modules.data || [])].sort((a, b) => a.order_index - b.order_index).findIndex((m) => m.id === after.id) + 1 || ''} to={paths.unit(after.id)} />
          </>
        ) : null}
      </TrainingPageV2>
    );
  }

  const { qs, q: question, index, picked, verdict, sending, notSent, last, opening, openFailed } = q;
  const counter = qs.length ? <span className="inline-flex h-[30px] shrink-0 items-center rounded-full border border-[#e5e7eb] bg-white px-3 text-[13px] font-bold tabular-nums text-[#374151]">{T.of(index + 1, qs.length)}</span> : null;
  const verdictWord = verdict ? (verdict.is_correct ? 'correct' : 'wrong') : undefined;

  const dock = !opening && question ? (
    !verdict ? <DockButton icon={Check} onClick={q.check} disabled={!picked.length || sending} testId="training-quiz-check">{sending ? T.sending : T.check}</DockButton>
      : last ? <DockButton icon={Check} onClick={q.submit} disabled={sending} testId="training-quiz-submit">{sending ? T.sending : T.submit}</DockButton>
        : <DockButton icon={ChevronRight} iconFlips onClick={() => q.setIndex((i) => i + 1)} testId="training-quiz-next">{T.next}</DockButton>
  ) : undefined;

  return (
    <TrainingPageV2 crumb={T.crumb(partTitle)} title={T.quickCheck} backTo={partUrl} onBack={q.back} right={counter} dock={dock}>
      <LoadState loading={opening} failed={!opening && openFailed} onRetry={() => { void q.open(); }} />
      {!opening && !openFailed && qs.length === 0 ? <HeroCard icon={ClipboardCheck} tone="quiet" title={T.empty} /> : null}

      {!opening && question ? (
        <>
          <Dots total={qs.length} current={index} label={T.questionOf(index + 1, qs.length)} />
          {question.multi || notSent ? (
            <div className="flex flex-wrap gap-1.5 px-1">
              {question.multi ? <StatusChip text={T.pickAll} tone="info" /> : null}
              {notSent ? <StatusChip text={T.notSent} tone="error" /> : null}
            </div>
          ) : null}
          <p dir="auto" className="whitespace-pre-line px-1 text-[20px] font-bold leading-[1.4] rtl:leading-[2]">{question.question_text}</p>
          <Choices
            key={question.id}
            label={T.answers}
            options={question.options.map((o) => o.text)}
            states={answerStates(question.options.length, picked, verdictWord)}
            value={picked}
            multi={!!question.multi}
            onChange={(v) => q.setPicks((a) => ({ ...a, [question.id]: v }))}
            disabled={sending || Boolean(verdict)}
          />
          {verdict ? (
            <div data-testid="training-quiz-verdict" role="status" className="flex px-1">
              <StatusChip text={verdict.is_correct ? T.correct : T.notCorrect} tone={verdict.is_correct ? 'done' : 'error'} />
            </div>
          ) : null}
        </>
      ) : null}
    </TrainingPageV2>
  );
}
