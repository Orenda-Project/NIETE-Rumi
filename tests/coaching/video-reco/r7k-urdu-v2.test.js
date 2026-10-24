'use strict';
/**
 * bd-8hhqhf R7k (COS 20261024T044233 §1d; ped/urdu_terms.json v2 reason_frames): the reason line is built from the term's
 * KIND. A move name never says the teacher did the clip's move (16 v8 rows «استاد نے تھنک پیئر شیئر کروایا»); the gap comes
 * first, then «یہ کلپ ‹term› دکھاتا ہے»; «شاباش اور ایک مشورہ پوچھا» is never generated (Z045 Z096 Z412); a closed line is
 * never called an open or why question; a quote that ends in «؟» takes no second mark (Z108); the portal's English line
 * mirrors the frame in one script (Z017 Z294 Z386).
 */
const U = require('../../../bot/shared/services/coaching/video-reco/urdu-terms');

const Q = 'ابا جان نے چھٹی کے دن کیا کیا؟';

describe('transcriptLine (Urdu)', () => {
  test('move name + one child answered → the gap clause, then the move as the clip\'s', () => {
    expect(U.transcriptLine({ moveId: 'think_pair_share', answerId: 'one_word_answer', quote: Q, title: 'x' }))
      .toBe(`سبق میں استاد نے سوال پوچھا، "${Q}"، اور ایک بچے نے جواب دیا؛ باقی بچوں نے آپس میں بات نہیں کی۔ یہ کلپ تھنک پیئر شیئر دکھاتا ہے۔`);
  });
  test('move name, no gap the engine can read → closes at the quote', () => {
    expect(U.transcriptLine({ moveId: 'pair_talk', quote: Q, title: 'x' })).toBe(`سبق میں استاد نے سوال پوچھا، "${Q}" یہ کلپ جوڑیوں میں بات چیت دکھاتا ہے۔`);
  });
  test('feedback on a praise line → the feedback variant; never «شاباش اور ایک مشورہ پوچھا»', () => {
    const l = U.transcriptLine({ moveId: 'feedback_two_part', quote: 'شاباش', title: 'x' });
    expect(l).toBe('سبق میں استاد نے جواب پر "شاباش" کہا اور اگلا قدم نہیں بتایا۔ یہ کلپ دو حصوں والا فیڈبیک دکھاتا ہے۔');
    for (const q of ['شاباش', Q]) for (const m of ['feedback_two_part', 'شاباش اور ایک مشورہ']) {
      expect(U.transcriptLine({ moveId: m, quote: q, title: 'x' })).not.toMatch(/مشورہ پوچھا|کروایا/);
    }
  });
  test('a closed line is never «کھلا سوال» or «کیوں والا سوال» (the file\'s guard)', () => {
    for (const m of ['open_question', 'why_question']) expect(U.transcriptLine({ moveId: m, quote: 'کیا یہ مثلث ہے؟', title: 'x' })).toMatch(/^سبق میں استاد نے بچوں سے پوچھا، /);
    expect(U.transcriptLine({ moveId: 'why_question', quote: 'یہ مثلث کیوں ہے؟', title: 'x' })).toContain('کیوں والا سوال پوچھا');
  });
  test('«دہرائی» only on a question, never a praise line (v8 Z025)', () => {
    expect(U.transcriptLine({ moveId: 'recap_review', quote: 'شاباش بہت اچھے', title: 'x' })).not.toContain('دہرائی');
  });
  test('a descriptor is never the term', () => {
    expect(U.transcriptLine({ moveId: 'wait_time', quote: Q, title: 'x' })).toMatch(/^سبق میں استاد نے بچوں سے پوچھا، /);
  });
  test('Z108: no «؟۔»', () => {
    for (const m of [null, 'recall_question', 'think_pair_share']) expect(U.transcriptLine({ moveId: m, quote: Q, title: 'x' })).not.toContain('؟"۔');
  });
});

describe('transcriptLineEn (the portal line for an Urdu-report teacher)', () => {
  test('question type mirrors the q-frame, one script after the quote', () => {
    expect(U.transcriptLineEn({ moveId: 'yes_no_question', quote: 'Is it red?', title: 'Yes/no vs why' })).toBe('In the lesson the teacher asked a yes/no question, "Is it red?" This clip is about: Yes/no vs why.');
  });
  test('move name mirrors the move frame; never "ran think-pair-share"', () => {
    const l = U.transcriptLineEn({ moveId: 'think_pair_share', answerId: 'quick_answers', quote: Q, title: 'TPS' });
    expect(l).toBe(`In the lesson the teacher asked, "${Q}", and one child answered; the others did not talk to each other. This clip shows think-pair-share.`);
    expect(l.replace(/"[^"]*"/g, '')).not.toMatch(/[؀-ۿ]/);
  });
  test('no move → null (the caller keeps its line)', () => {
    expect(U.transcriptLineEn({ moveId: null, quote: Q, title: 'x' })).toBeNull();
  });
});
