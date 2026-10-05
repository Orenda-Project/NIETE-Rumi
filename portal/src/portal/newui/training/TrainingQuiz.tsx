import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, CircleAlert, ClipboardCheck, Clock, Play, RotateCcw } from 'lucide-react';
import api from '../../services/api';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';
import { Hero } from '../Hero';
import { AnswerChoices, QuestionDots } from '../Answers';
import { TRAINING_COPY } from '../copy';
import { Loading, NotLoaded, TrainingActions, TrainingInner } from './frame';
import { partAfter, percent, trainingBase, trainingPaths, useGet, type Level, type ModuleSummary } from './trainingApi';

/**
 * bd-5rz1v.25 — /portal/training/unit/:moduleId/quiz, the quick check ONE QUESTION PER SCREEN,
 * then its result (deep-screens.html, Training 6 and 7).
 *
 * The data is ModuleQuizPanel's, unchanged: GET /training/module/:id/questions, and one POST of
 * the whole answer set to /training/module/:id/quiz-attempts with `chosen_option` as the 1-based
 * key ('1,3' for a pick-all question, numerically sorted). The server marks the part complete on
 * any submit, as before.
 *
 *   quiz    the light bar (crumb "Training · <part>", "Quick check", "2/5" at its end), the dots,
 *           the question, big answers. Next once answered; Back (the bar's, and Android's through
 *           the bar) returns to the previous question with its answer kept, and from the first
 *           question leaves; Submit on the last. Answers live in this page: leaving discards them,
 *           as before.
 *   result  a green ring with the score, Passed or Not passed, the %, an Up next row; Continue to
 *           the next part, Try again. No "Practice" chip (deep-screens.html has one): since bd-2450
 *           only a PASS completes the part and opens the next, so the quick check is not practice.
 */
type Question = { id: number; question_text: string; options: string[]; order_index: number; multi?: boolean };
type Attempt = { id: string; score: number; max_score: number; is_passed: boolean; completed_at: string };
type Detail = { id: string; title: string; course: { id: string; title: string } | null; level: { id: number; name: string } | null };

export default function TrainingQuiz() {
  const { moduleId = '' } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const paths = trainingPaths(trainingBase(pathname));
  const id = encodeURIComponent(moduleId);

  const detail = useGet<Detail>(`/training/module/${id}`, undefined, (d) => (d as { module: Detail }).module);
  const questions = useGet<Question[]>(`/training/module/${id}/questions`, undefined, (d) =>
    [...((d as { questions?: Question[] })?.questions || [])].sort((a, b) => a.order_index - b.order_index));
  const courseId = detail.data?.course?.id ?? null;

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [sending, setSending] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const [result, setResult] = useState<Attempt | null>(null);

  // After a submit the server may have opened the next part (I-SAPS unit locks), so the course's
  // parts are read again for the result's Up next.
  const modules = useGet<ModuleSummary[]>(courseId ? '/training/modules' : null,
    courseId ? { course_id: courseId } : undefined,
    (x) => (x as { modules?: ModuleSummary[] })?.modules || []);
  const reloadModules = modules.reload;
  useEffect(() => { if (result) reloadModules(); }, [result, reloadModules]);
  const levels = useGet<Level[]>('/training/levels', undefined, (x) => (x as { levels?: Level[] })?.levels || []);

  const qs = questions.data || [];
  const q = qs[Math.min(index, Math.max(0, qs.length - 1))];
  const picked = q ? answers[q.id] || [] : [];
  const last = index >= qs.length - 1;
  const partTitle = detail.data?.title;
  const partUrl = paths.unit(moduleId);

  const back = () => {
    if (!result && index > 0) { setIndex((i) => i - 1); return; }
    navigate(-1);
  };

  const submit = async () => {
    if (sending || qs.some((x) => !(answers[x.id] || []).length)) return;
    setSending(true);
    setNotSent(false);
    try {
      const payload = { answers: qs.map((x) => ({ question_id: x.id, chosen_option: (answers[x.id] || []).map((i) => i + 1).join(',') })) };
      const { data } = await api.post(`/training/module/${id}/quiz-attempts`, payload);
      setResult(data.attempt as Attempt);
    } catch {
      setNotSent(true);
    } finally {
      setSending(false);
    }
  };

  const again = () => { setAnswers({}); setIndex(0); setResult(null); setNotSent(false); };

  const counter = !result && qs.length ? <Chip>{TRAINING_COPY.of(index + 1, qs.length)}</Chip> : null;

  if (result) {
    // Only a pass completes the part (bd-2450); the parts are read again after the submit.
    const list = (modules.data || []).map((m) => (result.is_passed && m.id === moduleId && !m.completed_at ? { ...m, completed_at: result.completed_at } : m));
    const after = partAfter(list, moduleId);
    const levelId = detail.data?.level?.id;
    const vendorKey = levels.data?.find((l) => l.id === levelId)?.vendor_key ?? null;
    const courseUrl = vendorKey && levelId != null && courseId ? paths.course(vendorKey, levelId, courseId) : partUrl;
    const pct = percent(result.score, result.max_score);
    return (
      <TrainingInner crumb={TRAINING_COPY.crumb(partTitle)} title={TRAINING_COPY.quickCheck} backTo={partUrl}>
        <Hero
          title={result.is_passed ? TRAINING_COPY.passed : TRAINING_COPY.notPassed}
          ring={{ value: result.max_score > 0 ? result.score / result.max_score : 0, text: TRAINING_COPY.of(result.score, result.max_score) }}
          chips={(
            <>
              <Chip tone={result.is_passed ? 'done' : 'info'}>{TRAINING_COPY.pct(pct)}</Chip>
            </>
          )}
          live
        />
        {after ? (
          <List>
            <Row
              icon={Play}
              title={after.title}
              chips={(
                <>
                  <Chip>{TRAINING_COPY.upNext}</Chip>
                  {after.duration_seconds > 0 ? <Chip icon={Clock}>{TRAINING_COPY.minutes(after.duration_seconds)}</Chip> : null}
                </>
              )}
              to={paths.unit(after.id)}
              testId="training-up-next"
            />
          </List>
        ) : null}
        <TrainingActions>
          <BottomButton icon={Play} to={after ? paths.unit(after.id) : courseUrl} testId="training-result-continue">{TRAINING_COPY.continue}</BottomButton>
          <BottomButton tone="outline" icon={RotateCcw} onClick={again} testId="training-try-again">{TRAINING_COPY.retry}</BottomButton>
        </TrainingActions>
      </TrainingInner>
    );
  }

  return (
    <TrainingInner crumb={TRAINING_COPY.crumb(partTitle)} title={TRAINING_COPY.quickCheck} backTo={partUrl} onBack={back} right={counter}>
      {questions.loading ? <Loading /> : null}
      {!questions.loading && questions.error ? <NotLoaded onRetry={questions.reload} /> : null}
      {!questions.loading && !questions.error && qs.length === 0 ? <Hero title={TRAINING_COPY.empty} icon={ClipboardCheck} tone="neutral" /> : null}

      {q ? (
        <div className="flex flex-col gap-3 md:max-w-[760px]">
          <QuestionDots label={TRAINING_COPY.questionOf(index + 1, qs.length)} total={qs.length} current={index} />
          {q.multi || notSent ? (
            <div className="flex flex-wrap gap-1.5">
              {q.multi ? <Chip icon={Check}>{TRAINING_COPY.pickAll}</Chip> : null}
              {notSent ? <Chip tone="error" icon={CircleAlert}>{TRAINING_COPY.notSent}</Chip> : null}
            </div>
          ) : null}
          <p dir="auto" className="whitespace-pre-line text-[19px] font-extrabold leading-[1.35] text-nu-surface-text rtl:font-bold rtl:leading-[2]">
            {q.question_text}
          </p>
          <AnswerChoices
            key={q.id}
            label={TRAINING_COPY.answers}
            options={q.options || []}
            mode={q.multi ? 'multi' : 'single'}
            value={picked}
            onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
            disabled={sending}
          />
        </div>
      ) : null}

      {q ? (
        <TrainingActions>
          {last ? (
            <BottomButton icon={Check} onClick={submit} disabled={!picked.length || sending} testId="training-quiz-submit">
              {sending ? TRAINING_COPY.sending : TRAINING_COPY.submit}
            </BottomButton>
          ) : (
            <BottomButton icon={ChevronRight} iconFlips onClick={() => setIndex((i) => i + 1)} disabled={!picked.length} testId="training-quiz-next">
              {TRAINING_COPY.next}
            </BottomButton>
          )}
        </TrainingActions>
      ) : null}
    </TrainingInner>
  );
}
