/**
 * The polished Urdu copy (app_settings web_quiz_ur_polish → the edge's `wq-ur2` class on <html>): shorter lines in a
 * child's words, Western digits isolated left to right, one word for "done". Off (no class), every string is today's.
 * The page script is run whole in the vm harness; the class is the only switch the page reads.
 */
const { page, flush } = require('./wq-page-harness');

const ON = { ui: { ur2: true } };
const store = () => ({ wq_s_TEST: { st: 's1', child: { chip: 'c1', first: 'زمزم', animal: 'owl' }, answers: {}, queue: [] } });
const LONG = 'یہ ایک Proper Fraction ہے کیونکہ numerator denominator سے بڑا ہے اور یہ بہت لمبا جواب ہے';   // > 40 code points
const SHORT = 'جڑ';
const qs = () => [{ qid: 'q1', text: 'کون سا؟', options: [{ slot: 'A', text: LONG }, { slot: 'B', text: SHORT }], correct_slot: 'A' }];

describe('the landing and identity copy under the class', () => {
  test('on: the landing meta is «5 سوال، 3 منٹ» with the numbers isolated, the teacher line and the class on two lines', () => {
    const p = page({ lang: 'ur', cls: { label: 'جماعت 3', teacher: 'استاد Testwala', chips: [] }, bootExtra: ON, questions: Array.from({ length: 5 }, (_, i) => ({ qid: 'q' + i, text: 'a?', options: [{ slot: 'A', text: 'x' }], correct_slot: 'A' })) });
    p.ctx.__wq.landing();
    const h = p.html();
    expect(h).toContain('<p class="wq-small">⁦5⁩ سوال، ⁦3⁩ منٹ</p>');
    expect(h).not.toContain('تقریباً');
    expect(h).toContain('کی طرف سے\nجماعت 3</p>');
    expect(h).toContain('<div class="wq-say">السلام علیکم! کوئز کھیلیں؟</div>');
  });
  test('off: the same screen is today\'s, word for word', () => {
    const p = page({ lang: 'ur', cls: { label: 'جماعت 3', teacher: 'استاد Testwala', chips: [] } });
    p.ctx.__wq.landing();
    const h = p.html();
    expect(h).toContain('تقریباً');
    expect(h).toContain(' · جماعت 3</p>');
    expect(h).toContain('<div class="wq-say">السلام علیکم! آئیں، کوئز کھیلیں۔</div>');
  });
  test('an English page never changes with ui.ur2', () => {
    const p = page({ lang: 'en', bootExtra: ON });
    p.ctx.__wq.landing();
    expect(p.html()).toContain('1 question · about 1 minute');
  });
});

describe('the question screen under the class', () => {
  test('the counter reads «1 میں سے سوال 1» (Western digits, isolated), and a label over 40 code points gets wq-long', () => {
    const p = page({ lang: 'ur', bootExtra: ON, questions: qs() });
    p.ctx.__wq.question(0);
    const h = p.html();
    expect(h).toContain('⁦1⁩ میں سے سوال ⁦1⁩');
    expect(h).not.toContain(' از ');
    expect(h).toMatch(/class="wq-opt wq-s1 wq-long"[^>]*data-slot="A"/);
    expect(h).toMatch(/class="wq-opt wq-s2"[^>]*data-slot="B"/);
  });
  test('off: «سوال 1 از 1» and no wq-long', () => {
    const p = page({ lang: 'ur', questions: qs() });
    p.ctx.__wq.question(0);
    expect(p.html()).toContain('سوال 1 از 1');
    expect(p.html()).not.toContain('wq-long');
  });
});

describe('the share prose under the class', () => {
  test('the challenge line carries Western digits inside isolates and the approved sentence shape', () => {
    const p = page({ lang: 'ur', bootExtra: ON });
    const line = p.ctx.__wq.T.chalLine('زمزم', 8, 10, 'پودے');
    expect(line).toContain('⁦10⁩ میں سے ⁦8⁩ ستارے لیے۔ مجھ سے آگے نکل کر دکھائیں!');
    expect(line).not.toMatch(/[۰-۹]/);
    expect([...line].length).toBeLessThan(200);
  });
  test('off: the line keeps its Urdu digits', () => {
    const p = page({ lang: 'ur' });
    expect(p.ctx.__wq.T.chalLine('زمزم', 8, 10, 'پودے')).toMatch(/[۰-۹]/);
  });
});

describe('every polished string is a child\'s, gender-neutral and short', () => {
  test('no masculine/feminine split verb forms, no «ٹیپ کریں», no adult words; the hub door is «میرے کوئز اور ویڈیوز»', () => {
    const T = page({ lang: 'ur', bootExtra: ON }).ctx.__wq.T;
    const T0 = page({ lang: 'ur' }).ctx.__wq.T;
    // the overlay = every key whose value differs from today's map
    const changed = Object.keys(T).filter((k) => String(T[k]) !== String(T0[k]));
    expect(changed.length).toBeGreaterThan(30);
    const all = changed.map((k) => (typeof T[k] === 'function' ? T[k]('ن', 1, 2, 'ت') : typeof T[k] === 'string' ? T[k] : JSON.stringify(T[k]))).join('\n');
    // a person is always addressed as آپ: no masculine/feminine verb agreement on the child, no «ٹیپ», no adult words
    expect(all).not.toMatch(/رہا ہے|رہی ہے|کریں گی|کرے گا|کرے گی|ٹیپ|تقریباً|جشن|ہم جماعت/);
    expect(T.whoT).toBe('آج کس کی باری ہے؟');
    expect(T.hubDoor).toBe('میرے کوئز اور ویڈیوز');
    expect(T.again).toBe('یہ سوال آخر میں پھر آئے گا۔');
    expect([...T.again].length).toBeLessThanOrEqual(30);
  });
});
