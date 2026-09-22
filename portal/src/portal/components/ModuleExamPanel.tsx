/**
 * ModuleExamPanel — the end-of-module SUMMATIVE exam, on the Training page.
 *
 * bd-60149. The portal previously had no concept of this: `source_quiz_id`
 * appeared nowhere in its routes, so an I-SAPS teacher could finish all 54
 * units here and never reach a summative assessment. WhatsApp offered it; the
 * portal did not.
 *
 * NOT the same thing as ModuleQuizPanel, and the difference matters:
 *
 *   ModuleQuizPanel  a UNIT's quick self-check. Non-blocking, retakeable,
 *                    MCQs only, marked instantly against a stored key.
 *   ModuleExamPanel  the MODULE's summative. 2 scenario MCQs + 1 written
 *                    answer (ISAPS §5.1), and passing it is what UNLOCKS THE
 *                    NEXT MODULE — so it is deliberately not something you can
 *                    dismiss.
 *
 * Two behaviours are operator decisions, not defaults:
 *
 *   BLOCKING      an unpassed exam locks the next module, mirroring WhatsApp,
 *                 so a teacher moving between surfaces sees one consistent
 *                 state. This panel renders the gate's own words rather than
 *                 inventing copy for it.
 *   BACKGROUND    the written answer is marked by an LLM against the ISAPS
 *                 scale, which takes ~10s. The submit returns as soon as the
 *                 answers are SAVED, and the panel then shows "being marked"
 *                 instead of holding a spinner over work that is already
 *                 durable. A slow or failing marker cannot cost a teacher the
 *                 answer she typed.
 *
 * The paper is drawn server-side and seeded on the attempt id, so reloading
 * this page re-derives the SAME questions rather than dealing a fresh hand.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GraduationCap, Loader2, CheckCircle2, XCircle, Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import QuestionPager from './QuestionPager';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';


/** What the gate (GET /training/modules → `exam`) tells us. */
export type ExamGate = {
  available: boolean;
  body: string;
  caption: string;
  cta: string;
  module_no: number | null;
};

type ExamQuestion = {
  id: number;
  index: number;
  question_text: string;
  options: string[];
  option_images: string[] | null;
  is_open_ended: boolean;
};

type Phase = 'idle' | 'loading' | 'taking' | 'submitting' | 'marking' | 'result';

type Result = {
  score: number | null;
  total: number | null;
  passed: boolean | null;
};

export default function ModuleExamPanel({
  courseId,
  exam,
  onPassed,
  onOpen,
  asListRow = false,
  autoStart = false,
}: {
  courseId: string;
  exam: ExamGate | null;
  /** Fired once the exam is PASSED, so the page can unlock what follows. */
  onPassed?: () => void;
  /**
   * bd-60152 — when given, tapping the list row NAVIGATES instead of opening
   * the paper in place. A sat exam with a written answer needs a page, not a
   * row in a sidebar.
   */
  onOpen?: () => void;
  /** Open the paper immediately — the exam PAGE has nothing else to show. */
  autoStart?: boolean;
  /**
   * Render the idle/locked states as a ROW inside the unit list rather than a
   * card beneath it — which is where a teacher actually looks for the exam
   * that follows a module's last unit. Once the paper is open the full panel
   * takes over regardless, because a list row cannot hold a textarea.
   */
  asListRow?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  // bd-60169 — autosave state. 'saved' is the last successful write; it is
  // shown quietly rather than announced, because a teacher mid-exam does not
  // need a running commentary, only the reassurance that she can leave.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [result, setResult] = useState<Result | null>(null);
  const { toast } = useToast();

  // A new module means a new paper.
  useEffect(() => {
    setPhase('idle'); setQuestions([]); setAttemptId(null);
    setAnswers({}); setResult(null);
  }, [courseId]);


  const start = useCallback(async () => {
    setPhase('loading');
    try {
      const { data } = await api.get(`/training/module/${courseId}/exam/questions`);
      setQuestions(data.questions || []);
      setAttemptId(data.attempt_id || null);

      // bd-60169 — an attempt can be RESUMED (openModuleExamAttempt returns
      // the existing in-progress row), so a returning teacher must see her own
      // answers rather than a blank paper. Restoring is best-effort: if it
      // fails she starts from what she can see, which is the old behaviour.
      if (data.attempt_id) {
        try {
          const { data: draft } = await api.get(
            `/training/module/${courseId}/exam/draft`,
            { params: { attempt_id: data.attempt_id } },
          );
          const restored: Record<number, string> = {};
          for (const a of draft?.answers || []) {
            const v = a.answer_text ?? a.chosen_option;
            if (v !== null && v !== undefined && String(v).length > 0) {
              restored[Number(a.question_id)] = String(v);
            }
          }
          if (Object.keys(restored).length > 0) {
            setAnswers(restored);
            setSaveState('saved');
          }
        } catch { /* best-effort: a blank paper is the old behaviour */ }
      }
      setPhase('taking');
    } catch (err: any) {
      // 409 means the gate refused — show its reason rather than a generic error.
      const msg = err?.response?.data?.error || 'Could not open the exam. Please try again.';
      toast({ title: 'Exam unavailable', description: msg, variant: 'destructive' });
      setPhase('idle');
    }
  }, [courseId, toast]);

  // bd-60152 — on the exam PAGE there is nothing to click first, so the paper
  // opens on mount. Declared after `start` deliberately: referencing a const
  // before its declaration only works because effects run post-render, which
  // is a fragile thing to rely on.
  useEffect(() => {
    if (autoStart && exam?.available && phase === 'idle') void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, exam?.available, courseId]);

  const answeredCount = questions.filter(q => (answers[q.id] || '').trim().length > 0).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  /**
   * bd-60169 — save one answer, debounced.
   *
   * Debounced per QUESTION rather than globally: typing a long written answer
   * must not delay the save of an MCQ she picked a moment ago. 800ms is long
   * enough that a sentence is not fifteen requests and short enough that
   * closing the tab mid-thought loses at most a clause.
   *
   * Never surfaces an error toast. A failed save is shown as a small
   * "Not saved" and retried on the next keystroke — the answer is still on
   * screen, so interrupting her over it would be the worse bug.
   */
  const saveDraft = useCallback((questionId: number, value: string) => {
    if (!attemptId) return;
    const q = questions.find(x => x.id === questionId);
    if (!q) return;
    const index = questions.findIndex(x => x.id === questionId);

    clearTimeout(saveTimers.current[questionId]);
    saveTimers.current[questionId] = setTimeout(async () => {
      setSaveState('saving');
      try {
        const { data } = await api.put(`/training/module/${courseId}/exam/draft`, {
          attempt_id: attemptId,
          question_id: questionId,
          question_index: index,
          chosen_option: q.is_open_ended ? null : value,
          answer_text: q.is_open_ended ? value : null,
        });
        setSaveState(data?.saved ? 'saved' : 'error');
      } catch {
        setSaveState('error');
      }
    }, 800);
  }, [attemptId, questions, courseId]);

  // Clear pending timers on unmount so a save cannot fire into a dead tree.
  useEffect(() => () => {
    Object.values(saveTimers.current).forEach(t => clearTimeout(t));
  }, []);

  const submit = useCallback(async () => {
    if (!attemptId || !allAnswered) return;
    setPhase('submitting');
    try {
      const payload = questions.map(q => (
        q.is_open_ended
          ? { question_id: q.id, answer_text: answers[q.id] }
          : { question_id: q.id, chosen_option: answers[q.id] }
      ));
      const { data } = await api.post(`/training/module/${courseId}/exam/attempts`, {
        attempt_id: attemptId, answers: payload,
      });
      if (data.crq_pending) {
        // Saved, not yet scored. The teacher is free to leave this page.
        setPhase('marking');
        setResult({ score: null, total: null, passed: null });
        return;
      }
      const a = data.attempt || {};
      setResult({ score: a.score ?? null, total: a.total_questions ?? null, passed: a.is_passed ?? null });
      setPhase('result');
      if (a.is_passed) onPassed?.();
    } catch {
      toast({
        title: 'Could not submit',
        description: 'Your answers were not saved. Please try again.',
        variant: 'destructive',
      });
      setPhase('taking');
    }
  }, [attemptId, allAnswered, questions, answers, courseId, toast, onPassed]);

  // No exam on this module (every non-I-SAPS vendor) — render nothing at all.
  if (!exam) return null;

  // Gate closed: say what the gate says, in its own words.
  if (!exam.available && phase === 'idle') {
    if (!exam.body?.trim()) return null;
    if (asListRow) {
      // bd-60166 — the ROW must say what the gate says, like the panel below
      // it already does. It used to hardcode a padlock and "Locked", which
      // was a lie in every closed state except one: a PASSED exam rendered
      // "🔒 Locked" while the server was saying "🏆 you passed this module".
      // The teacher is told she is blocked from something she has finished.
      //
      // `cta` is the gate's own short label ("✓ Passed", "🔒 Locked",
      // "⏳ Cooldown (3h)"), so the row carries the server's word for its own
      // state and cannot drift from it again.
      const passed = /passed/i.test(exam.cta || '') || /passed/i.test(exam.body || '');
      return (
        <div
          className={`w-full rounded-lg px-3.5 py-2.5 mb-0.5 flex items-center gap-3 ${passed ? '' : 'opacity-60'}`}
          data-testid={passed ? 'module-exam-passed' : 'module-exam-locked'}
        >
          {passed
            ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            : <Lock className="w-4 h-4 text-muted-foreground shrink-0" />}
          <span className={`flex-1 text-[15px] truncate ${passed ? 'text-foreground' : 'text-muted-foreground'}`}>
            Module exam
          </span>
          <span className={`text-sm shrink-0 ${passed ? 'text-green-700' : 'text-muted-foreground'}`}>
            {(exam.cta || '').replace(/^[^\w]+\s*/, '').trim() || 'Locked'}
          </span>
        </div>
      );
    }
    return (
      <div className="border-t pt-4" data-testid="module-exam-locked">
        <div className="flex items-start gap-3 rounded-md bg-muted/50 p-4">
          <GraduationCap className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-sm">
            <p className="whitespace-pre-line">{exam.body}</p>
            {exam.caption?.trim() && (
              <p className="text-muted-foreground mt-1">{exam.caption}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (asListRow && phase === 'idle') {
    return (
      <button
        type="button"
        onClick={onOpen || start}
        data-testid="module-exam-start"
        className="w-full text-left rounded-lg px-3.5 py-2.5 mb-0.5 flex items-center gap-3 transition-colors hover:bg-muted/50 ring-1 ring-primary/30 bg-primary/5"
      >
        <GraduationCap className="w-4 h-4 text-primary shrink-0" />
        <span className="flex-1 text-[15px] truncate font-semibold text-foreground">Module exam</span>
        <span className="text-sm text-primary shrink-0">{exam.cta?.trim() || 'Take the exam'}</span>
      </button>
    );
  }

  return (
    <div className={asListRow ? 'px-3.5 py-3' : 'border-t pt-4'} data-testid="module-exam-panel">
      {phase === 'idle' && (
        <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
          <GraduationCap className="h-5 w-5 mt-0.5 text-primary shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium">Module exam</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-line">{exam.body}</p>
            <Button className="mt-3" onClick={start} data-testid="module-exam-start">
              {exam.cta?.trim() || 'Take the exam'}
            </Button>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing your paper…
        </p>
      )}

      {(phase === 'taking' || phase === 'submitting') && (
        <div className="space-y-6" data-testid="module-exam-questions">
          <div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium">Module exam</span>
              <span className="text-muted-foreground">{answeredCount} of {questions.length} answered</span>
            </div>
            <Progress value={questions.length ? (answeredCount / questions.length) * 100 : 0} />
          </div>

          {/* bd-60168 — one shared renderer, and pagination where it helps.
              Both quiz surfaces used to own this markup and both produced the
              same hierarchy complaint. */}
          <QuestionPager
            questions={questions}
            answers={answers}
            onAnswer={(id, v) => {
              setAnswers(p => ({ ...p, [id]: v }));
              saveDraft(Number(id), v);
            }}
            disabled={phase === 'submitting'}
            footer={({ unanswered }) => (
              <div className="space-y-3">
                {/* Quiet, not announced: she needs to know she can leave, not
                    a running commentary on every keystroke. */}
                <p className="text-xs text-muted-foreground" data-testid="exam-save-state">
                  {saveState === 'saving' && 'Saving…'}
                  {saveState === 'saved' && 'Your answers are saved — you can close this and come back.'}
                  {saveState === 'error' && 'Not saved yet — we will try again as you type.'}
                </p>
                {unanswered.length > 0 && (
                  <p className="text-sm text-amber-700 dark:text-amber-500" data-testid="exam-unanswered">
                    {unanswered.length === 1
                      ? `Question ${unanswered[0]} still needs an answer before you can submit.`
                      : `Questions ${unanswered.join(', ')} still need answers before you can submit.`}
                  </p>
                )}
                <Button
                  onClick={submit}
                  disabled={!allAnswered || phase === 'submitting'}
                  data-testid="module-exam-submit"
                >
                  {phase === 'submitting'
                    ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>)
                    : 'Submit exam'}
                </Button>
              </div>
            )}
          />
        </div>
      )}

      {phase === 'marking' && (
        <div className="flex items-start gap-3 rounded-md bg-muted/50 p-4" data-testid="module-exam-marking">
          <Clock className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-sm">
            <p className="font-medium">Your answers are saved.</p>
            <p className="text-muted-foreground mt-1">
              The written answer is being marked — this takes a moment. You can leave this
              page; your score will be here when it is ready.
            </p>
          </div>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="flex items-start gap-3 rounded-md border p-4" data-testid="module-exam-result">
          {result.passed
            ? <CheckCircle2 className="h-5 w-5 mt-0.5 text-green-600 shrink-0" />
            : <XCircle className="h-5 w-5 mt-0.5 text-red-600 shrink-0" />}
          <div className="text-sm">
            <p className="font-medium">
              {result.passed ? 'Passed' : 'Not passed yet'}
              {result.score !== null && result.total !== null && (
                <span className="text-muted-foreground font-normal ml-2">
                  {result.score} / {result.total}
                </span>
              )}
            </p>
            {!result.passed && (
              <Button variant="outline" size="sm" className="mt-3" onClick={start}>
                Try again
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
