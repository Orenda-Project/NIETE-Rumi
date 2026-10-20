/**
 * Jugnu's bubble on the quiz end screen never repeats the card's own heading (app_settings web_quiz_end_once, the answer's
 * `end_once`; default off). The card says «کوئز مکمل» / "QUIZ COMPLETE"; with the switch on, Jugnu's done line is picked
 * only from the recorded lines without that heading's last word («مکمل» / "complete"), so a child never reads it twice.
 * The line keeps its recorded clip (the same index in the recorded set). When the quiz's voice speaks another language than
 * the page, nothing is skipped (the two cannot repeat each other). Off: today's pick from the whole set.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1' };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result } });
const RES = { score: { correct: 3, total: 7 }, card: {} };
const RUNS = 40;

async function bubble(lang, bootExtra, opts = {}) {
  const p = page({ lang, store: store(RES), bootExtra, api: { '/finish': RES }, ...opts });
  p.wq.results(0);
  for (let k = 0; k < 6; k += 1) await flush();
  expect(p.moment()).toBe('M9');
  return /<div class="wq-say">([\s\S]*?)<\/div>/.exec(p.html())[1];
}
async function bubbles(lang, bootExtra, opts) {
  const out = [];
  for (let i = 0; i < RUNS; i += 1) out.push(await bubble(lang, bootExtra, opts));
  return out;
}

describe('web_quiz_end_once on: the bubble never repeats the card heading', () => {
  test('ur: no «مکمل» in Jugnu\'s done line, and more than one line still comes round', async () => {
    const seen = await bubbles('ur', { end_once: true }, { voiceLang: 'ur' });
    expect(seen.filter((t) => t.includes('مکمل'))).toEqual([]);
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
  test('en: no "complete" in Jugnu\'s done line', async () => {
    const seen = await bubbles('en', { end_once: true }, { voiceLang: 'en' });
    expect(seen.filter((t) => /complete/i.test(t))).toEqual([]);
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
  test('an Urdu page whose quiz speaks English skips nothing (the heading is Urdu, the line English)', async () => {
    const seen = await bubbles('ur', { end_once: true }, { voiceLang: 'en' });
    expect(seen.some((t) => /complete/i.test(t))).toBe(true);
  });
});

describe('web_quiz_end_once off: today\'s pick from the whole set', () => {
  test('ur: the «مکمل» lines still come round', async () => {
    const seen = await bubbles('ur', {}, { voiceLang: 'ur' });
    expect(seen.some((t) => t.includes('مکمل'))).toBe(true);
  });
});
