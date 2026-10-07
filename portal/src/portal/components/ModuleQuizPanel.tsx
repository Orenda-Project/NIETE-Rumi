/**
 * ModuleQuizPanel — quiz-taking UI for a training module, embedded in the
 * module detail card on the Training page.
 *
 * bd-klecr.6 (operator, 2026-10-06; design versions/v4_quiz-one-per-page):
 * ONE QUESTION PER PAGE, with a verdict after each answer.
 *
 *   idle       "Take Quiz" / "Retake Quiz" (hidden when the module has no
 *              active questions — the questions fetch on mount decides).
 *   taking     POST …/quiz-attempts/start opens (or, after a reload, RESUMES)
 *              her attempt and serves its paper. One question at a time,
 *              "Question N of M". She picks, taps Check: POST …/answer SAVES
 *              the answer and says Correct or Not correct. Her pick is
 *              coloured; the right option is never shown (as on WhatsApp,
 *              bd-2523), and the answer is locked — the server refuses a
 *              second one. Next question; on the last, Submit quiz.
 *   result     The result the server saved when the last answer was checked
 *              (or POST …/finish when that could not close it): score, passed
 *              or not, ✓/✗ per question, Retake. The tick and the green tone
 *              are reserved for a PASS (bd-zgme6): a NIETE 4/5 is 80% and
 *              still a fail.
 *
 * The quiz is the module's gate, not a self-check (bd-zgme6). The server
 * writes module progress ONLY on a pass (bd-2450), against the vendor's module
 * bar, which arrives on the result as `pass_pct`; this file never holds one.
 *
 * chosen_option is the CANONICAL 1-indexed option position as a string ('1',
 * '2', …; '1,3' for a pick-all question) — each served option carries it as
 * `value`, whatever order the paper shows the options in.
 */

import { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, Loader2, CheckCircle2, XCircle, RotateCcw, Check, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';


const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export type QuizQuestion = {
  id: number;
  question_text: string;
  options: string[];
  order_index: number;
  /** bd-2138 — msq question: multiple answers are correct; renders checkboxes
   *  and submits the selected set as a comma-joined string ('1,3'). */
  multi?: boolean;
};

// Toggle an option in a comma-joined selection set ('1,3'), keeping it
// numerically sorted so the server's set-equality normalisation is trivially
// satisfied.
function toggleInSet(current: string, optValue: string): string {
  const set = new Set(current ? current.split(',') : []);
  if (set.has(optValue)) set.delete(optValue);
  else set.add(optValue);
  return [...set].map(Number).sort((a, b) => a - b).join(',');
}

export type SubmittedAttempt = {
  id: string;
  score: number;
  max_score: number;
  is_passed: boolean;
  /** The vendor's module bar the server marked against (bd-2483). Absent from
   *  older responses, so treat it as optional and never invent a value. */
  pass_pct?: number | null;
  completed_at: string;
};

/**
 * The line under a failed result. The number is the bar the server marked
 * against; with no bar in the response the copy names none rather than guess.
 */
function notPassedCopy(passPct: number | null | undefined): string {
  if (typeof passPct === 'number' && passPct >= 100) {
    return 'Not passed yet. You need to get every answer right to complete this module. Review the content above and try again.';
  }
  if (typeof passPct === 'number' && passPct > 0) {
    return `Not passed yet. You need ${passPct}% or more to complete this module. Review the content above and try again.`;
  }
  return 'Not passed yet. Review the content above and try again.';
}

type Phase = 'idle' | 'starting' | 'taking' | 'result';

/** A question as the attempt serves it: options in display order, each with its canonical value. */
type ServedQuestion = {
  id: number;
  question_text: string;
  multi?: boolean;
  options: Array<{ value: string; text: string }>;
};
type Verdict = { chosen_option: string; is_correct: boolean };
type QuestionResult = { question_id: number; question_index: number; is_correct: boolean };
type FinishedQuiz = { attempt: SubmittedAttempt; results: QuestionResult[] };

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

// Same colour ladder as QuizScoreBadge / VendorAvgScorePill on the Training
// page so the visual language stays consistent.
function scoreTone(pct: number): string {
  if (pct >= 80) return 'text-green-700 bg-green-50 border-green-200';
  if (pct >= 50) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

// bd-zgme6 — the result card's tone. A failed attempt is never green, however
// high the percentage: NIETE's bar is 100%, so 4/5 (80%) is a fail.
function resultTone(pct: number, passed: boolean): string {
  if (passed) return scoreTone(pct);
  return pct >= 50 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200';
}

const ModuleQuizPanel = ({
  moduleId,
  hasAttempts,
  hasQuestions,
  onSubmitted,
}: {
  moduleId: string;
  /** Whether the teacher already has recorded attempts on this module (drives the button label). */
  hasAttempts: boolean;
  /** Whether the module has an active quiz at all. Known by the parent from the
   *  module detail, so a quiz-less module skips the questions fetch entirely
   *  rather than round-tripping for a list it knows will be empty. */
  hasQuestions: boolean;
  /** Called once the result is saved, so the parent can refresh the score badge + completion state. */
  onSubmitted?: (attempt: SubmittedAttempt) => void;
}) => {
  const { toast } = useToast();

  // The bank, read on mount only to know whether there is a quiz and how long.
  const [bank, setBank] = useState<QuizQuestion[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [paper, setPaper] = useState<ServedQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [pick, setPick] = useState('');
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [busy, setBusy] = useState(false);
  // The result the LAST answer saved, held until she taps Submit quiz.
  const [saved, setSaved] = useState<FinishedQuiz | null>(null);
  const [result, setResult] = useState<FinishedQuiz | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBank(null);
    setPhase('idle');
    setResult(null);
    (async () => {
      if (!hasQuestions) { setBank([]); return; }
      try {
        const { data } = await api.get(`/training/module/${moduleId}/questions`);
        if (!cancelled) setBank(data.questions || []);
      } catch {
        if (!cancelled) setBank([]);
      }
    })();
    return () => { cancelled = true; };
  }, [moduleId, hasQuestions]);

  const finishWith = useCallback((done: FinishedQuiz) => {
    setResult(done);
    setPhase('result');
    onSubmitted?.(done.attempt);
  }, [onSubmitted]);

  const handleStart = useCallback(async () => {
    setPhase('starting');
    setResult(null);
    setSaved(null);
    setPick('');
    try {
      const { data } = await api.post(`/training/module/${moduleId}/quiz-attempts/start`);
      const served: ServedQuestion[] = data.questions || [];
      const done: Record<number, Verdict> = {};
      for (const a of data.answered || []) done[a.question_id] = { chosen_option: String(a.chosen_option ?? ''), is_correct: !!a.is_correct };
      setAttemptId(data.attempt.id);
      setPaper(served);
      setVerdicts(done);
      const at = Math.min(Number(data.attempt.current_index) || 0, Math.max(served.length - 1, 0));
      setIndex(at);
      setPhase('taking');
    } catch (err) {
      toast({ title: errorText(err, 'Could not open the quiz — please try again'), variant: 'destructive' });
      setPhase('idle');
    }
  }, [moduleId, toast]);

  const question = paper[index];
  const verdict = question ? verdicts[question.id] : undefined;
  const isLast = index >= paper.length - 1;

  const handleCheck = useCallback(async () => {
    if (!question || !pick || busy || !attemptId) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/training/module/${moduleId}/quiz-attempts/${attemptId}/answer`, {
        question_id: question.id, chosen_option: pick,
      });
      setVerdicts((v) => ({ ...v, [question.id]: { chosen_option: pick, is_correct: !!data.is_correct } }));
      if (data.result) setSaved({ attempt: data.result.attempt, results: data.result.results || [] });
    } catch (err) {
      const r = (err as { response?: { status?: number; data?: { already_answered?: boolean; chosen_option?: string; is_correct?: boolean } } })?.response;
      if (r?.status === 409 && r.data?.already_answered) {
        // Checked before (another tab, a reload): the first answer stands.
        setVerdicts((v) => ({ ...v, [question.id]: { chosen_option: String(r.data?.chosen_option ?? ''), is_correct: !!r.data?.is_correct } }));
      } else {
        toast({ title: errorText(err, 'Could not check this answer — please try again'), variant: 'destructive' });
      }
    } finally {
      setBusy(false);
    }
  }, [question, pick, busy, attemptId, moduleId, toast]);

  const handleNext = useCallback(() => {
    setPick('');
    setIndex((i) => Math.min(i + 1, paper.length - 1));
  }, [paper.length]);

  const handleSubmit = useCallback(async () => {
    if (saved) { finishWith(saved); return; }
    if (!attemptId) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/training/module/${moduleId}/quiz-attempts/${attemptId}/finish`);
      finishWith({ attempt: data.attempt, results: data.results || [] });
    } catch (err) {
      toast({ title: errorText(err, 'Could not submit the quiz — please try again'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [saved, attemptId, moduleId, finishWith, toast]);

  // No quiz on this module (or still fetching) → render nothing.
  if (!bank || bank.length === 0) return null;

  // ---- idle: the entry button --------------------------------------------
  if (phase === 'idle' || phase === 'starting') {
    return (
      <div className="border-t pt-4" data-testid="quiz-panel-idle">
        <Button onClick={handleStart} disabled={phase === 'starting'} data-testid="quiz-take-button">
          {phase === 'starting' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
          {hasAttempts ? 'Retake Quiz' : 'Take Quiz'}
        </Button>
        {/* No count here: the bank is not the paper. A vendor serving one
            question per Bloom level (NIETE) asks 3 of a 12-question bank, and
            "Question 1 of 3" says the real number once she starts. */}
        <span className="ml-3 text-xs text-muted-foreground" data-testid="quiz-idle-caption">
          Pass this quiz to complete this module
        </span>
      </div>
    );
  }

  // ---- result: score card ------------------------------------------------
  if (phase === 'result' && result) {
    const r = result.attempt;
    const pct = r.max_score > 0 ? Math.round((r.score / r.max_score) * 100) : 0;
    return (
      <div className="border-t pt-4 space-y-3" data-testid="quiz-panel-result">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border font-medium ${resultTone(pct, r.is_passed)}`} data-testid="quiz-result-score">
          {r.is_passed ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          Quiz result: {r.score} / {r.max_score} ({pct}%)
        </div>
        <p className="text-sm text-muted-foreground">
          {/* bd-2489 — `is_passed` means "cleared the vendor's
              module_passing_pct" (bd-2483), not "got everything right". Only
              claim perfect when it actually is. */}
          {r.is_passed
            ? (r.score === r.max_score ? 'Perfect score — great work!' : 'Passed — nice work!')
            : notPassedCopy(r.pass_pct)}
        </p>
        {result.results.length > 0 && (
          <ul className="space-y-1.5 max-w-md" data-testid="quiz-result-list">
            {result.results.map((q) => (
              <li
                key={q.question_id}
                data-testid={`quiz-result-q-${q.question_index}`}
                data-correct={q.is_correct ? 'true' : 'false'}
                className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm"
              >
                <span>Question {q.question_index + 1}</span>
                {q.is_correct
                  ? <Check className="w-4 h-4 text-green-700" aria-label="Correct" />
                  : <X className="w-4 h-4 text-red-700" aria-label="Not correct" />}
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" onClick={handleStart} data-testid="quiz-retake-button">
          <RotateCcw className="w-4 h-4 mr-2" /> Retake Quiz
        </Button>
      </div>
    );
  }

  // ---- taking: one question per page --------------------------------------
  if (!question) return null;
  const locked = !!verdict;
  const chosen = locked ? verdict!.chosen_option : pick;
  const chosenSet = new Set(chosen ? chosen.split(',') : []);

  return (
    <div className="border-t pt-4 space-y-4" data-testid="quiz-panel-taking">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-primary" /> Module Quiz
        </span>
        <span className="text-xs font-bold tracking-wider text-muted-foreground" data-testid="quiz-progress-text">
          {`Question ${index + 1} of ${paper.length}`}
        </span>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3" data-testid={`quiz-question-${question.id}`}>
        <p className="text-base font-semibold">
          {question.question_text}
          {question.multi && <span className="ml-2 text-xs font-normal text-muted-foreground">(select all that apply)</span>}
        </p>
        <div className="space-y-2" role={question.multi ? 'group' : 'radiogroup'}>
          {question.options.map((opt, oi) => {
            const mine = chosenSet.has(opt.value);
            const mark = locked && mine ? (verdict!.is_correct ? 'correct' : 'wrong') : undefined;
            const look = mark === 'correct'
              ? 'border-green-600 bg-green-50'
              : mark === 'wrong'
                ? 'border-red-600 bg-red-50'
                : mine
                  ? 'border-primary bg-primary/10'
                  : locked ? 'opacity-50' : 'hover:bg-muted/50';
            return (
              <button
                key={opt.value}
                type="button"
                disabled={locked || busy}
                data-verdict={mark}
                aria-pressed={mine}
                onClick={() => setPick((p) => (question.multi ? toggleInSet(p, opt.value) : opt.value))}
                className={`w-full min-h-[52px] text-left rounded-xl border-2 px-3 py-2.5 flex items-center gap-3 text-sm transition-colors ${look}`}
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                  mark === 'correct' ? 'bg-green-700 text-white' : mark === 'wrong' ? 'bg-red-700 text-white' : mine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}>
                  {OPTION_LETTERS[oi] || oi + 1}
                </span>
                <span className="flex-1">{opt.text}</span>
                {mark === 'correct' && <Check className="w-4 h-4 text-green-700 shrink-0" />}
                {mark === 'wrong' && <X className="w-4 h-4 text-red-700 shrink-0" />}
              </button>
            );
          })}
        </div>

        {locked && (
          <div
            data-testid="quiz-verdict"
            role="status"
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${
              verdict!.is_correct ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}
          >
            {verdict!.is_correct ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {verdict!.is_correct ? 'Correct' : 'Not correct'}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {!locked ? (
          <Button onClick={handleCheck} disabled={!pick || busy} data-testid="quiz-check-button">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Check
          </Button>
        ) : isLast ? (
          <Button onClick={handleSubmit} disabled={busy} data-testid="quiz-submit-button">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Submit quiz
          </Button>
        ) : (
          <Button onClick={handleNext} data-testid="quiz-next-button">
            Next question <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setPhase('idle')} disabled={busy} data-testid="quiz-cancel-button">
          Close
        </Button>
      </div>
    </div>
  );
};

export default ModuleQuizPanel;
