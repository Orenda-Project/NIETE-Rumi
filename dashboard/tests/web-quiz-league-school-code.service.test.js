/**
 * The school league with the look (boot adv + <html class="wq-adv">): a school name keeps its sector code whole,
 * so "P.M. Colony G-5" never breaks at the hyphen and leaves a lone "5" on the next line. A hyphen just before a
 * digit becomes a non-breaking hyphen (U+2011); without the look the name prints exactly as before.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const BOARD = {
  week_start: '2026-10-05',
  rows: [
    { place: 1, name: 'IMSG (I-X) P.M. Colony G-5', sector: 'Sector One', points: 120, kids: 12, move: 1 },
    { place: 2, name: 'School F-7', sector: 'Sector One', points: 60, kids: 4, move: -1, mine: true },
  ],
  mine: { place: 2, name: 'School F-7', sector: 'Sector One', points: 60, kids: 4, move: -1 },
  ranked_n: 2, zero_n: 3,
};

async function open(adv) {
  const p = page({ lang: 'en', store: finished(), view: 'schools', api: { '/schools/TEST': BOARD }, bootExtra: adv ? { adv: true } : {}, htmlClass: adv ? ['wq-adv'] : [] });
  await flush();
  await flush();
  return p.html();
}

test('with the look a sector code stays whole: the hyphen before its digit does not break', async () => {
  const h = await open(true);
  expect(h).toContain('IMSG (I-X) P.M. Colony G‑5');
  expect(h).not.toContain('Colony G-5');
  // the child's own school card on top keeps its code whole too
  expect(h).not.toContain('School F-7');
  expect(h).toContain('School F\u20117');
});

test('without the look the school name prints exactly as before', async () => {
  const h = await open(false);
  expect(h).toContain('IMSG (I-X) P.M. Colony G-5');
  expect(h).not.toContain('‑');
});
