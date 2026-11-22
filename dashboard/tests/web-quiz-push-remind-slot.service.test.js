/**
 * The results screen's "remind me tomorrow" slot (finish's push_remind, app_settings web_quiz_push_remind): an empty
 * slot BELOW every door, and wq-remind.js loaded only after the screen has painted (a timer, never in the render).
 * Without push_remind the screen is today's, byte for byte, and no script is asked for. Fake DOM (wq-page-harness.js).
 */
const { page, flush } = require('./wq-page-harness');

const Q3 = [1, 2, 3].map((n) => ({
  qid: `q${n}`, text: `Q${n}?`, options: [{ slot: 'A', text: 'x' }, { slot: 'B', text: 'y' }], correct_slot: 'A',
  img: `https://cdn.test/q${n}.png`,
  audio: { q: `https://r2.test/q${n}-stem.ogg`, opts: [`https://r2.test/q${n}-a.ogg`, null], why: `https://r2.test/q${n}-why.ogg` },
}));

// A child who answered all three (two right) on this phone, with the last answer still queued.
function played(extra = {}) {
  return {
    st: 'ST1', child: { first: 'Ali', chip: 'c1', animal: 'owl' }, seq: 3, wrong: ['q2'], result: null,
    answers: { q1: { slot: 'A', ok: true }, q2: { slot: 'B', ok: false }, q3: { slot: 'A', ok: true } },
    queue: [{ qid: 'q3', slot: 'A', ms: 900, seq: 3 }], ...extra,
  };
}

const OFFLINE = { __offline: true };
const FINISHED = { score: { correct: 2, total: 3, pct: 67, level: 'developing' }, counted: true, card: { first: 'Ali', animal: 'owl', correct: 2, total: 3, stars: 2 } };
const settle = async () => { for (let i = 0; i < 8; i += 1) await flush(); };

const net = (finished) => ({ '/api/wq/answers': () => ({ recorded: ['q3'], dup: [], unknown: [] }), '/api/wq/finish': () => finished });
const scripts = (p) => p.ctx.__made.filter((e) => /wq-remind\.js/.test(String(e.src || '')));

function run(lang, finished, extra = {}) {
  const p = page({ lang, questions: Q3, store: { wq_s_TEST: played() }, api: net(finished), ...extra });
  const made = [];
  const create = p.ctx.document.createElement;
  p.ctx.document.createElement = (t) => { const e = create(t); made.push(e); return e; };
  p.ctx.document.querySelector = () => ({ getAttribute: () => '/wq/wq.js?v=abc123' });
  p.ctx.__made = made;
  p.ctx.requestAnimationFrame = (fn) => p.ctx.setTimeout(fn, 16); // a painted frame, as a browser has
  return p;
}

for (const lang of ['en', 'ur']) {
  test(`${lang}: push_remind on → the slot sits after the primary and the doors; the script waits for a timer`, async () => {
    const p = run(lang, { ...FINISHED, push_remind: true });
    p.wq.results(0);
    await settle();
    const h = p.html();
    expect(p.moment()).toBe('M9');
    expect(h).toContain('<div id="wq-remind"></div>');
    expect(h.indexOf('<div id="wq-remind"></div>')).toBeGreaterThan(h.indexOf('id="wq-card"'));
    expect(h.endsWith('<div id="wq-remind"></div></section>')).toBe(true);
    expect(scripts(p)).toHaveLength(0);
    p.runTimers();
    p.runTimers();
    expect(scripts(p).map((e) => e.src)).toEqual(['/wq/wq-remind.js?v=abc123']);
  });

  test(`${lang}: no push_remind → today's screen, no slot, no script`, async () => {
    const on = run(lang, { ...FINISHED, push_remind: true });
    const off = run(lang, FINISHED);
    on.wq.results(0);
    off.wq.results(0);
    await settle();
    expect(off.html()).not.toContain('wq-remind');
    // the same screen without the slot (Jugnu's spoken line is picked at random, so it is masked)
    const mask = (h) => h.replace(/<div class="wq-say">[\s\S]*?<\/div>/, '');
    expect(mask(on.html().replace('<div id="wq-remind"></div>', ''))).toBe(mask(off.html()));
    off.runTimers();
    off.runTimers();
    expect(scripts(off)).toHaveLength(0);
  });
}

test('an invited friend\'s run never gets the slot', async () => {
  const p = run('en', { ...FINISHED, push_remind: true }, { bootExtra: { invited: true } });
  p.wq.results(0);
  await settle();
  expect(p.html()).not.toContain('wq-remind');
});
