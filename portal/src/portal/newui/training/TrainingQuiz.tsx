import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, CircleAlert, ClipboardCheck, Clock, Play, RotateCcw, X } from 'lucide-react';
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
 * bd-klecr.6 (operator, 2026-10-06) — the same flow and the same server as ModuleQuizPanel:
 *   POST /training/module/:id/quiz-attempts/start opens (or, after a reload, resumes) her attempt
 *   and serves ITS paper — the bot's choice for the vendor (NIETE: one question per Bloom level,
 *   options shuffled), not the whole bank the old GET …/questions returned. Each option carries its
 *   canonical 1-based `value`, which is what is sent ('1,3' for a pick-all question).
 *
 *   quiz    the light bar (crumb "Training · <part>", "Quick check", "2/3" at its end), the dots,
 *           the question, big answers. Check once picked: POST …/answer SAVES and marks it —
 *           "Correct" or "Not correct", her pick green or red (the right one never shown), the
 *           answer locked. Next; Submit on the last. Back (the bar's, and Android's through the
 *           bar) shows an earlier question, still locked, and from the first question leaves.
 *   result  the result the LAST answer saved (POST …/finish only if it could not): a ring with the
 *           score, Passed or Not passed, the %, a row per question, an Up next row; Continue to the
 *           next part, Try again (a new attempt). No "Practice" chip (deep-screens.html has one):
 *           since bd-2450 only a PASS completes the part and opens the next.
 */
type Served = { id: number; question_text: string; multi?: boolean; options: Array<{ value: string; text: string }> };
type Attempt = { id: string; score: number; max_score: number; is_passed: boolean; completed_at: string };
type QuestionResult = { question_id: number; question_index: number; is_correct: boolean };
type Finished = { attempt: Attempt; results: QuestionResult[] };
type Verdict = { chosen_option: string; is_correct: boolean };
type Detail = { id: string; title: string; course: { id: string; title: string } | null; level: { id: number; name: string } | null };

/** Canonical value(s) → the 0-based positions AnswerChoices shows, in this paper's option order. */
const positionsOf = (q: Served, chosen: string) => {
  const set = new Set(chosen.split(','));
  return q.options.flatMap((o, i) => (set.has(o.value) ? [i] : []));
};
const valueOf = (q: Served, positions: number[]) =>
  positions.map((i) => Number(q.options[i]?.value)).filter(Number.isFinite).sort((x, y) => x - y).join(',');

export default function TrainingQuiz() {
  const { moduleId = '' } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const paths = trainingPaths(trainingBase(pathname));
  const id = encodeURIComponent(moduleId);

  const detail = useGet<Detail>(`/training/module/${id}`, undefined, (d) => (d as { module: Detail }).module);
  const courseId = detail.data?.course?.id ?? null;

  const [paper, setPaper] = useState<Served[] | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [opening, setOpening] = useState(true);
  const [openFailed, setOpenFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [picks, setPicks] = useState<Record<number, number[]>>({});
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [sending, setSending] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const [saved, setSaved] = useState<Finished | null>(null);
  const [result, setResult] = useState<Finished | null>(null);

  const open = useCallback(async () => {
    setOpening(true);
    setOpenFailed(false);
    setResult(null);
    setSaved(null);
    setPicks({});
    setNotSent(false);
    try {
      const { data } = await api.post(`/training/module/${id}/quiz-attempts/start`);
      const served: Served[] = data.questions || [];
      const done: Record<number, Verdict> = {};
      for (const a of data.answered || []) done[a.question_id] = { chosen_option: String(a.chosen_option ?? ''), is_correct: !!a.is_correct };
      setPaper(served);
      setAttemptId(data.attempt.id);
      setVerdicts(done);
      setIndex(Math.min(Number(data.attempt.current_index) || 0, Math.max(served.length - 1, 0)));
    } catch {
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  }, [id]);
  useEffect(() => { void open(); }, [open]);

  // After the result the server may have opened the next part (I-SAPS unit locks), so the course's
  // parts are read again for the result's Up next.
  const modules = useGet<ModuleSummary[]>(courseId ? '/training/modules' : null,
    courseId ? { course_id: courseId } : undefined,
    (x) => (x as { modules?: ModuleSummary[] })?.modules || []);
  const reloadModules = modules.reload;
  useEffect(() => { if (result) reloadModules(); }, [result, reloadModules]);
  const levels = useGet<Level[]>('/training/levels', undefined, (x) => (x as { levels?: Level[] })?.levels || []);

  const qs = paper || [];
  const q = qs[Math.min(index, Math.max(0, qs.length - 1))];
  const verdict = q ? verdicts[q.id] : undefined;
  const picked = q ? (verdict ? positionsOf(q, verdict.chosen_option) : picks[q.id] || []) : [];
  const last = index >= qs.length - 1;
  const partTitle = detail.data?.title;
  const partUrl = paths.unit(moduleId);

  const back = () => {
    if (!result && index > 0) { setIndex((i) => i - 1); return; }
    navigate(-1);
  };

  const check = async () => {
    if (!q || verdict || sending || !picked.length || !attemptId) return;
    const chosen = valueOf(q, picked);
    setSending(true);
    setNotSent(false);
    try {
      const { data } = await api.post(`/training/module/${id}/quiz-attempts/${attemptId}/answer`, { question_id: q.id, chosen_option: chosen });
      setVerdicts((v) => ({ ...v, [q.id]: { chosen_option: chosen, is_correct: !!data.is_correct } }));
      if (data.result) setSaved({ attempt: data.result.attempt, results: data.result.results || [] });
    } catch (err) {
      const r = (err as { response?: { status?: number; data?: { already_answered?: boolean; chosen_option?: string; is_correct?: boolean } } })?.response;
      if (r?.status === 409 && r.data?.already_answered) {
        // Checked before (another tab, a reload): the first answer stands.
        setVerdicts((v) => ({ ...v, [q.id]: { chosen_option: String(r.data?.chosen_option ?? ''), is_correct: !!r.data?.is_correct } }));
      } else {
        setNotSent(true);
      }
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    if (saved) { setResult(saved); return; }
    if (sending || !attemptId) return;
    setSending(true);
    setNotSent(false);
    try {
      const { data } = await api.post(`/training/module/${id}/quiz-attempts/${attemptId}/finish`);
      setResult({ attempt: data.attempt as Attempt, results: data.results || [] });
    } catch {
      setNotSent(true);
    } finally {
      setSending(false);
    }
  };

  const again = () => { setIndex(0); void open(); };

  const counter = !result && qs.length ? <Chip>{TRAINING_COPY.of(index + 1, qs.length)}</Chip> : null;

  if (result) {
    const done = result;
    const attempt = done.attempt;
    // Only a pass completes the part (bd-2450); the parts are read again after the result.
    const list = (modules.data || []).map((m) => (attempt.is_passed && m.id === moduleId && !m.completed_at ? { ...m, completed_at: attempt.completed_at } : m));
    const after = partAfter(list, moduleId);
    const levelId = detail.data?.level?.id;
    const vendorKey = levels.data?.find((l) => l.id === levelId)?.vendor_key ?? null;
    const courseUrl = vendorKey && levelId != null && courseId ? paths.course(vendorKey, levelId, courseId) : partUrl;
    const pct = percent(attempt.score, attempt.max_score);
    return (
      <TrainingInner crumb={TRAINING_COPY.crumb(partTitle)} title={TRAINING_COPY.quickCheck} backTo={partUrl}>
        <Hero
          title={attempt.is_passed ? TRAINING_COPY.passed : TRAINING_COPY.notPassed}
          ring={{ value: attempt.max_score > 0 ? attempt.score / attempt.max_score : 0, text: TRAINING_COPY.of(attempt.score, attempt.max_score) }}
          chips={(
            <>
              <Chip tone={attempt.is_passed ? 'done' : 'info'}>{TRAINING_COPY.pct(pct)}</Chip>
            </>
          )}
          live
        />
        {done.results.length ? (
          <List label={TRAINING_COPY.answers}>
            {done.results.map((r) => (
              <Row
                key={r.question_id}
                icon={r.is_correct ? Check : X}
                tile={r.is_correct ? 'done' : 'quiet'}
                title={TRAINING_COPY.questionN(r.question_index + 1)}
                value={r.is_correct
                  ? <Chip tone="done" icon={Check}>{TRAINING_COPY.correct}</Chip>
                  : <Chip tone="error" icon={X}>{TRAINING_COPY.notCorrect}</Chip>}
                testId={`training-quiz-result-q-${r.question_index}`}
              />
            ))}
          </List>
        ) : null}
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
      {opening ? <Loading /> : null}
      {!opening && openFailed ? <NotLoaded onRetry={() => { void open(); }} /> : null}
      {!opening && !openFailed && qs.length === 0 ? <Hero title={TRAINING_COPY.empty} icon={ClipboardCheck} tone="neutral" /> : null}

      {!opening && q ? (
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
            options={q.options.map((o) => o.text)}
            mode={q.multi ? 'multi' : 'single'}
            value={picked}
            onChange={(v) => setPicks((a) => ({ ...a, [q.id]: v }))}
            disabled={sending || Boolean(verdict)}
            verdict={verdict ? (verdict.is_correct ? 'correct' : 'wrong') : undefined}
          />
          {verdict ? (
            <div data-testid="training-quiz-verdict" role="status" className="flex flex-wrap gap-1.5">
              {verdict.is_correct
                ? <Chip tone="done" icon={Check}>{TRAINING_COPY.correct}</Chip>
                : <Chip tone="error" icon={X}>{TRAINING_COPY.notCorrect}</Chip>}
            </div>
          ) : null}
        </div>
      ) : null}

      {!opening && q ? (
        <TrainingActions>
          {!verdict ? (
            <BottomButton icon={Check} onClick={check} disabled={!picked.length || sending} testId="training-quiz-check">
              {sending ? TRAINING_COPY.sending : TRAINING_COPY.check}
            </BottomButton>
          ) : last ? (
            <BottomButton icon={Check} onClick={submit} disabled={sending} testId="training-quiz-submit">
              {sending ? TRAINING_COPY.sending : TRAINING_COPY.submit}
            </BottomButton>
          ) : (
            <BottomButton icon={ChevronRight} iconFlips onClick={() => setIndex((i) => i + 1)} testId="training-quiz-next">
              {TRAINING_COPY.next}
            </BottomButton>
          )}
        </TrainingActions>
      ) : null}
    </TrainingInner>
  );
}
