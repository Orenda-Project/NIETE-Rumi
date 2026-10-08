import { Check, ChevronRight, Lock, PenLine, Play, Timer, Trophy, XCircle } from 'lucide-react';
import { TRAINING_COPY as T } from '../../newui/copy';
import { hoursLeft } from '../../newui/training/TrainingLevel';
import { optionText, useLevelExam } from '../../newui/training/TrainingLevelExam';
import { percent, statusOf } from '../../newui/training/trainingApi';
import { StatusChip, Tray } from '../ui';
import { answerStates } from './inner';
import { AnswerBack, CertificateCardV2, Choices, DockButton, Dots, HeroCard, V2Row, WrittenBox } from './parts';
import { LoadState, TrainingPageV2 } from './TrainingFrame';

/**
 * bd-fmf24g.12 — the level exam (v28 canvas TrainingLevelExam, TrainingWrittenExam, TrainingExamResult):
 * the gate (Ready with the gate's own rules as chips, Locked, Wait, Passed with the certificate), one
 * question per screen — picks for NIETE's paper (with the Urdu line), a written answer with the server's
 * character floor for Beacon House — and the result. Opening, sending and the gate are useLevelExam's.
 */
export function LevelExamPage() {
  const x = useLevelExam();
  const { paths, vendorKey, provider, title, levelUrl, result, paper, q, qs, index, g, gate, level, problem, sending } = x;
  const problemChip = problem ? <StatusChip text={problem} tone="error" /> : null;

  /* ── the result ───────────────────────────────────────────────────────── */
  if (result) {
    const pct = percent(result.score, result.max);
    const waitH = result.cooldownUntil ? hoursLeft(result.cooldownUntil) : 0;
    return (
      <TrainingPageV2
        crumb={T.crumb(provider)}
        title={title}
        backTo={levelUrl}
        dock={<DockButton icon={Play} to={result.passed ? paths.provider(vendorKey) : levelUrl} testId="training-exam-continue">{T.continue}</DockButton>}
      >
        <HeroCard icon={result.passed ? Trophy : XCircle} tone={result.passed ? 'done' : 'quiet'} title={result.passed ? T.passed : T.notPassed} live>
          <StatusChip text={T.of(result.score, result.max)} tone={result.passed ? 'done' : 'info'} />
          <StatusChip text={T.pct(pct)} tone="info" />
          {!result.passed && waitH > 0 ? <StatusChip text={T.waitHours(waitH)} tone="waiting" /> : null}
        </HeroCard>
        {result.certificate ? <CertificateCardV2 certificate={result.certificate} /> : null}
        {result.answers && result.answers.length ? (
          <>
            <V2Row icon={PenLine} title={T.myAnswers} onPress={() => x.setAnswersOpen(true)} testId="training-exam-answers" />
            <Tray open={x.answersOpen} title={T.myAnswers} onClose={() => x.setAnswersOpen(false)}>
              <ol className="flex flex-col gap-2.5">
                {result.answers.map((a) => (
                  <AnswerBack key={a.question_index} question={a.question_text} answer={a.answer_text} score={T.outOfFive(a.answer_score)} feedback={a.feedback_text} />
                ))}
              </ol>
            </Tray>
          </>
        ) : null}
      </TrainingPageV2>
    );
  }

  /* ── one question per screen ──────────────────────────────────────────── */
  if (paper && q) {
    const counter = <span className="inline-flex h-[30px] shrink-0 items-center rounded-full border border-[#e5e7eb] bg-white px-3 text-[13px] font-bold tabular-nums text-[#374151]">{T.of(index + 1, qs.length)}</span>;
    // The level exam's paper (NIETE): options and the Urdu line; a written paper (Beacon House) has neither.
    const gq = paper.kind === 'grand_quiz' ? (q as unknown as { options: Parameters<typeof optionText>[0][]; question_urdu: string | null }) : null;
    const options = gq ? gq.options.map(optionText) : [];
    const urdu = gq?.question_urdu ?? null;
    const picked = x.picks[q.id] || [];
    const dock = x.last
      ? <DockButton icon={Check} onClick={x.submit} disabled={!x.answered(q.id) || sending} testId="training-exam-submit">{sending ? T.sending : T.submit}</DockButton>
      : <DockButton icon={ChevronRight} iconFlips onClick={() => x.setIndex((i) => i + 1)} disabled={!x.answered(q.id)} testId="training-exam-next">{T.next}</DockButton>;
    return (
      <TrainingPageV2 crumb={T.crumb(provider)} title={title} backTo={levelUrl} onBack={x.back} right={counter} dock={dock}>
        <Dots total={qs.length} current={index} label={T.questionOf(index + 1, qs.length)} />
        {problemChip ? <div className="flex flex-wrap gap-1.5 px-1">{problemChip}</div> : null}
        <p dir="auto" className="whitespace-pre-line px-1 text-[20px] font-bold leading-[1.4] rtl:leading-[2]">{q.question_text}</p>
        {urdu ? <p dir="rtl" lang="ur" className="px-1 text-[17px] font-semibold leading-[2] text-[#6b7280]">{urdu}</p> : null}
        {paper.kind === 'capstone' ? (
          <WrittenBox label={T.writtenAnswer} value={x.texts[q.id] || ''} floor={paper.floor} onChange={(v) => x.setTexts((t) => ({ ...t, [q.id]: v }))} disabled={sending} />
        ) : (
          <Choices
            key={q.id}
            label={T.answers}
            options={options}
            states={answerStates(options.length, picked, undefined)}
            value={picked}
            onChange={(v) => x.setPicks((p) => ({ ...p, [q.id]: v }))}
            disabled={sending}
          />
        )}
      </TrainingPageV2>
    );
  }

  /* ── the gate ─────────────────────────────────────────────────────────── */
  const locked = statusOf(gate.error) === 403;
  const left = level ? Math.max(1, (level.courses_total || 0) - (level.courses_completed || 0)) : null;
  return (
    <TrainingPageV2
      crumb={T.crumb(provider)}
      title={title}
      backTo={levelUrl}
      dock={g && g.state === 'ready' ? <DockButton icon={Play} onClick={x.start} disabled={x.opening} testId="training-exam-start">{T.startExam}</DockButton> : undefined}
    >
      <LoadState loading={gate.loading} failed={!gate.loading && !!gate.error && !locked} onRetry={gate.reload} />
      {locked ? <HeroCard icon={Lock} tone="quiet" title={T.locked} /> : null}
      {!gate.loading && !gate.error && (!g || g.state === 'no_quiz') ? <HeroCard icon={Trophy} tone="quiet" title={T.noExam} /> : null}

      {g && g.state === 'ready' ? (
        <HeroCard icon={g.exam_kind === 'capstone' ? PenLine : Trophy} title={T.ready}>
          {g.question_count ? <StatusChip text={T.questions(g.question_count)} tone="info" /> : null}
          {g.exam_kind === 'capstone' ? <StatusChip text={T.writtenAnswer} tone="info" /> : null}
          {typeof g.pass_mark_pct === 'number' && Number.isFinite(g.pass_mark_pct) ? <StatusChip text={T.toPass(g.pass_mark_pct)} tone="info" /> : null}
          {typeof g.cooldown_hours === 'number' && g.cooldown_hours > 0 ? <StatusChip text={T.waitIfFailed(g.cooldown_hours)} tone="waiting" /> : null}
          {problemChip}
        </HeroCard>
      ) : null}

      {g && g.state === 'courses_incomplete' ? (
        <HeroCard icon={Lock} tone="quiet" title={T.locked}>
          {left != null ? <StatusChip text={T.moreCourses(left)} tone="info" /> : null}
        </HeroCard>
      ) : null}

      {g && g.state === 'cooldown' ? (
        <HeroCard icon={Timer} tone="waiting" title={T.wait}>
          <StatusChip text={T.waitHours(hoursLeft(g.cooldown_until))} tone="waiting" />
        </HeroCard>
      ) : null}

      {g && g.state === 'passed' ? (
        <>
          <HeroCard icon={Trophy} tone="done" title={T.passed} />
          {g.certificate ? <CertificateCardV2 certificate={g.certificate} /> : null}
        </>
      ) : null}
    </TrainingPageV2>
  );
}
