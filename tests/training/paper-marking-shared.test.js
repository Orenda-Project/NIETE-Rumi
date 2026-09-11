/**
 * bd-2673 — the marking rule is written ONCE, in the bot, and both surfaces
 * use it.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * Before this, "which answer is correct" existed in three places:
 *
 *   bot/shared/services/training/quiz-delivery.service.js  isMultiKey/normalizeSet + gradeAttempt
 *   dashboard/routes/portal.routes.js:2748-2771            module-quiz copy
 *   dashboard/routes/portal.routes.js:3306-3327            grand-quiz copy
 *
 * They agreed by coincidence, not by construction. The header of
 * dashboard/services/training-rules.service.js lists four rules that drifted
 * exactly this way — two of them AFTER the fix was announced as shipped. The
 * portal's own comments claimed "identical comparator to the WhatsApp writer",
 * which is the tell: a comment is not a mechanism.
 *
 * So marking moves into one pure module that neither surface may fork. This
 * suite pins the behaviour that module owes both callers.
 */

const {
  isMultiKey,
  normalizeAnswerKey,
  markPaper,
} = require('../../bot/shared/services/training/paper-marking.service');

function q(id, correct, orderIndex) {
  return { id, correct_option: correct, order_index: orderIndex };
}

describe('bd-2673 — shared marking rule', () => {
  describe('multi-answer detection', () => {
    it('treats a comma-joined key as multi and a bare key as single', () => {
      expect(isMultiKey('1,3')).toBe(true);
      expect(isMultiKey('2')).toBe(false);
      expect(isMultiKey('')).toBe(false);
      expect(isMultiKey(null)).toBe(false);
    });
  });

  describe('answer-set normalisation (bd-2138)', () => {
    it('makes order and whitespace irrelevant for multi keys', () => {
      expect(normalizeAnswerKey('3,1')).toBe('1,3');
      expect(normalizeAnswerKey(' 1 , 3 ')).toBe('1,3');
      expect(normalizeAnswerKey('1,3')).toBe('1,3');
    });

    it('accepts an array, matching the legacy `answers` shape', () => {
      expect(normalizeAnswerKey([3, 1])).toBe('1,3');
    });

    it('de-duplicates repeated selections', () => {
      expect(normalizeAnswerKey('1,1,3')).toBe('1,3');
    });
  });

  describe('markPaper — the verdict both surfaces receive', () => {
    it('marks a single-answer question by trimmed string equality', () => {
      const out = markPaper({
        questions: [q('qa', '2', 0)],
        answers: [{ question_id: 'qa', chosen_option: ' 2 ' }],
      });
      expect(out.graded[0].is_correct).toBe(true);
      expect(out.score).toBe(1);
      expect(out.total_questions).toBe(1);
    });

    it('marks a multi-answer question by SET equality, not string equality', () => {
      const out = markPaper({
        questions: [q('qm', '1,3', 0)],
        answers: [{ question_id: 'qm', chosen_option: '3,1' }],
      });
      expect(out.graded[0].is_correct).toBe(true);
      // and the stored value is normalised, so the row is comparable later
      expect(out.graded[0].chosen_option).toBe('1,3');
    });

    it('fails a multi-answer subset — partial credit is not a thing here', () => {
      const out = markPaper({
        questions: [q('qm', '1,3', 0)],
        answers: [{ question_id: 'qm', chosen_option: '1' }],
      });
      expect(out.graded[0].is_correct).toBe(false);
      expect(out.score).toBe(0);
    });

    it('counts an empty answer as wrong rather than accidentally correct', () => {
      const out = markPaper({
        questions: [q('qa', '2', 0)],
        answers: [{ question_id: 'qa', chosen_option: '' }],
      });
      expect(out.graded[0].is_correct).toBe(false);
    });

    it('records question_index by canonical position, ignoring submit order', () => {
      // (attempt_id, question_index) is UNIQUE, so the index must be stable
      // regardless of the order the client posted the answers in.
      const out = markPaper({
        questions: [q('q1', '1', 0), q('q2', '1', 1)],
        answers: [
          { question_id: 'q2', chosen_option: '1' },
          { question_id: 'q1', chosen_option: '1' },
        ],
      });
      const byId = Object.fromEntries(out.graded.map(g => [g.question_id, g.question_index]));
      expect(byId.q1).toBe(0);
      expect(byId.q2).toBe(1);
    });

    it('uses POSITION not order_index — a 1-based corpus still starts at 0', () => {
      // The bot writes attempt.current_question_index, a 0-based counter over
      // the served paper. The grand-quiz corpus is 1-based, so preferring
      // order_index here would write [1,2,3] where WhatsApp writes [0,1,2] for
      // the same attempt. Caught by tests/training/portal-grand-quiz.
      const out = markPaper({
        questions: [q('q1', '1', 1), q('q2', '1', 2), q('q3', '1', 3)],
        answers: [
          { question_id: 'q1', chosen_option: '1' },
          { question_id: 'q2', chosen_option: '1' },
          { question_id: 'q3', chosen_option: '1' },
        ],
      });
      expect(out.graded.map(g => g.question_index).sort()).toEqual([0, 1, 2]);
    });

    it('handles a null order_index without producing a null index', () => {
      const out = markPaper({
        questions: [{ id: 'q1', correct_option: '1', order_index: null }],
        answers: [{ question_id: 'q1', chosen_option: '1' }],
      });
      expect(out.graded[0].question_index).toBe(0);
    });

    it('reports an answer referencing an unknown question instead of scoring it', () => {
      const out = markPaper({
        questions: [q('q1', '1', 0)],
        answers: [{ question_id: 'nope', chosen_option: '1' }],
      });
      expect(out.has_unknown_question).toBe(true);
    });

    it('reports duplicate answers for the same question', () => {
      const out = markPaper({
        questions: [q('q1', '1', 0), q('q2', '1', 1)],
        answers: [
          { question_id: 'q1', chosen_option: '1' },
          { question_id: 'q1', chosen_option: '1' },
        ],
      });
      expect(out.has_duplicate_answer).toBe(true);
    });

    it('scores a mixed paper the same way regardless of submit order', () => {
      const questions = [q('s', '2', 0), q('m', '1,3', 1), q('w', '4', 2)];
      const forward = markPaper({
        questions,
        answers: [
          { question_id: 's', chosen_option: '2' },
          { question_id: 'm', chosen_option: '3,1' },
          { question_id: 'w', chosen_option: '1' },
        ],
      });
      const reverse = markPaper({
        questions,
        answers: [
          { question_id: 'w', chosen_option: '1' },
          { question_id: 'm', chosen_option: '1,3' },
          { question_id: 's', chosen_option: '2' },
        ],
      });
      expect(forward.score).toBe(2);
      expect(reverse.score).toBe(2);
      expect(forward.total_questions).toBe(3);
    });
  });

  describe('parity with the WhatsApp grader', () => {
    // The bot's own path must be built on this module, not a private copy.
    // If someone re-forks isMultiKey/normalizeSet inside quiz-delivery, the
    // two implementations can drift again and this assertion is the tripwire.
    it('quiz-delivery.service.js sources its comparator from this module', () => {
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(
        path.join(__dirname, '../../bot/shared/services/training/quiz-delivery.service.js'),
        'utf8'
      );
      expect(src).toMatch(/require\(['"]\.\/paper-marking\.service['"]\)/);
    });
  });
});
