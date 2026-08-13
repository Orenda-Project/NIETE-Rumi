/**
 * CapstoneExamForm — the written level exam, taken in the portal.
 *
 * bd-2673. This component is the reason assessments were WhatsApp-only.
 *
 * WHAT WENT WRONG BEFORE
 * ----------------------
 * A capstone question has no options: the answer is prose, scored 0-5 by an LLM.
 * The portal rendered every exam through the MCQ path, so a Beacon House teacher
 * opening her level exam saw eight questions, no inputs, a counter stuck on 0/8
 * and a Submit button that could never enable. bd-2490 switched the whole
 * surface off rather than ship that.
 *
 * So the written exam gets its own form and its own endpoints
 * (/training/level/:id/capstone/{questions,attempts}) instead of a flag on the
 * multiple-choice ones.
 *
 * NUMBERS COME FROM THE SERVER
 * ----------------------------
 * `min_answer_chars`, `points_per_question` and `pass_mark_pct` are all sent by
 * the API. bd-2489 is the precedent: this card used to hardcode "70%", which was
 * right by coincidence and would have gone stale silently. A number the teacher
 * is held to must arrive from the thing that enforces it.
 *
 * The character floor is shown and counted live here, but the server checks it
 * again — a client-side counter is advice, not a rule.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PenLine, Loader2, CheckCircle2, XCircle, Award } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

type CapstoneQuestion = { id: number; question_text: string; order_index: number };

type CapstonePaper = {
  questions: CapstoneQuestion[];
  min_answer_chars: number;
  points_per_question: number;
  pass_mark_pct: number;
};

export type CapstoneResult = {
  attempt: {
    id: string;
    score: number;
    total_score: number;
    pass_bar: number;
    pass_mark_pct: number;
    is_passed: boolean;
    completed_at: string;
  };
  answers: {
    question_index: number;
    question_text: string;
    answer_text: string;
    answer_score: number;
    feedback_text: string;
  }[];
  certificate: { certificate_code: string; level_name: string; teacher_name: string } | null;
};

const CapstoneExamForm = ({
  levelId,
  levelName,
  onCertified,
}: {
  levelId: number;
  levelName: string;
  /** Called after a pass so the parent can refresh level states + certificates. */
  onCertified?: () => void;
}) => {
  const { toast } = useToast();

  const [paper, setPaper] = useState<CapstonePaper | null>(null);
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CapstoneResult | null>(null);

  useEffect(() => {
    setPaper(null);
    setAnswers({});
    setResult(null);
  }, [levelId]);

  const start = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/training/level/${levelId}/capstone/questions`);
      setPaper({
        questions: data.questions || [],
        min_answer_chars: data.min_answer_chars,
        points_per_question: data.points_per_question,
        pass_mark_pct: data.pass_mark_pct,
      });
      setAnswers({});
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Could not load the written exam';
      toast({ title: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [levelId, toast]);

  const floor = paper?.min_answer_chars ?? 0;

  // A question counts as answered only once it clears the floor — the same rule
  // the server applies, so Submit never enables on work the API will reject.
  const readyCount = useMemo(() => {
    if (!paper) return 0;
    return paper.questions.filter(q => (answers[q.id] || '').trim().length >= floor).length;
  }, [paper, answers, floor]);

  const total = paper?.questions.length ?? 0;
  const allReady = total > 0 && readyCount === total;

  const submit = useCallback(async () => {
    if (!paper || !allReady) return;
    setSubmitting(true);
    try {
      const payload = {
        answers: paper.questions.map(q => ({ question_id: q.id, answer_text: answers[q.id] })),
      };
      const { data } = await api.post(`/training/level/${levelId}/capstone/attempts`, payload);
      setResult({ attempt: data.attempt, answers: data.answers || [], certificate: data.certificate || null });
      setPaper(null);
      if (data.attempt?.is_passed && onCertified) onCertified();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Could not submit the written exam';
      toast({ title: msg, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }, [paper, allReady, answers, levelId, onCertified, toast]);

  // ---- result -------------------------------------------------------------
  if (result) {
    const a = result.attempt;
    return (
      <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3" data-testid="capstone-result">
        <div
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border font-medium ${
            a.is_passed
              ? 'text-green-700 bg-green-50 border-green-200'
              : 'text-amber-700 bg-amber-50 border-amber-200'
          }`}
        >
          {a.is_passed ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          {a.is_passed ? 'Written exam passed' : 'Written exam not passed'} — {a.score} / {a.total_score}
        </div>
        <p className="text-sm text-muted-foreground">
          The pass mark is {a.pass_bar} out of {a.total_score} ({a.pass_mark_pct}%).
        </p>

        {result.certificate && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900" data-testid="capstone-certificate">
            <div className="flex items-center gap-2 font-medium">
              <Award className="w-4 h-4" /> Your {result.certificate.level_name} certificate is earned
            </div>
            <div className="mt-1">
              Certificate{' '}
              <span className="font-mono text-xs bg-white border border-green-300 rounded px-2 py-0.5">
                {result.certificate.certificate_code}
              </span>{' '}
              — download it from My certificates above.
            </div>
          </div>
        )}

        <div className="space-y-3 border-t pt-3">
          {result.answers.map(ans => (
            <div key={ans.question_index} className="text-sm">
              <div className="font-medium">{ans.question_text}</div>
              <div className="text-muted-foreground mt-1 whitespace-pre-wrap">{ans.answer_text}</div>
              <div className="mt-1 text-xs">
                <span className="font-medium">Score {ans.answer_score}</span>
                {ans.feedback_text && <span className="text-muted-foreground"> — {ans.feedback_text}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- entry --------------------------------------------------------------
  if (!paper) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm" data-testid="capstone-entry">
        <div className="flex items-center gap-2 font-medium">
          <PenLine className="w-5 h-5 text-primary" /> {levelName} — written exam
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          This level finishes with written answers rather than multiple choice. Each answer is read and
          scored, so give yourself time — you cannot save a draft partway through.
        </p>
        <Button onClick={start} disabled={loading} className="mt-3" data-testid="capstone-start">
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PenLine className="w-4 h-4 mr-2" />}
          Start the written exam
        </Button>
      </div>
    );
  }

  // ---- taking -------------------------------------------------------------
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm space-y-4" data-testid="capstone-form">
      <div>
        <div className="flex items-center gap-2 font-medium">
          <PenLine className="w-5 h-5 text-primary" /> {levelName} — written exam
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {total} question{total === 1 ? '' : 's'}, each worth {paper.points_per_question} points. You need{' '}
          {paper.pass_mark_pct}% to pass, and at least {floor} characters per answer.
        </p>
        <div className="mt-3">
          <Progress value={total > 0 ? (readyCount / total) * 100 : 0} />
          <div className="text-xs text-muted-foreground mt-1" data-testid="capstone-progress">
            {readyCount} of {total} ready to submit
          </div>
        </div>
      </div>

      {paper.questions.map((q, i) => {
        const text = answers[q.id] || '';
        const len = text.trim().length;
        const short = len < floor;
        return (
          <div key={q.id} className="border-t pt-3">
            <label className="block font-medium text-sm" htmlFor={`capstone-q-${q.id}`}>
              {i + 1}. {q.question_text}
            </label>
            <textarea
              id={`capstone-q-${q.id}`}
              data-testid={`capstone-answer-${q.id}`}
              className="mt-2 w-full min-h-[160px] rounded-md border bg-background p-3 text-sm"
              value={text}
              onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
              placeholder="Write your answer here, with examples from your own classroom."
            />
            <div
              className={`text-xs mt-1 ${short ? 'text-amber-700' : 'text-green-700'}`}
              data-testid={`capstone-count-${q.id}`}
            >
              {short ? `${len} / ${floor} characters — ${floor - len} more to go` : `${len} characters`}
            </div>
          </div>
        );
      })}

      <div className="border-t pt-3">
        <Button onClick={submit} disabled={!allReady || submitting} data-testid="capstone-submit">
          {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Submit written exam
        </Button>
        {!allReady && (
          <p className="text-xs text-muted-foreground mt-2">
            Every answer needs at least {floor} characters before you can submit.
          </p>
        )}
        {submitting && (
          <p className="text-xs text-muted-foreground mt-2">
            Your answers are being read and scored — this takes a few moments.
          </p>
        )}
      </div>
    </div>
  );
};

export default CapstoneExamForm;
