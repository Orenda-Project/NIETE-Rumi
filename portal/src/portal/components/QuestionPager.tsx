/**
 * QuestionPager — one question per page, when that helps.
 *
 * bd-60168. The operator asked for "1 question per page with the next and
 * previous button", then: "make sure these designs also work with other
 * trainings." Those two pull against each other, and the question bank says
 * why:
 *
 *   Taleemabad unit quiz      8-13 short MCQs
 *   I-SAPS / Beacon House     1-3 questions
 *   I-SAPS module exam        2 MCQs + one ~1,800-character CRQ
 *
 * Paginating a 13-question quick check turns one scroll into thirteen
 * page-turns, and Taleemabad is the largest vendor on the platform. So the
 * pager is CONDITIONAL: it pages when paging helps and steps aside when it
 * does not. `shouldPaginate` is exported so the decision is testable and is
 * made in one place rather than guessed at each call site.
 *
 * Navigation NEVER blocks. Pressing Next on an unanswered question advances;
 * the rail keeps showing it as unanswered and Submit stays disabled until
 * every question is answered, naming the ones outstanding. A teacher who is
 * stuck on question 2 can answer 3 and come back — blocking her is how an
 * exam gets abandoned.
 */

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import QuestionCard, { type QuestionShape } from './QuestionCard';

/** Page when questions are few, or when any one of them is long-form. */
export function shouldPaginate(questions: QuestionShape[]): boolean {
  const qs = Array.isArray(questions) ? questions : [];
  if (qs.length <= 1) return false;          // nothing to page between
  if (qs.some(q => q.is_open_ended === true)) return true;
  return qs.length <= 5;
}

export default function QuestionPager({
  questions,
  answers,
  onAnswer,
  disabled = false,
  footer,
}: {
  questions: QuestionShape[];
  /** question id -> chosen option ("1".."n") or written answer */
  answers: Record<string | number, string>;
  onAnswer: (questionId: string | number, value: string) => void;
  disabled?: boolean;
  /**
   * Submit and its own copy. Rendered under the pager on the LAST page, or
   * under the list when not paging, so a caller owns its submit rules.
   */
  footer?: (info: { onLastPage: boolean; unanswered: number[] }) => React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const paged = useMemo(() => shouldPaginate(questions), [questions]);

  const isAnswered = (q: QuestionShape) => (answers[q.id] || '').trim().length > 0;
  // 1-based positions, for copy a teacher can act on ("Question 2").
  const unanswered = questions.map((q, i) => (isAnswered(q) ? -1 : i + 1)).filter(n => n > 0);

  if (!paged) {
    return (
      <div className="space-y-7" data-testid="question-list">
        {questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            index={i}
            total={questions.length}
            value={answers[q.id] || ''}
            onChange={v => onAnswer(q.id, v)}
            disabled={disabled}
          />
        ))}
        {footer?.({ onLastPage: true, unanswered })}
      </div>
    );
  }

  const current = questions[Math.min(page, questions.length - 1)];
  const onLast = page >= questions.length - 1;

  return (
    <div className="space-y-5" data-testid="question-pager">
      {/* The rail. Named states rather than a bare percentage, so she can see
          WHICH question is missing and jump to it. */}
      <nav className="flex items-center gap-1.5" aria-label="Questions">
        {questions.map((q, i) => {
          const done = isAnswered(q);
          const here = i === page;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setPage(i)}
              aria-current={here ? 'step' : undefined}
              aria-label={`Question ${i + 1}${done ? ', answered' : ', not answered'}`}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                here ? 'bg-primary' : done ? 'bg-primary/40' : 'bg-muted'
              }`}
              data-testid={`pager-step-${i + 1}`}
            />
          );
        })}
      </nav>

      <QuestionCard
        key={current.id}
        question={current}
        index={page}
        total={questions.length}
        value={answers[current.id] || ''}
        onChange={v => onAnswer(current.id, v)}
        disabled={disabled}
      />

      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
          data-testid="pager-prev"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Previous
        </Button>

        <span className="text-xs text-muted-foreground" data-testid="pager-count">
          {questions.length - unanswered.length} of {questions.length} answered
        </span>

        {onLast ? (
          <span />
        ) : (
          // Never disabled: skipping forward is allowed and coming back is
          // how a stuck teacher finishes the paper.
          <Button
            type="button"
            onClick={() => setPage(p => Math.min(questions.length - 1, p + 1))}
            data-testid="pager-next"
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>

      {onLast && footer?.({ onLastPage: true, unanswered })}
    </div>
  );
}
