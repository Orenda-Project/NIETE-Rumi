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

  const V2 = { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [], identity: { mode: 'v2' } };
  const starts = (p) => p.fetches.filter((f) => f.url.indexOf('/api/wq/session') >= 0);
  // Anything that starts a sitting or asks who is playing: Play, Play as, Not X?, a child's card, Someone else, Start.
  const START = /id="wq-(play|play-as|notme|someone|kid-\d+|start|new)"|wq-btn wq-go/;
  // Every control the screen now shows (an id in its html) tapped, as the browser calls a listener (`this` = the button),
  // and a tap on the page itself.
  const tapAll = (p) => {
    [...p.html().matchAll(/id="([^"]+)"/g)].forEach((m) => {
      const el = p.els[`#${m[1]}`];
      if (el) (el.listeners.click || []).slice().forEach((fn) => fn.call(el, {}));
    });
    p.tap();
  };

  test.each(['en', 'ur'])('%s: the words on the screen (the deck\'s, byte for byte), no Play, no toast; no sitting, no question', async (lang) => {
    const p = done(lang);
    await flush(); await flush();
    expect(p.wq.T.doneTonight).toBe(DECK[lang]);
    expect(p.html()).toContain(DECK[lang]);
    expect(p.html()).not.toMatch(START);
    expect(p.html()).not.toContain(`>${p.wq.T.play}<`);
    expect(p.toasts()).toEqual([]);
    expect(p.moment()).not.toBe('M3');
    expect(p.wq.S.st).toBeFalsy();
    expect(stemOf(p.html())).toBeUndefined();
    expect(p.ls.has('wq_s_TEST') ? JSON.parse(p.ls.get('wq_s_TEST')).st : undefined).toBeFalsy();
  });

  test.each(['en', 'ur'])('%s: Home on the done screen goes back to the class link\'s landing (a sibling can still play), never to the round', async (lang) => {
    const p = done(lang);
    await flush(); await flush();
    const home = /<a [^>]*id="wq-done-home"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(p.html());
    expect(home).not.toBeNull();
    expect(home[1]).toMatch(/^\/j\/K7Q2MXTRAB(\?|$)/);
    expect(home[2]).toBe(p.wq.T.home);
    expect(p.html()).not.toMatch(/href="[^"]*\/q\/TEST/);
    expect(p.html()).not.toMatch(START);
  });

  test('a done answer without a class link code: no Home, the words and nothing that starts again', async () => {
    const p = page({
      lang: 'en', questions: JSON.parse(JSON.stringify(POOL)),
      store: { wq_from: { code: 'TEST', st: 'old-st', at: Date.now() } },
      api: { '/api/wq/session': { round_done_for_tonight: true, class_link_code: 'not a code!', round_code: 'TEST' } },
    });
    await flush(); await flush();
    expect(p.html()).toContain(DECK.en);
    expect(p.html()).not.toContain('id="wq-done-home"');
    expect(p.html()).not.toMatch(START);
  });

  test.each(['en', 'ur'])('%s: the hub link (?k=, identity v2) of a child who finished: one start, the words, and a tap anywhere starts nothing', async (lang) => {
    const p = page({
      lang, ident: true, cls: V2, search: '?k=c-zara', questions: JSON.parse(JSON.stringify(POOL)),
      store: { wq_kids: [CHILD], wq_d: 'd1' }, api: { '/api/wq/session': REPLY },
    });
    await flush(); await flush();
    expect(starts(p)).toHaveLength(1);
    expect(JSON.parse(starts(p)[0].init.body)).toMatchObject({ chip: 'c-zara', via: 'hub' });
    expect(p.html()).toContain(DECK[lang]);
    expect(p.html()).not.toMatch(START);
    expect(p.html()).not.toContain('Zara');
    tapAll(p);
    await flush(); await flush();
    tapAll(p);
    await flush(); await flush();
    expect(starts(p)).toHaveLength(1);
    expect(p.html()).toContain(DECK[lang]);
  });

  test('a remembered child\'s Play as (no identity v2): the words in place of the landing, and nothing on them starts again', async () => {
    const p = page({ lang: 'en', questions: JSON.parse(JSON.stringify(POOL)), store: { wq_kids: [CHILD] }, api: { '/api/wq/session': REPLY } });
    await flush();
    expect(p.html()).toContain('id="wq-play-as"');
    p.els['#wq-play-as'].fire('click');
    await flush(); await flush();
    expect(starts(p)).toHaveLength(1);
    expect(p.html()).toContain(DECK.en);
    expect(p.html()).not.toMatch(START);
    tapAll(p);
    await flush(); await flush();
    expect(starts(p)).toHaveLength(1);
  });

  test('every other landing is today\'s: Play is there, and so is the identity v2 Play', async () => {
    const plain = page({ lang: 'en', questions: JSON.parse(JSON.stringify(POOL)) });
    const known = page({ lang: 'en', questions: JSON.parse(JSON.stringify(POOL)), store: { wq_kids: [CHILD] } });
    const v2 = page({ lang: 'en', ident: true, cls: V2, questions: JSON.parse(JSON.stringify(POOL)) });
    await flush();
    expect(plain.moment()).toBe('M3');
    expect(plain.html()).toContain('id="wq-play"');
    expect(known.html()).toContain('id="wq-play-as"');
    expect(v2.moment()).toBe('M4-who-v2');
    expect(v2.html()).toContain('id="wq-play"');
    expect(plain.html()).not.toContain(DECK.en);
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

describe('the start card counts what a sitting serves (the payload\'s n), not the pool the page ships', () => {
  // 9 served rows ship (5 lesson + 4 recall); every sitting serves 7 (quiz.n, web-quiz.service getQuiz)
  const NINE = ['l1', 'l2', 'l3', 'l4', 'l5', 'r1', 'r2', 'r3', 'r4'].map((qid, i) => ({ qid, text: `Stem ${qid}?`, options: opt4(i + 1), correct_slot: 'B' }));
  const V2 = { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [], identity: { mode: 'v2' } };
  const card = (o) => page({ questions: JSON.parse(JSON.stringify(NINE)), ...o });
  const small = (html) => (/<p class="wq-small">([^<]*)<\/p>/.exec(html) || [])[1];

  test.each([
    ['en', '7 questions · about 4 minutes'],
    ['ur', '۷ سوال · تقریباً ۴ منٹ'],
  ])('%s: the landing says 7, in the page\'s digits', async (lang, line) => {
    const p = card({ lang, quizExtra: { n: 7 } });
    await flush();
    expect(p.moment()).toBe('M3');
    expect(small(p.html())).toBe(line);
  });

  test('the identity v2 landing and the teacher\'s preview say 7 too', async () => {
    const v2 = card({ lang: 'en', ident: true, cls: V2, quizExtra: { n: 7 } });
    const teacher = card({ lang: 'en', preview: true, search: '?p=tok', quizExtra: { n: 7 } });
    await flush();
    expect(v2.moment()).toBe('M4-who-v2');
    expect(small(v2.html())).toBe('7 questions · about 4 minutes');
    expect(teacher.moment()).toBe('M3-teacher');
    expect(teacher.html()).toContain('7 questions · about 4 minutes');
  });

  test('a quiz whose n is every question (or a payload without one) says what it ships, as today', async () => {
    const same = card({ lang: 'en', quizExtra: { n: 9 } });
    const none = card({ lang: 'en' });
    await flush();
    expect(small(same.html())).toBe('9 questions · about 5 minutes');
    expect(small(none.html())).toBe('9 questions · about 5 minutes');
  });

  test('the sitting still plays and numbers the child\'s own set from the pool', async () => {
    const p = page({
      lang: 'en', questions: JSON.parse(JSON.stringify(NINE)), quizExtra: { n: 7 },
      store: { wq_from: { code: 'TEST', st: 'old-st', at: Date.now() } },
      api: { '/api/wq/session': { st: 'new-st', child: CHILD, resume: { answered: [] }, order: { q: ['l1', 'l2', 'l3', 'l4', 'l5', 'r2', 'r4'], o: {} } } },
    });
    await flush(); await flush();
    expect(p.wq.QS).toHaveLength(7);
    expect(stemOf(p.html())).toBe('l1');
  });
});
