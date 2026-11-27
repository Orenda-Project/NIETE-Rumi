/**
 * The practice door on the finish screen (A/B test ict-quiz-practice-door, arm B; app_settings ab_quiz_practice_door).
 * Only when finish says so (result.practice_door) does wq.js ask for wq-practice.js; then the card offers "Practise for
 * your test": topics → 5 questions → the round's result with the lesson plan's worked answers. Nothing is shared and
 * no WhatsApp link is ever drawn. Without practice_door the card is today's card and the file is never asked for.
 * Runs the whole shipped page in the harness's vm.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, flush } = require('./wq-page-harness');

const PD_JS = path.join(__dirname, '..', 'public', 'wq', 'wq-practice.js');
const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const PD = { ...RESULT, practice_door: { rounds_left: 2 } };
const store = (result) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result, vdone: true } });
const Q = (i) => ({ qid: `p${i}`, text: `Which word in line ${i} names a thing?`, options: { A: 'cat', B: 'run', C: 'red' } });
const ROUND = { round_id: 'r1', questions: [1, 2, 3, 4, 5].map(Q), rounds_left: 1 };
const RES = { score: 4, total: 5, items: [1, 2, 3, 4, 5].map((i) => ({ qid: `p${i}`, chosen: i === 1 ? 'B' : 'A', correct: 'A', right: i !== 1, worked: i === 1 ? 'A naming word names a person, place or thing.' : null })) };
const START = (url, init) => (JSON.parse(init.body).topics ? ROUND : { topics: ['Naming words', 'Action words'], rounds_left: 2 });

function withDoor(opts) {
  const p = page(opts);
  vm.runInContext(fs.readFileSync(PD_JS, 'utf8'), p.ctx);
  p.wq.card();
  return p;
}
const posts = (p, k) => p.fetches.filter((f) => f.url === `/api/wq/practice/${k}`).map((f) => JSON.parse(f.init.body));

describe('the door on the card', () => {
  test('EN: "Practise for your test" with the rounds left, under the score', () => {
    const h = withDoor({ lang: 'en', store: store(PD) }).html();
    expect(h).toContain('id="wq-pd-go"');
    expect(h).toContain('Practise for your test');
    expect(h).toContain('2 practice rounds left today');
    expect(h.indexOf('wq-scorecard')).toBeLessThan(h.indexOf('id="wq-pd-go"'));
  });
  test('UR: in Urdu, the number in Urdu digits', () => {
    const h = withDoor({ lang: 'ur', store: store(PD) }).html();
    expect(h).toContain('اپنے ٹیسٹ کی مشق کریں');
    expect(h).toContain('۲');
  });
  test('the folded card (child home on) carries the door too', () => {
    const h = withDoor({ lang: 'en', store: store({ ...PD, card_fold: true }) }).html();
    expect(h).toContain('id="wq-pd-go"');
  });
  test('not on a friend\'s challenge run, nor when finish did not offer it', () => {
    expect(withDoor({ lang: 'en', store: store(PD), challenge: { code: 'CHAL12', first: 'Omar' } }).html()).not.toContain('wq-pd');
    expect(withDoor({ lang: 'en', store: store(RESULT) }).html()).not.toContain('wq-pd');
  });
});

describe('wq.js asks for wq-practice.js only when finish offers the door', () => {
  const asked = (p) => p.head.filter((e) => String(e.src || '').indexOf('/wq/wq-practice.js') >= 0).length;
  // the page boots straight onto the saved card; the library page (lib) is the harness's page with a <head> to count in
  const bare = (o) => page({ ...o, lib: true });
  test('offered: asked once, even after the card re-renders', () => {
    const p = bare({ lang: 'en', store: store(PD) });
    p.wq.card(); p.wq.card();
    expect(asked(p)).toBe(1);
  });
  test('not offered, or a friend\'s run: never asked, and the card has no trace of it', () => {
    const p = bare({ lang: 'en', store: store(RESULT) });
    p.wq.card();
    expect(asked(p)).toBe(0);
    expect(p.html()).not.toContain('wq-pd');
    const f = bare({ lang: 'en', store: store(PD), challenge: { code: 'CHAL12', first: 'Omar' } });
    f.wq.card();
    expect(asked(f)).toBe(0);
  });
});

describe('a round: topics → 5 questions → the result', () => {
  test('the whole round, graded on the server, worked answers shown, no share and no WhatsApp', async () => {
    const p = withDoor({ lang: 'en', store: store(PD), api: { 'practice/start': START, 'practice/finish': RES } });
    p.els['#wq-pd-go'].fire('click');
    await flush(); await flush();
    expect(posts(p, 'start')).toEqual([{ st: 's1' }]);
    expect(p.html()).toContain('Pick up to 3 topics');
    expect(p.html()).toContain('Naming words');
    p.els['#wq-pd-t-0'].fire('click');
    p.els['#wq-pd-start'].fire('click');
    await flush(); await flush();
    expect(posts(p, 'start')[1]).toEqual({ st: 's1', topics: ['Naming words'] });
    expect(p.html()).toContain('Question 1 of 5');
    expect(p.html()).toContain('Which word in line 1 names a thing?');
    p.els['#wq-pd-o-B'].fire('click');
    for (let i = 2; i <= 5; i += 1) {
      expect(p.html()).toContain(`Question ${i} of 5`);
      p.els['#wq-pd-o-A'].fire('click');
    }
    await flush(); await flush();
    expect(posts(p, 'finish')).toEqual([{ st: 's1', round_id: 'r1', answers: { p1: 'B', p2: 'A', p3: 'A', p4: 'A', p5: 'A' } }]);
    const h = p.html();
    expect(h).toContain('You got 4 of 5 right');
    expect(h).toContain('From your lesson');
    expect(h).toContain('A naming word names a person, place or thing.');
    expect(h).toContain('cat');
    expect(h).toContain('id="wq-pd-again"');
    expect(h).not.toMatch(/wa\.me|whatsapp|wq-share/i);
    p.els['#wq-pd-back'].fire('click');
    expect(p.html()).toContain('id="wq-share"');
  });
  test('no topic picked: Start sends [] (the server takes every offered topic); the last round hides "Practise again"', async () => {
    const p = withDoor({ lang: 'en', store: store(PD), api: { 'practice/start': (u, i) => (JSON.parse(i.body).topics ? { ...ROUND, rounds_left: 0 } : START(u, i)), 'practice/finish': RES } });
    p.els['#wq-pd-go'].fire('click');
    await flush(); await flush();
    p.els['#wq-pd-start'].fire('click');
    await flush(); await flush();
    expect(posts(p, 'start')[1]).toEqual({ st: 's1', topics: [] });
    for (let i = 1; i <= 5; i += 1) p.els['#wq-pd-o-A'].fire('click');
    await flush(); await flush();
    expect(p.html()).not.toContain('id="wq-pd-again"');
  });
  test('UR: the round in Urdu', async () => {
    const p = withDoor({ lang: 'ur', store: store(PD), api: { 'practice/start': START, 'practice/finish': RES } });
    p.els['#wq-pd-go'].fire('click');
    await flush(); await flush();
    expect(p.html()).toContain('تین تک موضوعات چنیں');
  });
  test('capped, short or switched off: a toast, and the card stays', async () => {
    for (const ans of [{ capped: true }, { short: true }, { __status: 404, error: 'not_found' }]) {
      const p = withDoor({ lang: 'en', store: store(PD), api: { 'practice/start': ans } });
      p.els['#wq-pd-go'].fire('click');
      await flush(); await flush();
      expect(p.toasts().length).toBe(1);
      expect(p.html()).toContain('id="wq-pd-go"');
    }
  });
});
