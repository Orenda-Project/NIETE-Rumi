/**
 * An evening round on the page: the page GET carries the round's whole pool (5 lesson items + up to 6 recall items),
 * and the start reply's order.q lists only this child's set (web-quiz.service sittingQuestions). The page plays only
 * the listed questions, in that order, and numbers them out of the child's set; a reload keeps it. With the order seed
 * off the round's order comes with no option moves (o: {}): every item keeps its options where they are.
 *
 * Runs the WHOLE shipped page (public/wq/wq.js) in the shared vm harness; the network is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const opt4 = (n) => ['A', 'B', 'C', 'D'].map((slot) => ({ slot, text: `${slot.toLowerCase()}${n}` }));
const POOL = ['l1', 'l2', 'r1', 'r2', 'r3'].map((qid, i) => ({ qid, text: `Stem ${qid}?`, options: opt4(i + 1), correct_slot: 'B' }));
const SET = { q: ['l1', 'l2', 'r3'], o: {} };
const CHILD = { chip: 'c-zara', first: 'Zara', animal: 'cat' };

function arrive(reply) {
  return page({
    lang: 'en', questions: JSON.parse(JSON.stringify(POOL)),
    store: { wq_from: { code: 'TEST', st: 'old-st', at: Date.now() } },
    api: { '/api/wq/session': { st: 'new-st', child: CHILD, resume: { answered: [] }, ...reply } },
  });
}
const stemOf = (html) => (/Stem (\w+)\?/.exec(html) || [])[1];
const optionOrder = (html) => [...html.matchAll(/data-slot="([A-D])"/g)].map((m) => m[1]);

test('the page plays only the qids the start reply lists, in that order, options where they are', async () => {
  const p = arrive({ order: SET });
  await flush(); await flush();
  expect(p.wq.QS.map((q) => q.qid)).toEqual(['l1', 'l2', 'r3']);
  expect(stemOf(p.html())).toBe('l1');
  expect(optionOrder(p.html())).toEqual(['A', 'B', 'C', 'D']);
  p.wq.question(2);
  expect(stemOf(p.html())).toBe('r3');
  expect(p.html()).not.toMatch(/Stem r1\?|Stem r2\?/);
});

test('a reload keeps the child\'s set', async () => {
  const p = arrive({ order: SET });
  await flush(); await flush();
  const kept = JSON.parse(p.ctx.localStorage.getItem('wq_s_TEST'));
  const again = page({ lang: 'en', questions: JSON.parse(JSON.stringify(POOL)), store: { wq_s_TEST: kept } });
  expect(again.wq.QS.map((q) => q.qid)).toEqual(['l1', 'l2', 'r3']);
});

describe('"Done for tonight!": the start answers round_done_for_tonight with no st', () => {
  const DECK = require('../../bot/shared/config/copy.v2.json')['qfix_class_link.done_tonight'];
  const REPLY = { round_done_for_tonight: true, class_link_code: 'K7Q2MXTRAB', round_code: 'TEST' };
  const done = (lang) => page({
    lang, questions: JSON.parse(JSON.stringify(POOL)),
    store: { wq_from: { code: 'TEST', st: 'old-st', at: Date.now() } },
    api: { '/api/wq/session': REPLY },
  });

  test.each(['en', 'ur'])('%s: the words as a toast (the deck\'s, byte for byte), then the landing; no sitting, no question', async (lang) => {
    const p = done(lang);
    await flush(); await flush();
    expect(p.toasts()).toEqual([DECK[lang]]);
    expect(p.wq.T.doneTonight).toBe(DECK[lang]);
    expect(p.moment()).toBe('M3');
    expect(p.wq.S.st).toBeFalsy();
    expect(stemOf(p.html())).toBeUndefined();
    expect(p.ls.has('wq_s_TEST') ? JSON.parse(p.ls.get('wq_s_TEST')).st : undefined).toBeFalsy();
  });

  test('one round_done_for_tonight event, with the round\'s two codes from the reply', async () => {
    const p = done('en');
    await flush(); await flush();
    p.fireWin('pagehide');
    const evs = p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
    const mine = evs.filter((e) => e.n === 'round_done_for_tonight');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ class_link_code: 'K7Q2MXTRAB', round_code: 'TEST' });
    expect(evs.filter((e) => e.n === 'quiz_start')).toEqual([]);
  });
});
