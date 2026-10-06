/**
 * Web quiz page — M17 peer pulse: "Sara got Q4 right ✓" while classmates play.
 *
 * Runs the WHOLE shipped page (public/wq/wq.js) in the shared vm harness. The network (fetch) and
 * the clock (Date.now, setTimeout, setInterval) are the faked boundaries; the page's own answer
 * flush, question screen and poll run for real.
 */
const vm = require('vm');
const { page, rule, flush } = require('./wq-page-harness');

const SARA = { first: 'Sara', qn: 4, at: 5000 };

// A page on question 1 with a session, a controllable clock and captured timers.
function onQuestion(opts = {}, answers = { recorded: ['q1'], dup: [], unknown: [], pulse: [SARA] }) {
  const polls = [];
  const p = page({ lang: 'en', grade: 3, ...opts, api: { '/api/wq/answers': answers, '/api/wq/pulse/': (url) => { polls.push(url); return { pulse: [SARA] }; }, ...(opts.api || {}) } });
  const timers = [];
  const intervals = [];
  p.ctx.setTimeout = (fn, ms) => { timers.push({ fn, at: clock.t + ms }); return timers.length; };
  p.ctx.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  p.ctx.clearInterval = () => {};
  const clock = { t: 1_000_000 };
  p.ctx.__now = () => clock.t;
  vm.runInContext('Date.now = function () { return __now(); };', p.ctx);
  const opt = { listeners: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, getAttribute: () => 'A', setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } };
  p.root.querySelectorAll = (sel) => (sel === '.wq-opt' ? [opt] : []);
  p.wq.S.st = 'session-token';
  p.wq.question(0);
  const advance = (ms) => {
    clock.t += ms;
    timers.filter((x) => !x.done && x.at <= clock.t).forEach((x) => { x.done = true; x.fn(); });
  };
  const tick = () => intervals.forEach((x) => x.fn()); // one poll period elapsed
  const answer = () => opt.listeners.click.forEach((fn) => fn({}));
  const sent = () => p.fetches.filter((f) => f.url.indexOf('/api/wq/answers') >= 0).map((f) => JSON.parse(f.init.body));
  return { ...p, clock, advance, tick, answer, sent, polls, intervals };
}

describe('M17 peer pulse on the page', () => {
  test('grade 3: a classmate\'s right answer from the /answers response shows once the question is 3 s old, never before', async () => {
    const p = onQuestion();
    p.advance(1000); // 1 s into the question
    p.answer();
    await flush(); await flush();
    expect(p.sent()[0]).toMatchObject({ st: 'session-token', since: 0 });
    expect(p.pulses()).toEqual([]); // never in the first 3 s
    p.advance(2100);
    expect(p.pulses()).toEqual(['Sara got Q4 right ✓']);
  });

  test('at most one pulse per 20 s; the idle poll runs only on an unanswered question, at most 8 times', async () => {
    const p = onQuestion();
    p.advance(15000);
    p.tick();
    await flush(); await flush();
    expect(p.polls).toHaveLength(1);
    expect(p.polls[0]).toMatch(/\/api\/wq\/pulse\/TEST\?st=session-token&since=0$/);
    expect(p.pulses()).toEqual(['Sara got Q4 right ✓']);
    p.advance(15000);
    p.tick();
    await flush(); await flush();
    expect(p.polls[1]).toMatch(/since=5000$/);
    expect(p.pulses()).toHaveLength(1); // 15 s after the first: held back
    p.advance(5100);
    expect(p.pulses()).toHaveLength(2); // 20 s after the first
    for (let i = 0; i < 10; i += 1) { p.advance(15000); p.tick(); await flush(); }
    expect(p.polls).toHaveLength(8);
  });

  test('an answered question stops polling', async () => {
    const p = onQuestion();
    p.advance(2000); p.answer(); await flush(); await flush();
    p.advance(15000); p.tick(); await flush();
    expect(p.polls).toHaveLength(0);
  });

  test('grade 1: no pulse and no poll (the child follows the voice and the pictures)', async () => {
    const p = onQuestion({ grade: 1 });
    p.advance(1000);
    p.answer();
    await flush(); await flush();
    p.advance(30000);
    p.tick();
    await flush();
    expect(p.pulses()).toEqual([]);
    expect(p.polls).toHaveLength(0);
    expect(p.intervals).toHaveLength(0);
  });

  test.each([['KG'], ['NURSERY'], ['PG'], ['1-2'], ['2']])('early years (grade %s): no pulse and no poll', async (grade) => {
    const p = onQuestion({ grade });
    p.advance(4000); p.answer(); await flush(); await flush(); p.advance(30000); p.tick(); await flush();
    expect(p.pulses()).toEqual([]);
    expect(p.intervals).toHaveLength(0);
  });

  test.each([['3'], ['Grade 4'], ['3-5']])('grade %s: on', async (grade) => {
    const p = onQuestion({ grade });
    p.advance(4000); p.answer(); await flush(); await flush(); p.advance(100);
    expect(p.pulses()).toEqual(['Sara got Q4 right ✓']);
  });

  test("an invited friend's page never polls and never shows classmates", async () => {
    const p = onQuestion({ challenge: { first: 'Ali', correct: 4, total: 5 } });
    p.advance(4000); p.answer(); await flush(); await flush(); p.advance(30000); p.tick(); await flush();
    expect(p.pulses()).toEqual([]);
    expect(p.intervals).toHaveLength(0);
  });

  test('teacher preview and a quiet page (🔕) show no pulse; unknown grade does', async () => {
    const pv = onQuestion({ preview: true });
    pv.advance(4000); pv.answer(); await flush(); await flush(); pv.advance(4000);
    expect(pv.pulses()).toEqual([]);
    const quiet = onQuestion({ store: { wq_sound: false } });
    quiet.advance(4000); quiet.answer(); await flush(); await flush(); quiet.advance(4000);
    expect(quiet.pulses()).toEqual([]);
    const unknown = onQuestion({ grade: null });
    unknown.advance(4000); unknown.answer(); await flush(); await flush(); unknown.advance(100);
    expect(unknown.pulses()).toEqual(['Sara got Q4 right ✓']);
  });

  test('an invited friend is "A friend"; Urdu copy', async () => {
    const en = onQuestion({}, { recorded: ['q1'], pulse: [{ first: null, invited: true, qn: 2, at: 9 }] });
    en.advance(4000); en.answer(); await flush(); await flush();
    expect(en.pulses()).toEqual(['A friend got Q2 right ✓']);
    const ur = onQuestion({ lang: 'ur' }, { recorded: ['q1'], pulse: [{ first: 'سارہ', qn: 4, at: 9 }] });
    ur.advance(4000); ur.answer(); await flush(); await flush();
    expect(ur.pulses()).toEqual(['سارہ نے سوال 4 ٹھیک کیا ✓']);
    const urf = onQuestion({ lang: 'ur' }, { recorded: ['q1'], pulse: [{ first: null, invited: true, qn: 4, at: 9 }] });
    urf.advance(4000); urf.answer(); await flush(); await flush();
    expect(urf.pulses()).toEqual(['ایک دوست نے سوال 4 ٹھیک کیا ✓']);
  });

  test('a pulse that would cover content is held, then shown 3 s into the NEXT question', async () => {
    const p = onQuestion();
    // The page is scrolled (feedback scrolls "Next" into view on a tall question): the bar is off screen.
    p.root.querySelector('.wq-bar').getBoundingClientRect = () => ({ top: -240, bottom: -192, height: 48 });
    p.advance(4000); p.answer(); await flush(); await flush();
    expect(p.pulses()).toEqual([]); // skipped, never drawn over the options
    // Next question: back at the top.
    p.root.querySelector('.wq-bar').getBoundingClientRect = () => ({ top: 12, bottom: 60, height: 48 });
    p.wq.question(0);
    p.advance(1000);
    expect(p.pulses()).toEqual([]); // never in the first 3 s
    p.advance(2100);
    expect(p.pulses()).toEqual(['Sara got Q4 right ✓']);
  });

  test('a held pulse older than 60 s is dropped', async () => {
    const p = onQuestion();
    p.root.querySelector('.wq-bar').getBoundingClientRect = () => ({ top: -240, bottom: -192, height: 48 });
    p.advance(4000); p.answer(); await flush(); await flush();
    p.root.querySelector('.wq-bar').getBoundingClientRect = () => ({ top: 12, bottom: 60, height: 48 });
    p.advance(61000); // the child sat on the feedback for a minute
    p.wq.question(0);
    p.advance(3100);
    expect(p.pulses()).toEqual([]);
  });

  test('a drawn strip hides on the first scroll (it is fixed, so it would slide over the stem)', async () => {
    const p = onQuestion();
    p.advance(4000); p.answer(); await flush(); await flush();
    const [strip] = p.pulseEls();
    expect(strip).toBeDefined();
    expect(strip.hidden).toBeFalsy();
    (p.winListeners.scroll || []).forEach((fn) => fn({}));
    expect(strip.hidden).toBe(true);
  });

  test('the strip never takes a tap, is fixed (no layout shift) and at most 28 px tall', () => {
    const css = rule('.wq-pulse');
    expect(css).toMatch(/pointer-events:none/);
    expect(css).toMatch(/position:fixed/);
    expect(Number(/height:(\d+)px/.exec(css)[1])).toBeLessThanOrEqual(28);
  });
});
