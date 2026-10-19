/**
 * «واٹس ایپ» (WhatsApp) is one word on a child's page: never «واٹس / ایپ» across a line. One helper holds it,
 * WQT.nowrap in public/wq/wq-tel.js (the one script every child page loads first), and each Urdu render site that
 * draws the word through innerHTML applies it. The shipped scripts run in a vm; only the browser is faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page } = require('./wq-page-harness');
const wqc = require('./wqc-page-harness');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const TEL = fs.readFileSync(path.join(WQ, 'wq-tel.js'), 'utf8');
const CSS = fs.readFileSync(path.join(WQ, 'wq.css'), 'utf8');
const HELD = '<span class="wqb-nowrap">واٹس ایپ</span>';

function tel() {
  const ctx = { window: {}, document: { getElementById: () => null } };
  vm.createContext(ctx);
  vm.runInContext(TEL, ctx);
  return ctx.window.WQT;
}

describe('WQT.nowrap (wq-tel.js)', () => {
  const { nowrap } = tel();

  test('nothing to hold: the same bytes back', () => {
    expect(nowrap('')).toBe('');
    expect(nowrap(null)).toBe('');
    expect(nowrap('Send /quiz on WhatsApp again.')).toBe('Send /quiz on WhatsApp again.');
    expect(nowrap('آپ کا براؤزر مائیک استعمال نہیں کر سکتا۔')).toBe('آپ کا براؤزر مائیک استعمال نہیں کر سکتا۔');
  });

  test('one «واٹس ایپ» with a space, or with a no-break space, becomes one unbreakable span', () => {
    expect(nowrap('گھر کے فون سے واٹس ایپ پر بھیجیں۔')).toBe(`گھر کے فون سے ${HELD} پر بھیجیں۔`);
    expect(nowrap('گھر کے فون سے واٹس ایپ پر بھیجیں۔')).toBe(`گھر کے فون سے ${HELD} پر بھیجیں۔`);
  });

  test('two in a line: both held', () => {
    expect(nowrap('واٹس ایپ دبائیں، پھر واٹس ایپ میں چیٹ چنیں۔')).toBe(`${HELD} دبائیں، پھر ${HELD} میں چیٹ چنیں۔`);
  });

  test('already held: no second span (run twice, the same)', () => {
    const once = nowrap('واٹس ایپ پر ⁦/quiz⁩ بھیجیں۔');
    expect(nowrap(once)).toBe(once);
    expect(nowrap(`پہلے ${HELD} اور پھر واٹس ایپ`)).toBe(`پہلے ${HELD} اور پھر ${HELD}`);
    expect(nowrap('<span class="wqb-nowrap">واٹس ایپ</span>')).toBe(HELD);
  });

  test('escaped HTML around it is untouched', () => {
    const esc = '&lt;b&gt; &amp; &quot;x&quot; &#39;y&#39; <bdi dir="ltr" class="wqb-chip">/quiz</bdi> واٹس ایپ';
    expect(nowrap(esc)).toBe(`&lt;b&gt; &amp; &quot;x&quot; &#39;y&#39; <bdi dir="ltr" class="wqb-chip">/quiz</bdi> ${HELD}`);
  });

  test('the span\'s rule is in wq.css, the stylesheet every child page loads', () => {
    expect(CSS).toMatch(/\.wqb-nowrap\{white-space:nowrap\}/);
  });
});

describe('the quiz page share screen (wq.js fallback: fbT / fbSub / fbWa)', () => {
  const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
  const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
  const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
  const share = (opts, off) => {
    const p = page({ store: finished(), ...opts });
    if (off) p.ctx.window.WQT.nowrap = undefined;
    p.els['#wq-chal'].fire('click');
    expect(p.moment()).toBe('M12-fallback');
    return p.html();
  };

  test('Urdu: the heading, the line and the button hold «واٹس ایپ»; nothing else changes', () => {
    const h = share({ lang: 'ur' });
    expect(h).toContain(`<h2>${HELD} پر بھیجیں</h2>`);
    expect(h).toContain(`<p class="wq-sub">${HELD} والا بٹن دبائیں، پھر چیٹ چنیں۔</p>`);
    expect(h).toMatch(new RegExp(`id="wq-wa" href="[^"]+">${HELD} پر بھیجیں</a>`));
    expect(h.split(HELD).join('واٹس ایپ')).toBe(share({ lang: 'ur' }, true));
  });

  test('Urdu polish copy (the shorter fbSub): held too', () => {
    const h = share({ lang: 'ur', bootExtra: { ui: { ur2: true } } });
    expect(h).toContain(`<p class="wq-sub">${HELD} دبائیں، پھر گروپ چنیں۔</p>`);
  });

  test('English: byte-identical to the screen without the helper', () => {
    const h = share({ lang: 'en' });
    expect(h).not.toContain('wqb-nowrap');
    expect(h).toBe(share({ lang: 'en' }, true));
  });
});

describe('the challenge page, no microphone (wq-challenge.js noMic)', () => {
  const routes = { 'ch/HUB.TOKEN/read': wqc.ok(wqc.READ) };
  const noMic = async (lang, off) => {
    const pre = off ? [TEL, 'window.WQT.nowrap = undefined;'] : [TEL];
    const p = wqc.page({ lang, media: 'deny', routes, pre });
    await p.click('wqc-ex-read');
    await p.click('wqc-go');
    expect(p.screen()).toBe('no-mic');
    return p.root.innerHTML;
  };

  test('Urdu: the bubble holds «واٹس ایپ»; nothing else changes', async () => {
    const h = await noMic('ur');
    expect(h).toContain(`آپ کا ${HELD} براؤزر مائیک استعمال نہیں کر سکتا۔`);
    expect(h.split(HELD).join('واٹس ایپ')).toBe(await noMic('ur', true));
  });

  test('English: byte-identical to the screen without the helper', async () => {
    const h = await noMic('en');
    expect(h).toContain("Your WhatsApp browser can&#39;t use the microphone.");
    expect(h).toBe(await noMic('en', true));
  });
});
