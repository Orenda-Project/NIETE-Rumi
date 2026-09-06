'use strict';
/**
 * EVERY VERDICT OPENS WITH ✅ OR ❌ (round-5 D2).
 *
 * The operator, after taking a quiz on staging: "It's very hard for me to tell
 * whether I got the question correct or incorrect. There should be in the message
 * a checkmark or a cross and clear indication."
 *
 * He is right and the cause is in this file's subject. `finishAnswerPhase` uses
 * the author's `option_feedback.correct` VERBATIM — and the author writes prose
 * ("That's right! Mummies were the preserved dead bodies of kings"), not a symbol.
 * Only the fallback string, which fires when the author supplied nothing at all,
 * carried a ✅; the wrong fallback opened "Not quite" with no ❌ at all. So the
 * child sees a paragraph and has to READ it to learn whether she was right — at
 * exactly the moment she is least able to.
 *
 * The author's sentence is kept. The marker is the renderer's job, prepended
 * unless it is already there, in both languages.
 *
 * RUN: cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest --config jest.config.js tests/quiz/video-quiz-verdict-marker.test.js
 */
const render = require('../../shared/services/quiz/video-quiz-render.service');

const TICK = '✅';
const CROSS = '❌';
const RLM = '‏';

const correctMsg = (msgs) => msgs.find((m) => m.role === 'feedback_correct');
const wrongMsgs = (msgs) => msgs.filter((m) => m.role === 'feedback_incorrect');

/** A three-option question with prose feedback, exactly as the author writes it. */
function q(over = {}) {
  return {
    id: 'q-mummies', external_id: 'tq:quiz-1:S3:4',
    question_text: 'What were mummies?',
    option_a: 'Stone statues of kings',
    option_b: 'Gold coins buried in tombs',
    option_c: 'Preserved dead bodies',
    correct_option: 'C',
    explanation: 'Egyptians preserved bodies so the person could live on.',
    option_feedback: {
      correct: 'That’s right! Mummies were the preserved dead bodies of kings.',
      wrong: {
        0: 'Statues stood in the tomb, but they were not the body itself.',
        1: 'Coins were buried too, but a mummy is not a coin.',
      },
    },
    media: {}, render_pattern: 'P1',
    ...over,
  };
}

describe('D2 — the child can tell at a glance', () => {
  test('the author’s correct verdict is kept and opens with a tick', () => {
    const m = correctMsg(render.build(q()));
    expect(m.body.startsWith(`${TICK} `)).toBe(true);
    expect(m.body).toContain('Mummies were the preserved dead bodies of kings');
  });

  test('every wrong verdict opens with a cross', () => {
    const wrong = wrongMsgs(render.build(q()));
    expect(wrong).toHaveLength(2);
    wrong.forEach((m) => expect(m.body.startsWith(`${CROSS} `)).toBe(true));
    expect(wrong[0].body).toContain('Statues stood in the tomb');
  });

  test('a verdict that already carries its marker is not marked twice', () => {
    const msgs = render.build(q({
      option_feedback: {
        correct: `${TICK} Correct — a mummy is a preserved body.`,
        wrong: { 0: `${CROSS} Not the statue — the body itself.` },
      },
    }));
    expect(correctMsg(msgs).body.startsWith(`${TICK} ${TICK}`)).toBe(false);
    expect(correctMsg(msgs).body.startsWith(`${TICK} Correct`)).toBe(true);
    expect(wrongMsgs(msgs)[0].body.startsWith(`${CROSS} ${CROSS}`)).toBe(false);
  });

  test('the fallbacks carry the markers too, for a question the author left bare', () => {
    const msgs = render.build(q({ option_feedback: null }));
    expect(correctMsg(msgs).body.startsWith(`${TICK} `)).toBe(true);
    wrongMsgs(msgs).forEach((m) => expect(m.body.startsWith(`${CROSS} `)).toBe(true));
  });
});

describe('D2 — Urdu', () => {
  const urdu = (over = {}) => q({
    question_text: 'ممی کیا تھیں؟',
    option_a: 'پتھر کے مجسمے', option_b: 'سونے کے سکے', option_c: 'محفوظ کیے گئے جسم',
    option_feedback: {
      correct: 'بالکل درست! ممی محفوظ کیے گئے جسم تھے۔',
      wrong: { 0: 'مجسمے قبر میں رکھے جاتے تھے، مگر وہ جسم نہیں تھے۔' },
    },
    media: { language: 'ur' },
    ...over,
  });

  test('an Urdu verdict gets the marker and needs no right-to-left mark', () => {
    const m = correctMsg(render.build(urdu()));
    expect(m.body).toBe('✅ بالکل درست! ممی محفوظ کیے گئے جسم تھے۔');
  });

  test('an Urdu verdict that opens with an English term gets U+200F after the marker', () => {
    // Rule 20: English technical terms stay in Latin letters inside Urdu. A line
    // whose first strong character is Latin lays out left-to-right unless it is
    // told otherwise, which puts the Urdu full stop at the wrong end.
    const m = correctMsg(render.build(urdu({
      option_feedback: { correct: 'Mummification ہی وہ عمل تھا جو جسم کو محفوظ رکھتا تھا۔', wrong: {} },
    })));
    expect(m.body).toBe(`✅ ${RLM}Mummification ہی وہ عمل تھا جو جسم کو محفوظ رکھتا تھا۔`);
  });

  test('an all-English verdict never gets a right-to-left mark', () => {
    expect(correctMsg(render.build(q())).body).not.toContain(RLM);
  });
});

describe('D2 — the invariant, across shapes', () => {
  test('every pattern, both outcomes, always marked', () => {
    const shapes = [
      q(),
      q({ render_pattern: 'P3', media: { question_image: 'https://r2/i.png' } }),
      q({ media: { question_card: 'https://r2/card1.png' } }),
      q({ option_feedback: { correct: '', wrong: {} } }),
      q({ option_a: 'A very long option that will never fit inside a reply button at all',
          option_feedback: null }),
    ];
    shapes.forEach((shape) => {
      const msgs = render.build(shape);
      expect(correctMsg(msgs).body.startsWith(`${TICK} `)).toBe(true);
      const wrong = wrongMsgs(msgs);
      expect(wrong.length).toBeGreaterThan(0);
      wrong.forEach((m) => expect(m.body.startsWith(`${CROSS} `)).toBe(true));
    });
  });
});
