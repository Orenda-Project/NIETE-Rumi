/**
 * ModuleQuizPanel — quiz-taking UI for a training module, embedded in the
 * module detail card on the Training page.
 *
 * Lifecycle:
 *   idle      "Take Quiz" / "Retake Quiz" button (hidden entirely when the
 *             module has no active questions — the questions fetch on mount
 *             decides this).
 *   taking    All questions on one screen as MCQ radio groups, with an
 *             answered-count progress bar. Submit stays disabled until every
 *             question has an answer (the backend rejects partial answer sets).
 *   submitting POST /training/module/:id/quiz-attempts — server-side grading.
 *   result    Score card (X / Y) using the same green ≥80 / amber ≥50 / red
 *             colour ladder as the QuizScoreBadge, plus a Retake button.
 *
 * Non-blocking semantics: the quiz is a self-check. Submitting any answer set
 * marks the module complete server-side (same as WhatsApp); teachers can skip
 * it entirely and complete the module by other means. Retakes are allowed —
 * the WhatsApp side lets teachers re-run module quizzes, and the score badge
 * shows the best of all attempts.
 *
 * chosen_option is the 1-indexed option position as a string ('1', '2', …) —
 * the same convention the WhatsApp quiz buttons use, which is what
 * training_questions.correct_option is stored against.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ClipboardCheck, Loader2, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
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
  completed_at: string;
};

type Phase = 'idle' | 'taking' | 'submitting' | 'result';

// Same colour ladder as QuizScoreBadge / VendorAvgScorePill on the Training
// page so the visual language stays consistent.
function scoreTone(pct: number): string {
  if (pct >= 80) return 'text-green-700 bg-green-50 border-green-200';
  if (pct >= 50) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

const ModuleQuizPanel = ({
  moduleId,
  hasAttempts,
  onSubmitted,
}: {
  moduleId: string;
  /** Whether the teacher already has recorded attempts on this module (drives the button label). */
  hasAttempts: boolean;
  /** Called after a successful submit so the parent can refresh the score badge + completion state. */
  onSubmitted?: (attempt: SubmittedAttempt) => void;
}) => {
  const { toast } = useToast();

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  // question id → chosen option (1-indexed string, matching the DB convention)
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<SubmittedAttempt | null>(null);

  // Fetch the module's active questions once. Empty list → render nothing
  // (module has no quiz). Errors are silent for the same reason the score
  // badges are — the quiz is an enhancement, not the page's core content.
  useEffect(() => {
    let cancelled = false;
    setQuestions(null);
    setPhase('idle');
    setAnswers({});
    setResult(null);
    (async () => {
      try {
        const { data } = await api.get(`/training/module/${moduleId}/questions`);
        if (!cancelled) setQuestions(data.questions || []);
      } catch {
        if (!cancelled) setQuestions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [moduleId]);

  const answeredCount = useMemo(
    () => (questions || []).filter(q => !!answers[q.id]).length,
    [questions, answers],
  );
  const total = questions?.length ?? 0;
  const allAnswered = total > 0 && answeredCount === total;

  const handleStart = useCallback(() => {
    setAnswers({});
    setResult(null);
    setPhase('taking');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!questions || !allAnswered) return;
    setPhase('submitting');
    try {
      const payload = {
        answers: questions.map(q => ({ question_id: q.id, chosen_option: answers[q.id] })),
      };
      const { data } = await api.post(`/training/module/${moduleId}/quiz-attempts`, payload);
      const attempt: SubmittedAttempt = data.attempt;
      setResult(attempt);
      setPhase('result');
      onSubmitted?.(attempt);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Could not submit the quiz — please try again';
      toast({ title: msg, variant: 'destructive' });
      setPhase('taking');
    }
  }, [questions, allAnswered, answers, moduleId, onSubmitted, toast]);

  // No quiz on this module (or still fetching) → render nothing.
  if (!questions || questions.length === 0) return null;

  // ---- idle: the entry button --------------------------------------------
  if (phase === 'idle') {
    return (
      <div className="border-t pt-4" data-testid="quiz-panel-idle">
        <Button onClick={handleStart} data-testid="quiz-take-button">
          <ClipboardCheck className="w-4 h-4 mr-2" />
          {hasAttempts ? 'Retake Quiz' : 'Take Quiz'}
        </Button>
        <span className="ml-3 text-xs text-muted-foreground">
          {total} question{total === 1 ? '' : 's'} · self-check, not graded for certification
        </span>
      </div>
    );
  }

  // ---- result: score card ------------------------------------------------
  if (phase === 'result' && result) {
    const pct = result.max_score > 0 ? Math.round((result.score / result.max_score) * 100) : 0;
    return (
      <div className="border-t pt-4 space-y-3" data-testid="quiz-panel-result">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border font-medium ${scoreTone(pct)}`} data-testid="quiz-result-score">
          {pct >= 80 ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          Quiz result: {result.score} / {result.max_score} ({pct}%)
        </div>
        <p className="text-sm text-muted-foreground">
          {result.is_passed
            ? 'Perfect score — great work!'
            : 'This quiz is a self-check — your module still counts as complete. Review the content above and retake any time.'}
        </p>
        <Button variant="outline" size="sm" onClick={handleStart} data-testid="quiz-retake-button">
          <RotateCcw className="w-4 h-4 mr-2" /> Retake Quiz
        </Button>
      </div>
    );
  }

  // ---- taking / submitting: the quiz form --------------------------------
  const submitting = phase === 'submitting';
  return (
    <div className="border-t pt-4 space-y-5" data-testid="quiz-panel-taking">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-primary" /> Module Quiz
          </span>
          <span className="text-xs text-muted-foreground" data-testid="quiz-progress-text">
            {answeredCount} / {total} answered
          </span>
        </div>
        <Progress value={total > 0 ? (answeredCount / total) * 100 : 0} className="h-2" />
      </div>

      <ol className="space-y-5">
        {questions.map((q, qi) => (
          <li key={q.id} className="rounded-lg border bg-muted/20 p-4" data-testid={`quiz-question-${q.id}`}>
            <p className="text-sm font-medium mb-3">
              {qi + 1}. {q.question_text}
              {q.multi && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (select all that apply)
                </span>
              )}
            </p>
            {q.multi ? (
              <div className="space-y-2" data-testid={`quiz-multi-${q.id}`}>
                {q.options.map((opt, oi) => {
                  const optValue = String(oi + 1); // 1-indexed, matches DB correct_option
                  const inputId = `quiz-q${q.id}-opt${optValue}`;
                  const selected = (answers[q.id] || '').split(',').includes(optValue);
                  return (
                    <div key={optValue} className="flex items-center gap-2">
                      <Checkbox
                        id={inputId}
                        checked={selected}
                        disabled={submitting}
                        onCheckedChange={() =>
                          setAnswers(prev => ({ ...prev, [q.id]: toggleInSet(prev[q.id] || '', optValue) }))
                        }
                      />
                      <label htmlFor={inputId} className="text-sm cursor-pointer">
                        <span className="font-medium mr-1">{OPTION_LETTERS[oi] || oi + 1}.</span>
                        {opt}
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : (
              <RadioGroup
                value={answers[q.id] || ''}
                onValueChange={(val) => setAnswers(prev => ({ ...prev, [q.id]: val }))}
                disabled={submitting}
              >
                {q.options.map((opt, oi) => {
                  const optValue = String(oi + 1); // 1-indexed, matches DB correct_option
                  const inputId = `quiz-q${q.id}-opt${optValue}`;
                  return (
                    <div key={optValue} className="flex items-center gap-2">
                      <RadioGroupItem value={optValue} id={inputId} />
                      <label htmlFor={inputId} className="text-sm cursor-pointer">
                        <span className="font-medium mr-1">{OPTION_LETTERS[oi] || oi + 1}.</span>
                        {opt}
                      </label>
                    </div>
                  );
                })}
              </RadioGroup>
            )}
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3">
        <Button onClick={handleSubmit} disabled={!allAnswered || submitting} data-testid="quiz-submit-button">
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {submitting ? 'Submitting…' : 'Submit Quiz'}
        </Button>
        {!allAnswered && (
          <span className="text-xs text-muted-foreground">Answer all questions to submit</span>
        )}
        <Button variant="ghost" size="sm" onClick={() => setPhase('idle')} disabled={submitting} data-testid="quiz-cancel-button">
          Cancel
        </Button>
      </div>
    </div>
  );
};

export default ModuleQuizPanel;
