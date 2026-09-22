/**
 * QuestionCard — ONE question, rendered the same way everywhere.
 *
 * bd-60168. Both quiz surfaces built their own question markup and both
 * produced the same complaint: "its all same font same color, distinguishing
 * Question number from the question statement a bit difficult". The number and
 * the statement were one run of `text-sm font-medium` — `{i + 1}. {text}` — so
 * the number read as the first word of the sentence.
 *
 * Position and statement are DIFFERENT KINDS OF INFORMATION, so they differ in
 * size, weight, colour, case and shape: a small uppercase tracked pill for
 * "QUESTION 1 OF 3", a 19-21px near-black statement below it.
 *
 * FOUR ANSWER SHAPES, because the question bank really has four (audited
 * 2026-09-22 over 2,730 active questions):
 *
 *   4-option MCQ        2,613   the common case
 *   open-ended / CRQ       70   textarea, rubric-marked
 *   5-option MCQ           40   letters run to E; the array goes to J
 *   MULTI-SELECT           26   checkboxes; Oxbridge only, zero in I-SAPS
 *   image options           1   options ARE pictures (q6264), 2x2 grid
 *
 * The multi-select one is worth recording HOW it was found: a first audit over
 * `options` alone concluded there was no multi-select, because the signal is
 * not in `options` at all — the portal derives it from `correct_option`
 * holding several keys ("1,3,5"). Auditing one column and declaring a type
 * absent is how a vendor's 26 questions get silently turned into radios.
 *
 * There is no true/false, matching or fill-in-the-blank, and `question_urdu`
 * is populated zero times — so no RTL path is built here. Add one when a row
 * actually needs it, not before.
 *
 * SENTENCE-COMPLETION items are not a fifth type but they LOOK broken under a
 * design that treats each option as a standalone sentence: the stem ends
 * mid-clause and the options continue it in lowercase ("…leads to" / "poor
 * performance."). They are detected and rendered without the leading capital
 * expectation, so they read as the continuation they are.
 */

import { CheckCircle2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export type QuestionShape = {
  id: number | string;
  question_text: string;
  options?: string[] | null;
  option_images?: string[] | null;
  is_open_ended?: boolean;
  /** bd-2138 — several options are correct; renders checkboxes. Oxbridge. */
  multi?: boolean;
};

/** Multi-select answers travel as a comma-joined list of 1-based keys. */
function toggleInSet(current: string, value: string): string {
  const set = new Set((current || '').split(',').map(x => x.trim()).filter(Boolean));
  if (set.has(value)) set.delete(value); else set.add(value);
  return [...set].sort((a, b) => Number(a) - Number(b)).join(',');
}

/**
 * Does this item's stem run INTO its options?
 *
 * A sentence-completion stem has no terminal punctuation and its options start
 * lowercase. Both signals are required: a question ending in "?" with a
 * lowercase option is just an option that happens to start lowercase.
 */
export function isSentenceCompletion(q: QuestionShape): boolean {
  const opts = Array.isArray(q.options) ? q.options.filter(Boolean) : [];
  if (opts.length === 0) return false;
  const stem = (q.question_text || '').trim();
  if (/[.?!:]$/.test(stem)) return false;
  const lower = opts.filter(o => typeof o === 'string' && /^[a-z]/.test(o.trim()));
  return lower.length >= Math.ceil(opts.length / 2);
}

export default function QuestionCard({
  question,
  index,
  total,
  value,
  onChange,
  disabled = false,
  showPosition = true,
}: {
  question: QuestionShape;
  /** 0-based position, for "QUESTION n OF m". */
  index: number;
  total: number;
  /** The chosen option as a 1-based string, or the written answer. */
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Off when a caller renders its own heading (a single-question page). */
  showPosition?: boolean;
}) {
  const images = Array.isArray(question.option_images)
    ? question.option_images.filter(Boolean)
    : [];
  const opts = Array.isArray(question.options) ? question.options.filter(Boolean) : [];
  const openEnded = question.is_open_ended === true || (opts.length === 0 && images.length === 0);
  const completion = isSentenceCompletion(question);
  const answered = (value || '').trim().length > 0;

  return (
    <div className="space-y-3" data-testid={`question-card-${question.id}`}>
      {showPosition && (
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary"
            data-testid="question-position"
          >
            Question {index + 1} of {total}
          </span>
          {answered && (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-label="Answered" />
          )}
        </div>
      )}

      {/* The statement. Deliberately larger and heavier than anything around
          it — this is the thing being asked. */}
      <p
        className="text-[19px] sm:text-[21px] font-medium leading-snug text-foreground whitespace-pre-line"
        data-testid="question-statement"
      >
        {question.question_text}
      </p>

      {openEnded && (
        <div className="space-y-1.5">
          <Textarea
            rows={10}
            placeholder="Write your response here…"
            value={value}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
            className="text-[15px] leading-relaxed"
            data-testid={`answer-${question.id}`}
            aria-label={`Answer for question ${index + 1}`}
          />
          <p className="text-xs text-muted-foreground">
            Written answer — marked against the rubric. Take your time.
          </p>
        </div>
      )}

      {/* IMAGE OPTIONS — the options are pictures, so they need to be big
          enough to compare. Two across on a phone is the most that stays
          legible; the letter stays because the answer is still "A". */}
      {!openEnded && images.length > 0 && (
        <fieldset className="border-0 p-0 m-0">
          <legend className="sr-only">{question.question_text}</legend>
          <div className="grid grid-cols-2 gap-3">
            {images.map((src, i) => {
              const v = String(i + 1);
              const on = value === v;
              return (
                <label
                  key={v}
                  className={`relative block cursor-pointer rounded-lg border-2 overflow-hidden transition-colors ${
                    on ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name={`q-${question.id}`}
                    value={v}
                    checked={on}
                    disabled={disabled}
                    onChange={() => onChange(v)}
                    className="sr-only"
                  />
                  <span className="absolute top-2 left-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-xs font-semibold shadow-sm">
                    {OPTION_LETTERS[i] || i + 1}
                  </span>
                  <img
                    src={src}
                    alt={`Option ${OPTION_LETTERS[i] || i + 1}`}
                    className="w-full h-auto block bg-muted"
                    loading="lazy"
                  />
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* MULTI-SELECT — checkboxes, and the instruction said out loud. A
          teacher shown radios for a "select all" question cannot answer it. */}
      {!openEnded && images.length === 0 && opts.length > 0 && question.multi === true && (
        <fieldset className="border-0 p-0 m-0" data-testid={`multi-${question.id}`}>
          <legend className="text-xs text-muted-foreground mb-2">Select all that apply</legend>
          <div className="space-y-2">
            {opts.map((opt, i) => {
              const v = String(i + 1);
              const on = (value || '').split(',').map(x => x.trim()).includes(v);
              return (
                <label
                  key={v}
                  className={`flex items-start gap-3 rounded-lg border p-3.5 cursor-pointer transition-colors ${
                    on ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    name={`q-${question.id}`}
                    value={v}
                    checked={on}
                    disabled={disabled}
                    onChange={() => onChange(toggleInSet(value, v))}
                    className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                  />
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className={`text-[13px] font-semibold shrink-0 ${on ? 'text-primary' : 'text-muted-foreground'}`}>
                      {OPTION_LETTERS[i] || i + 1}
                    </span>
                    <span className="text-[15px] leading-snug">{opt}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* TEXT OPTIONS — single choice. */}
      {!openEnded && images.length === 0 && opts.length > 0 && question.multi !== true && (
        <fieldset className="border-0 p-0 m-0">
          <legend className="sr-only">{question.question_text}</legend>
          <div className="space-y-2">
            {opts.map((opt, i) => {
              const v = String(i + 1);
              const on = value === v;
              return (
                <label
                  key={v}
                  className={`flex items-start gap-3 rounded-lg border p-3.5 cursor-pointer transition-colors ${
                    on ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="radio"
                    name={`q-${question.id}`}
                    value={v}
                    checked={on}
                    disabled={disabled}
                    onChange={() => onChange(v)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                  />
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className={`text-[13px] font-semibold shrink-0 ${on ? 'text-primary' : 'text-muted-foreground'}`}>
                      {OPTION_LETTERS[i] || i + 1}
                    </span>
                    {/* A completion option continues the stem, so it is not
                        capitalised and must not be styled as its own sentence. */}
                    <span className={`text-[15px] leading-snug ${completion ? 'italic' : ''}`}>
                      {opt}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
