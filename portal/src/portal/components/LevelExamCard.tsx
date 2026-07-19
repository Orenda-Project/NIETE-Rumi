/**
 * LevelExamCard — the grand-quiz (level exam) surface on the Training page.
 *
 * Self-contained: given a selected level, it fetches the teacher's exam gate
 * from GET /training/level/:id/grand-quiz and renders one of:
 *
 *   no_quiz             nothing (level has no configured exam)
 *   courses_incomplete  locked card — "finish all courses first" + progress
 *   cooldown            locked card — retry time after a failed attempt
 *   passed              certified card — certificate code + issue date
 *   ready               "Take Level Exam" CTA → full exam form → result
 *
 * All gating is enforced server-side; this component only mirrors the state
 * for honest copy. Submitting posts the complete answer set to
 * POST /training/level/:id/grand-quiz/attempts which grades with the same
 * semantics as the WhatsApp bot (100% pass bar, 24h cooldown on fail,
 * certificate on pass).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Award, ClipboardCheck, Lock, Loader2, Timer, Trophy, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

type GrandQuizState = 'no_quiz' | 'passed' | 'cooldown' | 'courses_incomplete' | 'ready';

type Certificate = {
  certificate_code: string;
  teacher_name: string;
  level_name: string;
  issued_at: string;
};

type GrandQuizGate = {
  state: GrandQuizState;
  question_count: number;
  pass_mark_pct: number;
  cooldown_hours: number;
  cooldown_until: string | null;
  courses_total: number;
  courses_started: number;
  passed_at: string | null;
  certificate: Certificate | null;
};

// Option entries arrive as JSONB — historically either plain strings or
// { key, text, urdu } objects. Render defensively.
type ExamOption = string | { key?: string; text?: string; urdu?: string };
type ExamQuestion = {
  id: number;
  question_text: string;
  question_urdu: string | null;
  options: ExamOption[];
  order_index: number;
};

type SubmitResult = {
  attempt: {
    id: string;
    score: number;
    max_score: number;
    is_passed: boolean;
    status: 'passed' | 'failed';
    cooldown_until: string | null;
    completed_at: string;
  };
  certificate: Certificate | null;
};

function optionLabel(o: ExamOption): string {
  if (typeof o === 'string') return o;
  return o?.text ?? o?.key ?? '';
}

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric',
  });
}

function hoursLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
}

const LevelExamCard = ({
  levelId,
  levelName,
  levelOrderIndex,
  onCertified,
}: {
  levelId: number;
  levelName: string;
  levelOrderIndex: number;
  onCertified?: () => void;
}) => {
  const { toast } = useToast();

  const [gate, setGate] = useState<GrandQuizGate | null>(null);
  const [loadingGate, setLoadingGate] = useState(true);

  // Exam-taking state
  const [questions, setQuestions] = useState<ExamQuestion[] | null>(null);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({}); // question_id → chosen_option ('1'-based)
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const loadGate = useCallback(async () => {
    setLoadingGate(true);
    try {
      const { data } = await api.get(`/training/level/${levelId}/grand-quiz`);
      setGate(data.grand_quiz || null);
    } catch {
      // Chain-locked levels 403 here; the picker already greys those out, so
      // any failure just hides the card rather than toasting.
      setGate(null);
    } finally {
      setLoadingGate(false);
    }
  }, [levelId]);

  // Reset everything when the selected level changes.
  useEffect(() => {
    setQuestions(null);
    setAnswers({});
    setResult(null);
    loadGate();
  }, [loadGate]);

  const startExam = useCallback(async () => {
    setLoadingQuestions(true);
    try {
      const { data } = await api.get(`/training/level/${levelId}/grand-quiz/questions`);
      setQuestions(data.questions || []);
      setAnswers({});
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Could not load the exam';
      toast({ title: msg, variant: 'destructive' });
      loadGate(); // eligibility may have changed (e.g. cooldown started on WhatsApp)
    } finally {
      setLoadingQuestions(false);
    }
  }, [levelId, toast, loadGate]);

  const submitExam = useCallback(async () => {
    if (!questions) return;
    setSubmitting(true);
    try {
      const payload = {
        answers: questions.map(q => ({ question_id: q.id, chosen_option: answers[q.id] })),
      };
      const { data } = await api.post(`/training/level/${levelId}/grand-quiz/attempts`, payload);
      setResult({ attempt: data.attempt, certificate: data.certificate || null });
      setQuestions(null);
      if (data.attempt?.is_passed && onCertified) onCertified();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Could not submit the exam';
      toast({ title: msg, variant: 'destructive' });
      loadGate(); // e.g. cooldown/already-passed raced in from the other surface
      setQuestions(null);
    } finally {
      setSubmitting(false);
    }
  }, [questions, answers, levelId, onCertified, toast, loadGate]);

  if (loadingGate) {
    return (
      <div className="rounded-lg border bg-card p-4 shadow-sm flex items-center gap-2 text-sm text-muted-foreground" data-testid="level-exam-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking level exam…
      </div>
    );
  }
  if (!gate || gate.state === 'no_quiz') return null;

  // ── Result screen (after a submit this session) ──────────────────────────
  if (result) {
    const { attempt, certificate } = result;
    if (attempt.is_passed) {
      return (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 shadow-sm" data-testid="level-exam-result-pass">
          <div className="flex items-center gap-2 text-green-800 font-semibold text-lg mb-2">
            <Trophy className="w-6 h-6" /> Level exam passed!
          </div>
          <p className="text-sm text-green-900 mb-3">
            {attempt.score}/{attempt.max_score} — a perfect score on the {levelName} exam.
            {certificate ? ' Your certificate has been issued.' : ''}
          </p>
          {certificate && (
            <div className="rounded-md border border-green-300 bg-white p-4 text-sm" data-testid="level-exam-certificate">
              <div className="flex items-center gap-2 font-medium mb-1">
                <Award className="w-4 h-4 text-green-700" /> Certificate — {certificate.level_name}
              </div>
              <div className="text-muted-foreground">Issued to {certificate.teacher_name}</div>
              <div className="mt-1 font-mono text-xs bg-muted rounded px-2 py-1 inline-block">
                {certificate.certificate_code}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            The next level is now unlocked in the level picker above.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm" data-testid="level-exam-result-fail">
        <div className="flex items-center gap-2 text-red-800 font-semibold text-lg mb-2">
          <XCircle className="w-6 h-6" /> Not this time
        </div>
        <p className="text-sm text-red-900 mb-2">
          You scored {attempt.score}/{attempt.max_score}. This exam requires 100%.
        </p>
        <p className="text-sm text-red-900 flex items-center gap-1.5">
          <Timer className="w-4 h-4" />
          Try again in about {hoursLeft(attempt.cooldown_until)} hours
          {attempt.cooldown_until ? ` (${formatWhen(attempt.cooldown_until)})` : ''}. Use the time to review the modules you struggled with.
        </p>
      </div>
    );
  }

  // ── Exam form ────────────────────────────────────────────────────────────
  if (questions) {
    const answered = questions.filter(q => answers[q.id]).length;
    const allAnswered = answered === questions.length;
    return (
      <div className="rounded-lg border bg-card p-6 shadow-sm" data-testid="level-exam-form">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            Level {levelOrderIndex + 1} Exam · {levelName}
          </h3>
          <span className="text-sm text-muted-foreground">{answered}/{questions.length} answered</span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          100% required to pass · {gate.cooldown_hours}h cooldown on a failed attempt. Leaving this page discards your answers (no penalty).
        </p>
        <div className="space-y-6">
          {questions.map((q, qi) => (
            <fieldset key={q.id} data-testid={`exam-question-${q.id}`}>
              <legend className="text-sm font-medium mb-2">
                Q{qi + 1}. {q.question_text}
                {q.question_urdu && (
                  <span dir="rtl" className="block text-muted-foreground mt-0.5">{q.question_urdu}</span>
                )}
              </legend>
              <div className="space-y-1.5">
                {q.options.map((o, oi) => {
                  const value = String(oi + 1); // 1-based option index — same payload as the WhatsApp buttons
                  const checked = answers[q.id] === value;
                  return (
                    <label
                      key={oi}
                      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                        checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`exam-q-${q.id}`}
                        value={value}
                        checked={checked}
                        onChange={() => setAnswers(prev => ({ ...prev, [q.id]: value }))}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium mr-1.5">{String.fromCharCode(65 + oi)}.</span>
                        {optionLabel(o)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-6 flex items-center gap-3">
          <Button onClick={submitExam} disabled={!allAnswered || submitting} data-testid="exam-submit">
            {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Submit exam
          </Button>
          {!allAnswered && (
            <span className="text-xs text-muted-foreground">Answer all questions to submit.</span>
          )}
        </div>
      </div>
    );
  }

  // ── Gate cards ───────────────────────────────────────────────────────────
  if (gate.state === 'passed') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 shadow-sm" data-testid="level-exam-passed">
        <div className="flex items-center gap-2 text-green-800 font-medium">
          <Award className="w-5 h-5" /> Level exam passed
          {gate.passed_at && <span className="text-xs font-normal text-green-700">· {formatWhen(gate.passed_at)}</span>}
        </div>
        {gate.certificate && (
          <div className="mt-2 text-sm text-green-900">
            Certificate <span className="font-mono text-xs bg-white border border-green-300 rounded px-2 py-0.5">{gate.certificate.certificate_code}</span>
            <span className="text-muted-foreground"> · issued to {gate.certificate.teacher_name}</span>
          </div>
        )}
      </div>
    );
  }

  if (gate.state === 'cooldown') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm" data-testid="level-exam-cooldown">
        <div className="flex items-center gap-2 text-amber-800 font-medium">
          <Timer className="w-5 h-5" /> Exam locked after a recent attempt
        </div>
        <p className="text-sm text-amber-900 mt-1">
          You can try again in about {hoursLeft(gate.cooldown_until)} hours
          {gate.cooldown_until ? ` (${formatWhen(gate.cooldown_until)})` : ''}.
        </p>
      </div>
    );
  }

  if (gate.state === 'courses_incomplete') {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 shadow-sm" data-testid="level-exam-locked">
        <div className="flex items-center gap-2 text-muted-foreground font-medium">
          <Lock className="w-5 h-5" /> Level exam — locked
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Unlocks when all courses in this level are complete
          ({gate.courses_started}/{gate.courses_total} courses started so far).
        </p>
      </div>
    );
  }

  // ready
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm" data-testid="level-exam-ready">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <ClipboardCheck className="w-5 h-5 text-primary" /> Level exam — ready
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {gate.question_count} questions · 100% required to pass · {gate.cooldown_hours}h cooldown on a failed attempt.
          </p>
        </div>
        <Button onClick={startExam} disabled={loadingQuestions} data-testid="exam-start">
          {loadingQuestions && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Take Level Exam
        </Button>
      </div>
    </div>
  );
};

export default LevelExamCard;
