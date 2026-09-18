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

import { useState, useEffect, useCallback } from 'react';
import { GraduationCap, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

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
}: {
  courseId: string;
  exam: ExamGate | null;
  /** Fired once the exam is PASSED, so the page can unlock what follows. */
  onPassed?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
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
      setPhase('taking');
    } catch (err: any) {
      // 409 means the gate refused — show its reason rather than a generic error.
      const msg = err?.response?.data?.error || 'Could not open the exam. Please try again.';
      toast({ title: 'Exam unavailable', description: msg, variant: 'destructive' });
      setPhase('idle');
    }
  }, [courseId, toast]);

  const answeredCount = questions.filter(q => (answers[q.id] || '').trim().length > 0).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

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

  return (
    <div className="border-t pt-4" data-testid="module-exam-panel">
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

          {questions.map((q, i) => (
            <div key={q.id} className="space-y-2">
              <p className="text-sm font-medium whitespace-pre-line">
                {i + 1}. {q.question_text}
              </p>

              {q.is_open_ended ? (
                <>
                  <Textarea
                    rows={8}
                    placeholder="Write your response here…"
                    value={answers[q.id] || ''}
                    onChange={e => setAnswers(p => ({ ...p, [q.id]: e.target.value }))}
                    data-testid={`exam-answer-${q.id}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Written answer — marked against the I-SAPS rubric. Take your time.
                  </p>
                </>
              ) : (
                <RadioGroup
                  value={answers[q.id] || ''}
                  onValueChange={v => setAnswers(p => ({ ...p, [q.id]: v }))}
                >
                  {(q.options || []).map((opt, idx) => {
                    const value = String(idx + 1);
                    return (
                      <label
                        key={value}
                        className="flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer hover:bg-muted/50"
                      >
                        <RadioGroupItem value={value} id={`q${q.id}-${value}`} className="mt-0.5" />
                        <span>
                          <span className="font-medium mr-2">{OPTION_LETTERS[idx]}.</span>
                          {opt}
                        </span>
                      </label>
                    );
                  })}
                </RadioGroup>
              )}
            </div>
          ))}

          <Button
            onClick={submit}
            disabled={!allAnswered || phase === 'submitting'}
            data-testid="module-exam-submit"
          >
            {phase === 'submitting'
              ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</>)
              : 'Submit exam'}
          </Button>
          {!allAnswered && (
            <p className="text-xs text-muted-foreground">Answer every question before submitting.</p>
          )}
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
