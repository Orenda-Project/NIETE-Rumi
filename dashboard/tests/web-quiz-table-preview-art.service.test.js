/**
 * The class table's shared link previews the CLASS picture (places, animals, scores, nobody named), not the
 * child's own "(me)" picture the table shows and shares as a file. The page warmed only the child's own one, so
 * the sender's WhatsApp found the link's picture not drawn yet and waited for a draw (3.1 s on a real phone).
 * Opening the table now also warms the picture the link will preview as. Runs the whole shipped page in the
 * harness's vm.
 */
const { page, flush } = require('./wq-page-harness');

const CARD = 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl';
const MINE = 'l.DwjiGhssTV6PkKGyw9Tl9g.yzabcdefghij';
const CLASS = 'l.TEST.qrstuvwxyzab';
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 }, art: { card: CARD, invite: null, class: MINE } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const BOARD = { finishers_n: 14, class_avg_pct: 70, rows: [], more_n: 0 };
const artFetches = (p) => p.fetches.map((f) => f.url).filter((u) => u.indexOf('/art/') >= 0);

test("a finished child's table warms the picture its shared link previews as, as well as their own", async () => {
  const p = page({ lang: 'en', store: finished(), art: { class: CLASS }, board: BOARD });
  p.wq.board();
  await flush(); await flush(); await flush();
  const art = artFetches(p);
  expect(art).toContain(`/q/TEST/art/class.jpg?a=${encodeURIComponent(CLASS)}`);
  expect(art).toContain(`/q/TEST/art/class.jpg?a=${encodeURIComponent(MINE)}`);
  // the class picture is only for the preview: never fetched as the square share file
  expect(art).not.toContain(`/q/TEST/art/class.jpg?a=${encodeURIComponent(CLASS)}&f=sq`);
});

test('a child who has not finished: the table and its link are the same class picture, fetched once', async () => {
  const p = page({ lang: 'en', art: { class: CLASS }, board: BOARD });
  p.wq.board();
  await flush(); await flush(); await flush();
  expect(artFetches(p).filter((u) => u === `/q/TEST/art/class.jpg?a=${encodeURIComponent(CLASS)}`)).toHaveLength(1);
});
