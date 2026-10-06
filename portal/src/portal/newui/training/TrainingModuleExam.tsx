import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, CircleAlert, GraduationCap, Hourglass, Loader2, Lock, PenLine, Play, RotateCcw, XCircle } from 'lucide-react';
import api from '../../services/api';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import { List, Row, SectionLabel } from '../List';
import { Sheet } from '../Sheet';
import { AnswerChoices, QuestionDots } from '../Answers';
import { shortDate } from '../range';
import { TRAINING_COPY } from '../copy';
import { Loading, NotLoaded, TrainingActions, TrainingInner } from './frame';
import { WrittenAnswer, WrittenField } from './examParts';
import { trainingBase, trainingPaths, useGet, type ExamGate } from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/exam/:courseId, the I-SAPS module exam (ModuleExamPanel on its
 * own page), one question per screen like the level exam. Everything the panel does is kept, on
 * the same endpoints:
 *
 *   gate        GET /training/modules?course_id → `exam` (bd-60149). Open, no sitting: Ready and
 *               Start exam. Closed, no sitting: Locked, with the gate's own short word as a chip
 *               (its sentence is not shown).
 *   paper       GET /exam/questions opens or RESUMES the attempt (seeded, so a reload is the same
 *               paper); GET /exam/draft restores her answers (bd-60169).
 *   autosave    each answer on its own, 800ms after she stops: PUT /exam/draft. Shown as a quiet
 *               chip — Saving…, Saved, Not saved — never a toast; a failed save retries on the
 *               next change.
 *   submit      POST /exam/attempts. A written answer being graded (or a sitting already in)
 *               comes back from her record: GET /exam/attempts (bd-2exhl).
 *   sittings    the latest as a Hero (Being graded / Not passed with "MCQ 1/2" and "Need 2" /
 *               Passed), her answers in a sheet, earlier ones as rows. Try again only after a
 *               failed sitting (canRetake, as before).
 */
type Question = { id: number; index: number; question_text: string; options: string[]; option_images: string[] | null; is_open_ended: boolean };

/**
 * ONE rule for "is this a written question": the server says so, or there is nothing to pick from.
 * The text box, the autosave and the submit all ask this, so a box that was drawn can never have its
 * words sent as a picked option (chosen_option is varchar(32)).
 */
const isWritten = (q: Question) => q.is_open_ended || (!(q.options || []).length && !(q.option_images || []).length);
type Attempt = {
  id: string;
  status: 'pending_review' | 'failed' | 'passed';
  started_at: string;
  completed_at: string | null;
  mcq_correct: number;
  mcq_served: number;
  mcq_needed: number;
  crq: { held: boolean; score: number | null; max: number; feedback: string | null };
  answers: Array<{ index: number; question_text: string; is_open_ended: boolean; options: string[]; chosen_option: string | null; answer_text: string | null }>;
};
type Save = 'idle' | 'saving' | 'saved' | 'error';

const LETTERS = 'ABCDEFGH';

export default function TrainingModuleExam() {
  const { courseId = '' } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const paths = trainingPaths(trainingBase(pathname));
  const id = encodeURIComponent(courseId);

  const gate = useGet<ExamGate | null>('/training/modules', { course_id: courseId }, (d) => (d as { exam?: ExamGate | null })?.exam ?? null);
  const attempts = useGet<Attempt[]>(`/training/module/${id}/exam/attempts`, undefined,
    (d) => (Array.isArray((d as { attempts?: Attempt[] })?.attempts) ? (d as { attempts: Attempt[] }).attempts : []));

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [index, setIndex] = useState(0);
  const [opening, setOpening] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [save, setSave] = useState<Save>('idle');
  const [result, setResult] = useState<{ score: number | null; total: number | null; passed: boolean | null } | null>(null);
  const [answersOpen, setAnswersOpen] = useState(false);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => () => { Object.values(timers.current).forEach((t) => clearTimeout(t)); }, []);

  const g = gate.data;
  const title = TRAINING_COPY.moduleExamN(g?.module_no ?? null);
  const latest = attempts.data && attempts.data.length ? attempts.data[0] : null;
  const earlier = attempts.data ? attempts.data.slice(1) : [];
  // A new sitting only when there is none on record or the last one was not passed (bd-2exhl).
  const canRetake = !latest || latest.status === 'failed';

  const start = async () => {
    if (opening) return;
    setOpening(true);
    setProblem(null);
    try {
      const { data } = await api.get(`/training/module/${id}/exam/questions`);
      const qs: Question[] = data.questions || [];
      const restored: Record<number, string> = {};
      if (data.attempt_id) {
        try {
          const { data: draft } = await api.get(`/training/module/${id}/exam/draft`, { params: { attempt_id: data.attempt_id } });
          for (const a of draft?.answers || []) {
            const v = a.answer_text ?? a.chosen_option;
            if (v !== null && v !== undefined && String(v).length > 0) restored[Number(a.question_id)] = String(v);
          }
        } catch { /* best-effort: a blank paper is the old behaviour */ }
      }
      setQuestions(qs);
      setAttemptId(data.attempt_id || null);
      setAnswers(restored);
      setSave(Object.keys(restored).length ? 'saved' : 'idle');
      setIndex(0);
      setResult(null);
    } catch {
      // A refusal (409, the gate) or a failed read: say so in two words; the gate is asked again.
      setProblem(TRAINING_COPY.notLoaded);
      gate.reload();
    } finally {
      setOpening(false);
    }
  };

  /** bd-60169 — one answer saved on its own, 800ms after the last change. */
  const saveDraft = useCallback((questionId: number, value: string) => {
    if (!attemptId || !questions) return;
    const qi = questions.findIndex((x) => x.id === questionId);
    const q = questions[qi];
    if (!q) return;
    clearTimeout(timers.current[questionId]);
    timers.current[questionId] = setTimeout(async () => {
      setSave('saving');
      try {
        const { data } = await api.put(`/training/module/${id}/exam/draft`, {
          attempt_id: attemptId,
          question_id: questionId,
          question_index: qi,
          chosen_option: isWritten(q) ? null : value,
          answer_text: isWritten(q) ? value : null,
        });
        setSave(data?.saved ? 'saved' : 'error');
      } catch {
        setSave('error');
      }
    }, 800);
  }, [attemptId, questions, id]);

  const setAnswer = (questionId: number, value: string) => {
    setAnswers((a) => ({ ...a, [questionId]: value }));
    saveDraft(questionId, value);
  };

  const qs = questions || [];
  const q = qs[Math.min(index, Math.max(0, qs.length - 1))];
  const answered = (x: Question) => (answers[x.id] || '').trim().length > 0;
  const last = index >= qs.length - 1;

  const submit = async () => {
    if (!attemptId || sending || !qs.every(answered)) return;
    setSending(true);
    setProblem(null);
    try {
      const payload = qs.map((x) => (isWritten(x)
        ? { question_id: x.id, answer_text: answers[x.id] }
        : { question_id: x.id, chosen_option: answers[x.id] }));
      const { data } = await api.post(`/training/module/${id}/exam/attempts`, { attempt_id: attemptId, answers: payload });
      setQuestions(null);
      if (data?.already_submitted || data?.crq_pending) {
        // What happened is in her record; the gate is read again too (bd-2exhl).
        attempts.reload();
        gate.reload();
        return;
      }
      const a = data?.attempt || {};
      setResult({ score: a.score ?? null, total: a.total_questions ?? null, passed: a.is_passed ?? null });
      attempts.reload();
      gate.reload();
    } catch {
      setProblem(TRAINING_COPY.notSent);
    } finally {
      setSending(false);
    }
  };

  const back = () => {
    if (questions && index > 0) { setIndex((i) => i - 1); return; }
    if (questions) { setQuestions(null); return; }
    navigate(-1);
  };

  const problemChip = problem ? <Chip tone="error" icon={CircleAlert}>{problem}</Chip> : null;
  const saveChip = save === 'saving'
    ? <Chip icon={Loader2}>{TRAINING_COPY.saving}</Chip>
    : save === 'saved'
      ? <Chip tone="done" icon={Check}>{TRAINING_COPY.saved}</Chip>
      : save === 'error' ? <Chip tone="error" icon={CircleAlert}>{TRAINING_COPY.notSaved}</Chip> : null;

  /* ── one question per screen ──────────────────────────────────────────── */
  if (questions && q) {
    return (
      <TrainingInner crumb={TRAINING_COPY.crumb()} title={title} backTo={paths.home} onBack={back} right={<Chip>{TRAINING_COPY.of(index + 1, qs.length)}</Chip>}>
        <div className="flex flex-col gap-3 md:max-w-[760px]">
          <QuestionDots label={TRAINING_COPY.questionOf(index + 1, qs.length)} total={qs.length} current={index} />
          {saveChip || problemChip ? <div className="flex flex-wrap gap-1.5">{saveChip}{problemChip}</div> : null}
          <p dir="auto" className="whitespace-pre-line text-[19px] font-extrabold leading-[1.35] text-nu-surface-text rtl:font-bold rtl:leading-[2]">
            {q.question_text}
          </p>
          {isWritten(q) ? (
            <WrittenField value={answers[q.id] || ''} floor={0} onChange={(v) => setAnswer(q.id, v)} disabled={sending} />
          ) : (
            <AnswerChoices
              key={q.id}
              label={TRAINING_COPY.answers}
              options={q.options || []}
              images={q.option_images}
              value={answers[q.id] ? [Number(answers[q.id]) - 1] : []}
              onChange={(v) => setAnswer(q.id, v.length ? String(v[0] + 1) : '')}
              disabled={sending}
            />
          )}
        </div>
        <TrainingActions>
          {last ? (
            <BottomButton icon={Check} onClick={submit} disabled={!answered(q) || sending} testId="training-module-exam-submit">
              {sending ? TRAINING_COPY.sending : TRAINING_COPY.submit}
            </BottomButton>
          ) : (
            <BottomButton icon={ChevronRight} iconFlips onClick={() => setIndex((i) => i + 1)} disabled={!answered(q)} testId="training-module-exam-next">
              {TRAINING_COPY.next}
            </BottomButton>
          )}
        </TrainingActions>
      </TrainingInner>
    );
  }

  /* ── the gate and her sittings ────────────────────────────────────────── */
  const loading = gate.loading || attempts.loading;
  const gateWord = (g?.cta || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

  let hero = null;
  if (result && result.passed !== null && !latest) {
    hero = (
      <Hero
        title={result.passed ? TRAINING_COPY.passed : TRAINING_COPY.notPassed}
        icon={result.passed ? Check : XCircle}
        tone={result.passed ? 'done' : 'neutral'}
        chips={result.score !== null && result.total !== null ? <Chip>{TRAINING_COPY.of(result.score, result.total)}</Chip> : undefined}
        live
      />
    );
  } else if (latest) {
    const tally = <Chip>{TRAINING_COPY.mcq(latest.mcq_correct, latest.mcq_served)}</Chip>;
    hero = latest.status === 'pending_review'
      ? <Hero title={TRAINING_COPY.beingGraded} icon={Hourglass} tone="waiting" chips={tally} live />
      : latest.status === 'failed'
        ? <Hero title={TRAINING_COPY.notPassed} icon={XCircle} tone="neutral" chips={<>{tally}<Chip>{TRAINING_COPY.need(latest.mcq_needed)}</Chip></>} live />
        : <Hero title={TRAINING_COPY.passed} icon={Check} tone="done" chips={tally} live />;
  } else if (g && g.available) {
    hero = <Hero title={TRAINING_COPY.ready} icon={GraduationCap} tone="neutral" chips={<Chip icon={PenLine}>{TRAINING_COPY.writtenAnswer}</Chip>} />;
  } else if (g) {
    hero = (
      <Hero
        title={TRAINING_COPY.locked}
        icon={Lock}
        tone="neutral"
        chips={gateWord && gateWord.toLowerCase() !== TRAINING_COPY.locked.toLowerCase() ? <Chip icon={Lock}>{gateWord}</Chip> : undefined}
      />
    );
  }

  const offerStart = !loading && g && ((!latest && g.available) || (latest && canRetake));

  return (
    <TrainingInner crumb={TRAINING_COPY.crumb()} title={title} backTo={paths.home}>
      {loading && !gate.data ? <Loading /> : null}
      {!gate.loading && gate.error ? <NotLoaded onRetry={() => { gate.reload(); attempts.reload(); }} /> : null}
      {!gate.loading && !gate.error && !g ? <Hero title={TRAINING_COPY.noExam} icon={GraduationCap} tone="neutral" /> : null}
      {!loading ? hero : null}
      {problemChip ? <div className="flex flex-wrap justify-center gap-1.5">{problemChip}</div> : null}

      {latest ? (
        <>
          <List>
            <Row icon={PenLine} title={TRAINING_COPY.myAnswers} onClick={() => setAnswersOpen(true)} testId="training-exam-answers" />
          </List>
          <Sheet open={answersOpen} title={TRAINING_COPY.myAnswers} onClose={() => setAnswersOpen(false)}>
            <ol className="flex flex-col gap-2.5">
              {latest.answers.map((a) => {
                const n = Number(a.chosen_option);
                const picked = !a.is_open_ended && Number.isInteger(n) && n >= 1 ? a.options[n - 1] : undefined;
                const shown = a.is_open_ended ? (a.answer_text || TRAINING_COPY.notTaken) : (picked ?? TRAINING_COPY.notTaken);
                const mark = a.is_open_ended && !latest.crq.held && latest.crq.score !== null ? TRAINING_COPY.of(latest.crq.score, latest.crq.max) : null;
                const letter = !a.is_open_ended && picked !== undefined ? LETTERS[n - 1] : null;
                return (
                  <WrittenAnswer
                    key={`${latest.id}-${a.index}`}
                    question={a.question_text}
                    answer={shown}
                    score={letter ?? mark}
                    feedback={a.is_open_ended && !latest.crq.held ? latest.crq.feedback : null}
                  />
                );
              })}
            </ol>
          </Sheet>
        </>
      ) : null}

      {earlier.length ? (
        <div data-testid="training-exam-earlier" className="flex flex-col gap-3">
          <SectionLabel>{TRAINING_COPY.earlier}</SectionLabel>
          <List>
            {earlier.map((a) => (
              <Row
                key={a.id}
                icon={a.status === 'passed' ? Check : a.status === 'failed' ? XCircle : Hourglass}
                tile={a.status === 'passed' ? 'done' : 'quiet'}
                title={a.status === 'passed' ? TRAINING_COPY.passed : a.status === 'failed' ? TRAINING_COPY.notPassed : TRAINING_COPY.beingGraded}
                chips={(
                  <>
                    <Chip>{shortDate((a.completed_at || a.started_at).slice(0, 10))}</Chip>
                    <Chip>{TRAINING_COPY.mcq(a.mcq_correct, a.mcq_served)}</Chip>
                  </>
                )}
              />
            ))}
          </List>
        </div>
      ) : null}

      {offerStart ? (
        <TrainingActions>
          <BottomButton icon={latest ? RotateCcw : Play} onClick={start} disabled={opening} testId="training-module-exam-start">
            {latest ? TRAINING_COPY.retry : TRAINING_COPY.startExam}
          </BottomButton>
        </TrainingActions>
      ) : null}
    </TrainingInner>
  );
}
