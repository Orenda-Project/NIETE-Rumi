/**
 * CapstoneResultCard — bd-2233.
 *
 * Read-only view of the teacher's Beacon House capstone ("Grand Quiz")
 * attempt for a level: total score against the pass bar, and each written
 * answer with its 0–5 score and LLM feedback line. The capstone itself is
 * taken on WhatsApp; this panel mirrors the record on the portal. Renders
 * nothing when the teacher has no attempt.
 */

import { useState, useEffect } from 'react';
import { PenLine, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../services/api';

type CapstoneAnswer = {
  question_index: number;
  question_text: string;
  answer_text: string;
  answer_score: number | null;
  feedback_text: string;
};

type CapstoneAttempt = {
  id: string;
  status: string;
  is_passed: boolean;
  score: number;
  total_score: number;
  completed_at: string | null;
};

const CapstoneResultCard = ({ levelId, levelName }: { levelId: number; levelName: string }) => {
  const [attempt, setAttempt] = useState<CapstoneAttempt | null>(null);
  const [answers, setAnswers] = useState<CapstoneAnswer[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAttempt(null);
    setAnswers([]);
    (async () => {
      try {
        const { data } = await api.get(`/training/level/${levelId}/capstone`);
        if (!cancelled && data.attempt) {
          setAttempt(data.attempt);
          setAnswers(data.answers || []);
        }
      } catch {
        /* no capstone record — panel stays hidden */
      }
    })();
    return () => { cancelled = true; };
  }, [levelId]);

  if (!attempt) return null;

  const pct = attempt.total_score > 0 ? Math.round((attempt.score / attempt.total_score) * 100) : 0;
  const tone = attempt.is_passed
    ? 'text-green-700 bg-green-50 border-green-200'
    : 'text-amber-700 bg-amber-50 border-amber-200';

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm mb-6" data-testid="capstone-result-card">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold flex items-center gap-2">
          <PenLine className="w-4 h-4 text-primary" /> {levelName} Grand Quiz (written)
        </span>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md border text-sm font-medium ${tone}`}>
          {attempt.is_passed ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {attempt.score} / {attempt.total_score} ({pct}%)
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {attempt.is_passed
          ? 'Passed — this quiz counts toward your certificate.'
          : attempt.status === 'in_progress'
            ? 'In progress on WhatsApp — finish it there to be scored.'
            : 'Below the 70% pass mark — review the feedback below and retake it on WhatsApp.'}
      </p>

      {answers.length > 0 && (
        <>
          <button
            type="button"
            className="mt-3 text-xs font-medium text-primary flex items-center gap-1"
            onClick={() => setOpen(o => !o)}
            data-testid="capstone-toggle-answers"
          >
            {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {open ? 'Hide' : 'Show'} your answers &amp; feedback ({answers.length})
          </button>
          {open && (
            <ol className="mt-3 space-y-3">
              {answers.map(a => (
                <li key={a.question_index} className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs font-medium">{a.question_index + 1}. {a.question_text}</p>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{a.answer_text}</p>
                  <p className="text-xs mt-2 text-muted-foreground">
                    <span className="font-semibold">{a.answer_score ?? '—'}/5</span>
                    {a.feedback_text ? ` — ${a.feedback_text}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
};

export default CapstoneResultCard;
