/**
 * Web quiz page: the shared feedback lines ("Yes! That's right!", "Quiz complete!") speak the language
 * the quiz's own clips were recorded in — the server's quiz.voice_lang — never "any Urdu letter in the
 * questions". An English quiz that quotes one Urdu word must not switch to the Urdu voice.
 */
const { page, flush } = require('./wq-page-harness');

const GLOSS = [1, 2, 3].map((n) => ({
  qid: `q${n}`, text: n === 1 ? 'What is a circle (سرکل)?' : `Question ${n}?`, correct_slot: 'A',
  options: [{ slot: 'A', text: 'A round shape' }, { slot: 'B', text: 'A line' }],
}));
const played = {
  st: 'ST1', child: { first: 'Ali', chip: 'c1', animal: 'owl' }, seq: 3, wrong: [], result: null, queue: [],
  answers: { q1: { slot: 'A', ok: true }, q2: { slot: 'A', ok: true }, q3: { slot: 'A', ok: true } },
};
const FIN = { score: { correct: 3, total: 3, pct: 100, level: 'x' }, counted: true, card: { first: 'Ali', animal: 'owl', correct: 3, total: 3, stars: 3 } };
const settle = async () => { for (let i = 0; i < 8; i += 1) await flush(); };
const URDU = /[؀-ۿ]/;

async function endBubble(opts) {
  const p = page({ questions: GLOSS, store: { wq_s_TEST: played }, api: { '/api/wq/finish': FIN, '/api/wq/answers': { recorded: [], dup: [], unknown: [] } }, ...opts });
  p.wq.results(0);
  await settle();
  const m = /<div class="wq-say">([^<]*)<\/div>/.exec(p.html());
  return m ? m[1] : '';
}

test('an English quiz quoting an Urdu gloss: the "quiz complete" line is English (voice_lang en)', async () => {
  const say = await endBubble({ lang: 'en', voiceLang: 'en' });
  expect(say).not.toBe('');
  expect(URDU.test(say)).toBe(false);
});

test('an Urdu quiz keeps the Urdu lines (voice_lang ur), even opened from an English page', async () => {
  const say = await endBubble({ lang: 'en', voiceLang: 'ur' });
  expect(URDU.test(say)).toBe(true);
});
