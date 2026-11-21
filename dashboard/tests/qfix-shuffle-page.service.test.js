/**
 * Each sitting its own order, on the page (web_quiz_order_seed). The server's start reply carries the sitting's order
 * ({ q: [qid…], o: { qid: [slot…] } }); the page plays its questions in that order, shows each item's options in that
 * order, reads aloud what it shows, keeps the order for a reload, and numbers a classmate's pulse by its own order.
 * No order in the reply (switch off): the quiz exactly as served.
 *
 * Runs the WHOLE shipped page (public/wq/wq.js) in the shared vm harness; the network is the faked boundary.
 */
const { page, flush } = require('./wq-page-harness');

const opt4 = (n) => ['A', 'B', 'C', 'D'].map((slot) => ({ slot, text: `${slot.toLowerCase()}${n}` }));
const QUESTIONS = [
  { qid: 'q1', text: 'First stem?', options: opt4(1), correct_slot: 'B', read: { opts: ['say a1', 'say b1', 'say c1', 'say d1'] } },
  { qid: 'q2', text: 'Second stem?', options: opt4(2), correct_slot: 'B' },
  { qid: 'q3', text: 'Third stem?', options: opt4(3), correct_slot: 'B' },
];
const ORDER = { q: ['q3', 'q1', 'q2'], o: { q1: ['C', 'A', 'D', 'B'] } };
const CHILD = { chip: 'c-sara', first: 'Sara', animal: 'cat' };

// A page that arrives from a finished sitting ("play again", the wq_from handover) and starts a new one.
function arrive(reply) {
  return page({
    lang: 'en', questions: JSON.parse(JSON.stringify(QUESTIONS)),
    store: { wq_from: { code: 'TEST', st: 'old-st', at: Date.now() } },
    api: { '/api/wq/session': { st: 'new-st', child: CHILD, resume: { answered: [] }, ...reply } },
  });
}
const stemOf = (html) => (/(First|Second|Third) stem\?/.exec(html) || [])[0];
const optionOrder = (html) => [...html.matchAll(/data-slot="([A-D])"/g)].map((m) => m[1]);

describe('switch on: the start reply carries the sitting order', () => {
  test('the questions play in the sitting order, and an item\'s options sit in its own order', async () => {
    const p = arrive({ order: ORDER });
    await flush(); await flush();
    expect(stemOf(p.html())).toBe('Third stem?');
    p.wq.question(1);
    expect(stemOf(p.html())).toBe('First stem?');
    expect(optionOrder(p.html())).toEqual(['C', 'A', 'D', 'B']);
    p.wq.question(2);
    expect(optionOrder(p.html())).toEqual(['A', 'B', 'C', 'D']); // an item with no option order keeps its own
  });

  test('the spoken option list moves with the options, so the voice reads what each button shows', async () => {
    const p = arrive({ order: ORDER });
    await flush(); await flush();
    const q1 = JSON.parse(p.ctx.localStorage.getItem('wq_s_TEST'));
    expect(q1.order).toEqual(ORDER);
    const page2 = page({ lang: 'en', questions: JSON.parse(JSON.stringify(QUESTIONS)), store: { wq_s_TEST: q1 } });
    page2.wq.question(1);
    expect(optionOrder(page2.html())).toEqual(['C', 'A', 'D', 'B']); // a reload keeps the sitting's order
    const shown = page2.wq.QS.find((q) => q.qid === 'q1');
    expect(shown.options.map((o) => o.slot)).toEqual(['C', 'A', 'D', 'B']);
    expect(shown.read.opts).toEqual(['say c1', 'say a1', 'say d1', 'say b1']);
  });

  test('a later start with no order (another child, switch off) gives back the quiz as served', async () => {
    const p = arrive({ order: ORDER });
    await flush(); await flush();
    expect(stemOf(p.html())).toBe('Third stem?');
    const q1 = JSON.parse(p.ctx.localStorage.getItem('wq_s_TEST'));
    const again = page({ lang: 'en', questions: JSON.parse(JSON.stringify(QUESTIONS)),
      store: { wq_s_TEST: { ...q1, st: null, order: null }, wq_from: { code: 'TEST', st: 'new-st', at: Date.now() } },
      api: { '/api/wq/session': { st: 'third-st', child: CHILD, resume: { answered: [] } } } });
    await flush(); await flush();
    expect(stemOf(again.html())).toBe('First stem?');
  });

  test('a classmate\'s right answer is numbered by this child\'s own order; a question this child was not served is not shown', async () => {
    const p = arrive({ order: { q: ['q3', 'q1'], o: {} } });
    await flush(); await flush();
    expect(p.wq.pulseShow({ first: 'Ali', qn: 3, qid: 'q3', at: 9 })).toBe(true);
    expect(p.pulses().pop()).toBe('Ali got Q1 right ✓');
    p.wq.pulseFeed([{ first: 'Ali', qn: 2, qid: 'q2', at: 10 }]);
    expect(p.wq.PULSE.pend).toBeFalsy();
    p.wq.pulseFeed([{ first: 'Ali', qn: 3, qid: 'q3', at: 11 }]);
    expect(p.wq.PULSE.pend).toBeTruthy();
  });
});

describe('switch off: no order in the reply', () => {
  test('the quiz plays exactly as served, and the stored session carries no order', async () => {
    const off = arrive({});
    await flush(); await flush();
    expect(stemOf(off.html())).toBe('First stem?');
    expect(optionOrder(off.html())).toEqual(['A', 'B', 'C', 'D']);
    expect(JSON.parse(off.ctx.localStorage.getItem('wq_s_TEST')).order || null).toBeNull();
  });
});
