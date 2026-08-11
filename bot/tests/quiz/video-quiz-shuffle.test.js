'use strict';
/**
 * bd-2359 — the correct answer must not sit at option A far more often than chance.
 *
 * Measured across all 11,831 live video-quiz questions on 2026-07-28:
 *   A 38.1%  B 32.5%  C 28.0%  D 1.4%
 * and the skew is worst where it is most learnable — the legacy bank runs
 * A 46.0 / B 33.7 / C 13.9 / D 6.3, and 4-option questions run A 39.9 against a
 * 25% uniform. A child who notices can farm marks without reading.
 *
 * bd-1314 fixed exactly this for the /quiz feature by shuffling at GENERATION
 * time and storing the result. The video-quiz corpus came from a different
 * pipeline that never got that treatment, and it is 13k already-stored rows, so
 * here the shuffle is applied at RENDER time instead: no migration, reversible,
 * and it cannot corrupt data it does not write.
 *
 * THE TRAP THIS FILE EXISTS TO CATCH.
 * Scoring reads parseAnswer(id).index and compares it against correctIndices(q).
 * option_feedback and the report's distractor clustering are index-keyed too.
 * So the shuffle must reorder ONLY what the child sees, while every emitted id
 * still carries the option's ORIGINAL index. Shuffling the labels array itself
 * would mis-score every shuffled question AND make the verdict name the wrong
 * option — silently, and in a way no smoke test would catch.
 *
 * The order is fixed per question (operator's call, 2026-07-28): every child
 * sees the same arrangement, so two children comparing phones agree.
 *
 * RUN: NODE_OPTIONS='--localstorage-file=/tmp/jest-ls.json' npx jest tests/quiz/video-quiz-shuffle.test.js
 */
const render = require('../../shared/services/quiz/video-quiz-render.service');

const ask = (msgs) => msgs.find((m) => m.role === 'ask' || m.role === 'picture_flow');

/** A four-option question whose correct answer is stored at A. */
function q4(id, over = {}) {
  return {
    id, external_id: id,
    question_text: 'Which material is the best conductor?',
    option_a: 'Copper wire', option_b: 'Rubber band',
    option_c: 'Dry wood', option_d: 'Plastic cup',
    correct_option: 'A',
    explanation: 'Copper conducts electricity well.',
    option_feedback: null,
    media: {},
    render_pattern: 'P1',
    ...over,
  };
}

describe('bd-2359 — the correct answer moves off A', () => {
  test('across the bank the correct answer lands in every slot about equally', () => {
    const seen = [0, 0, 0, 0];
    const N = 2000;
    for (let i = 0; i < N; i += 1) {
      const q = q4(`q-${i}`);
      const a = ask(render.build(q));
      seen[a.options.indexOf('Copper wire')] += 1;
    }
    // 25% expected; a generous band still fails hard on today's "always A".
    seen.forEach((n) => {
      expect(n / N).toBeGreaterThan(0.18);
      expect(n / N).toBeLessThan(0.32);
    });
  });

  test('three-option questions spread too', () => {
    const seen = [0, 0, 0];
    const N = 1500;
    for (let i = 0; i < N; i += 1) {
      const a = ask(render.build(q4(`t-${i}`, { option_d: null })));
      seen[a.options.indexOf('Copper wire')] += 1;
    }
    seen.forEach((n) => {
      expect(n / N).toBeGreaterThan(0.25);
      expect(n / N).toBeLessThan(0.42);
    });
  });
});

describe('bd-2359 — the shuffle never breaks scoring', () => {
  test('every emitted id still carries the option ORIGINAL index', () => {
    for (let i = 0; i < 200; i += 1) {
      const q = q4(`s-${i}`);
      const labels = render.optionLabels(q);
      const a = ask(render.build(q));
      expect(a.optionIndices).toHaveLength(a.options.length);
      a.options.forEach((label, pos) => {
        expect(labels[a.optionIndices[pos]]).toBe(label);
      });
    }
  });

  test('tapping the option that READS correct scores as correct', () => {
    for (let i = 0; i < 200; i += 1) {
      const q = q4(`c-${i}`);
      const a = ask(render.build(q));
      const pos = a.options.indexOf('Copper wire');
      const originalIndex = a.optionIndices[pos];
      expect(render.correctIndices(q)).toContain(originalIndex);
    }
  });

  test('the verdict names the option the child actually saw', () => {
    const msgs = render.build(q4('v-1'));
    const correct = msgs.find((m) => m.role === 'feedback_correct');
    expect(correct.body).toContain('Copper wire');
  });

  test('per-distractor feedback stays glued to its own option', () => {
    const q = q4('fb-1', {
      option_feedback: { correct: 'Yes!', wrong: { 1: 'Rubber insulates.', 2: 'Wood insulates.', 3: 'Plastic insulates.' } },
    });
    const msgs = render.build(q);
    const byIndex = Object.fromEntries(
      msgs.filter((m) => m.role === 'feedback_incorrect').map((m) => [m.optionIndex, m.body]),
    );
    expect(byIndex[1]).toContain('Rubber insulates.');
    expect(byIndex[2]).toContain('Wood insulates.');
    expect(byIndex[3]).toContain('Plastic insulates.');
  });
});

describe('bd-2359 — the order is fixed per question', () => {
  test('the same question renders the same order every time', () => {
    const a = ask(render.build(q4('stable-1'))).options;
    for (let i = 0; i < 20; i += 1) {
      expect(ask(render.build(q4('stable-1'))).options).toEqual(a);
    }
  });

  test('build() is called twice per question — both calls must agree', () => {
    // video-quiz.service.js builds once for the question phase and again for
    // the answer phase. A non-deterministic shuffle would name a different
    // option in the verdict than the one the child was shown.
    const first = render.build(q4('twice-1'));
    const second = render.build(q4('twice-1'));
    expect(ask(second).options).toEqual(ask(first).options);
    expect(ask(second).optionIndices).toEqual(ask(first).optionIndices);
  });

  test('different questions get different arrangements', () => {
    const orders = new Set();
    for (let i = 0; i < 50; i += 1) {
      orders.add(ask(render.build(q4(`d-${i}`))).optionIndices.join(''));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  test('the order is always a permutation — nothing lost, nothing duplicated', () => {
    for (let i = 0; i < 200; i += 1) {
      const a = ask(render.build(q4(`p-${i}`)));
      expect([...a.optionIndices].sort()).toEqual([0, 1, 2, 3]);
    }
  });
});

describe('bd-2359 — questions whose order carries meaning are left alone', () => {
  test('a picture-grid question keeps its stored order', () => {
    // The numbered grid is a pre-rendered IMAGE. Shuffling the labels would
    // point "1." at a picture the child is not looking at.
    const q = q4('p5-1', {
      render_pattern: 'P5',
      option_a: '1. Cat', option_b: '2. Dog', option_c: '3. Cow', option_d: '4. Hen',
      media: {
        grid: 'https://cdn.test/grid.png',
        option_images: [0, 1, 2, 3].map((i) => ({ index: i, url: `https://cdn.test/${i}.png` })),
      },
    });
    const a = ask(render.build(q));
    expect(a.optionIndices).toEqual([0, 1, 2, 3]);
  });

  test('positional labels like "Sound 2" keep their stored order', () => {
    const q = q4('snd-1', {
      option_a: '', option_b: '', option_c: null, option_d: null,
      correct_option: 'A',
      media: { option_audio: [{ index: 0, url: 'https://cdn.test/a.ogg' }, { index: 1, url: 'https://cdn.test/b.ogg' }] },
    });
    const a = ask(render.build(q));
    expect(a.options).toEqual(['Sound 1', 'Sound 2']);
    expect(a.optionIndices).toEqual([0, 1]);
  });

  test('"All of the above" stays last', () => {
    const q = q4('aotv-1', { option_d: 'All of the above', correct_option: 'D' });
    const a = ask(render.build(q));
    expect(a.options[a.options.length - 1]).toBe('All of the above');
    expect(a.optionIndices).toEqual([0, 1, 2, 3]);
  });

  test('a sentence merely containing "all of these" is NOT treated as an anchor', () => {
    // Caught while sizing this fix: a loose regex flagged
    // '"Gopi, you will iron all of these clothes," said Master Sahab.'
    // which is an ordinary option and should shuffle like any other.
    const q = q4('gopi-1', {
      option_a: '"Gopi, you will iron all of these clothes," said Master Sahab.',
    });
    const seen = new Set();
    for (let i = 0; i < 40; i += 1) {
      seen.add(ask(render.build(q4(`gopi-${i}`, { option_a: q.option_a }))).optionIndices.join(''));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('bd-2359 — fail safe rather than mis-score', () => {
  test('a question whose correct letter falls outside its options is not shuffled', () => {
    // optionLabels() compacts away non-existent options while correctIndices()
    // reads the raw letter, so a gapped question would disagree about what
    // index 2 means. Production has zero of these today (all 11,831 checked),
    // and if one ever appears it must render in stored order rather than be
    // quietly rearranged around a broken answer key.
    const q = q4('gap-1', { option_c: null, option_d: null, correct_option: 'D' });
    const a = ask(render.build(q));
    expect(a.optionIndices).toEqual([0, 1]);
  });

  test('a two-option question still shuffles', () => {
    const seen = new Set();
    for (let i = 0; i < 60; i += 1) {
      seen.add(ask(render.build(q4(`two-${i}`, {
        option_c: null, option_d: null, correct_option: 'A',
      }))).optionIndices.join(''));
    }
    expect(seen.size).toBe(2);
  });
});
