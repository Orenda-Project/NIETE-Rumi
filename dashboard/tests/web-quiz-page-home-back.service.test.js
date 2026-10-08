/**
 * The quiz page's always-visible Home button (boot nav.home, app_settings web_quiz_home_button) and the
 * step-back navigation (boot nav.back, app_settings web_quiz_back_nav): a visible Back to the previous
 * question as a read-only review, and the phone's Back walking the same steps instead of leaving.
 * Runs the whole shipped page in the harness's vm; the bot API (fetch) is the faked boundary.
 */
const { page, flush, CSS } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const QS = [
  { qid: 'q1', text: 'One?', options: [{ slot: 'A', text: 'yes' }, { slot: 'B', text: 'no' }], correct_slot: 'A', why: 'Because one.' },
  { qid: 'q2', text: 'Two?', options: [{ slot: 'A', text: 'yes' }, { slot: 'B', text: 'no' }], correct_slot: 'B', why: 'Because two.' },
  { qid: 'q3', text: 'Three?', options: [{ slot: 'A', text: 'yes' }, { slot: 'B', text: 'no' }], correct_slot: 'A', why: 'Because three.' },
];
const NAV = { nav: { home: true, back: true } };
const playing = (answers = {}, queue = []) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers, queue, wrong: [] } });
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 3, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 3 } };
const DOOR = { hubdoor: { href: '/h/abc.DEF_12' } };
const evs = (p) => p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events);
const homeEl = (p) => /id="wq-home"/.test(p.html());

describe('the Home button (nav.home)', () => {
  test('on a question: in the top bar, after the sound button, a labelled button', () => {
    const p = page({ lang: 'en', questions: QS, store: playing(), bootExtra: NAV });
    p.wq.question(0, false);
    const h = p.html();
    expect(homeEl(p)).toBe(true);
    expect(h.indexOf('id="wq-snd"')).toBeGreaterThan(-1);
    expect(h.indexOf('id="wq-home"')).toBeGreaterThan(h.indexOf('id="wq-snd"'));
    expect(h).toMatch(/id="wq-home"[^>]*aria-label="Home"/);
    // the progress dots leave the bar for their own row
    expect(h.indexOf('wq-dots')).toBeGreaterThan(h.indexOf('id="wq-home"'));
  });

  test('Urdu: «ہوم», and the bar is the same flex row (mirrored by dir=rtl)', () => {
    const p = page({ lang: 'ur', questions: QS, store: playing(), bootExtra: NAV });
    p.wq.question(0, false);
    expect(p.html()).toMatch(/id="wq-home"[^>]*aria-label="ہوم"/);
  });

  test('a big target: at least 48 px each way', () => {
    const m = /\.wq-home\{[^}]*\}/.exec(CSS);
    expect(m).not.toBeNull();
    expect(Number((/min-width:(\d+)px/.exec(m[0]) || [])[1])).toBeGreaterThanOrEqual(48);
    expect(Number((/min-height:(\d+)px/.exec(m[0]) || [])[1])).toBeGreaterThanOrEqual(48);
  });

  test('switch off (no nav): no Home button — today\'s page', () => {
    const p = page({ lang: 'en', questions: QS, store: playing() });
    p.wq.question(0, false);
    expect(homeEl(p)).toBe(false);
  });

  test('before a child is chosen (no session): no Home', () => {
    const p = page({ lang: 'en', questions: QS, bootExtra: NAV });
    expect(p.moment()).toBe('M3');
    expect(homeEl(p)).toBe(false);
  });

  test('a friend\'s challenge run has no hub of its own: no Home', () => {
    const p = page({ lang: 'en', questions: QS, store: playing(), bootExtra: { ...NAV, invited: true } });
    p.wq.question(0, false);
    expect(homeEl(p)).toBe(false);
  });

  test('during play a tap asks first (a tap, never automatic); "Keep playing" stays on the question', () => {
    const p = page({ lang: 'en', questions: QS, store: playing(), bootExtra: NAV, api: DOOR });
    p.wq.question(0, false);
    p.els['#wq-home'].fire('click');
    expect(p.html()).toContain('Go to your home page?');
    expect(p.fetches.some((f) => f.url.indexOf('/hubdoor') >= 0)).toBe(false);
    p.els['#wq-stay'].fire('click');
    expect(p.html()).not.toContain('Go to your home page?');
    expect(p.moment()).toBe('M6');
  });

  test('"Go home": sends what is unsent FIRST, then the door (with home), then opens the hub (?from=home)', async () => {
    let answered = false;
    const p = page({ lang: 'en', questions: QS, store: playing({ q1: { slot: 'A', ok: true } }, [{ qid: 'q1', slot: 'A', ms: 9, seq: 1 }]), bootExtra: NAV,
      api: { answers: () => { answered = true; return { recorded: ['q1'] }; }, hubdoor: (u, init) => ({ href: answered ? '/h/abc.DEF_12' : '/h/early.EARLY_0', got: init.body }) } });
    p.wq.question(1, false);
    p.els['#wq-home'].fire('click');
    expect(p.html()).toContain('Saving your answers');
    p.els['#wq-gohome'].fire('click');
    for (let k = 0; k < 6; k += 1) await flush();
    const urls = p.fetches.map((f) => f.url);
    expect(urls.indexOf('/api/wq/answers')).toBeGreaterThan(-1);
    expect(urls.indexOf('/api/wq/hubdoor')).toBeGreaterThan(urls.indexOf('/api/wq/answers'));
    expect(JSON.parse(p.fetches.find((f) => f.url === '/api/wq/hubdoor').init.body)).toEqual({ st: 's1', home: 1 });
    expect(p.hist.assigned).toEqual(['/h/abc.DEF_12?from=home']);
  });

  test('the sheet says the answers are saved only when nothing is waiting to be sent', () => {
    const p = page({ lang: 'en', questions: QS, store: playing(), bootExtra: NAV });
    p.wq.question(0, false);
    p.els['#wq-home'].fire('click');
    expect(p.html()).toContain('Your answers are saved.');
    expect(p.html()).not.toContain('Saving your answers');
  });

  test('offline at "Go home": the page stays, says so, and nothing is lost', async () => {
    const p = page({ lang: 'en', questions: QS, store: playing(), bootExtra: NAV, api: { hubdoor: { __offline: true } } });
    p.wq.question(0, false);
    p.els['#wq-home'].fire('click');
    p.els['#wq-gohome'].fire('click');
    for (let k = 0; k < 4; k += 1) await flush();
    expect(p.hist.assigned).toEqual([]);
    expect(p.toasts().length).toBe(1);
  });

  test('on the results card Home goes straight to the door (no question to lose), and the tap is counted with how', async () => {
    const p = page({ lang: 'en', questions: QS, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } }, bootExtra: NAV, api: DOOR });
    expect(p.moment()).toBe('M10');
    expect(homeEl(p)).toBe(true);
    p.els['#wq-home'].fire('click');
    for (let k = 0; k < 4; k += 1) await flush();
    expect(p.hist.assigned).toEqual(['/h/abc.DEF_12?from=home']);
    expect(evs(p).find((e) => e.n === 'home_tap')).toMatchObject({ src: 'm10', how: 'door' });
  });
});

describe('Back to the previous question (nav.back)', () => {
  test('question 2 shows a Back pill; question 1 without a video does not', () => {
    const p = page({ lang: 'en', questions: QS, store: playing({ q1: { slot: 'B', ok: false } }), bootExtra: NAV });
    p.wq.question(1, false);
    expect(p.html()).toContain('id="wq-qback"');
    p.wq.question(0, false);
    expect(p.html()).not.toContain('id="wq-qback"');
  });

  test('question 1 of a quiz with a video: Back goes to the video', () => {
    const p = page({ lang: 'en', questions: QS, store: playing(), bootExtra: NAV, video: { url: 'https://v.example/a.mp4' } });
    p.wq.question(0, false);
    expect(p.html()).toContain('id="wq-qback"');
    p.els['#wq-qback'].fire('click');
    expect(p.moment()).toBe('M5');
  });

  test('Back shows question 1 exactly as answered — locked, the first answer marked, the banner — and changes nothing', () => {
    const store = playing({ q1: { slot: 'B', ok: false } });
    const p = page({ lang: 'en', questions: QS, store, bootExtra: NAV });
    p.wq.question(1, false);
    p.els['#wq-qback'].fire('click');
    expect(p.moment()).toBe('M6-review');
    const h = p.html();
    expect(h).toContain('You are looking at question 1 again. Your first answer is the one that counts.');
    expect(h).toContain('One?');
    expect(h).toContain('Back to question 2');
    // a tap on an option does nothing: no answer stored, nothing queued, nothing sent
    const before = JSON.stringify(p.wq.S.answers);
    (p.els['.wq-opt'] && p.els['.wq-opt'].fire('click'));
    expect(JSON.stringify(p.wq.S.answers)).toBe(before);
    expect(p.wq.S.queue).toEqual([]);
    expect(p.fetches.some((f) => f.url === '/api/wq/answers')).toBe(false);
    p.els['#wq-revnext'].fire('click');
    expect(p.moment()).toBe('M6');
    expect(p.html()).toContain('Two?');
  });

  test('the phone\'s Back walks the same steps: question 3 → review 2 → review 1 → the Home sheet; the page never closes', () => {
    const p = page({ lang: 'en', questions: QS, store: playing({ q1: { slot: 'A', ok: true }, q2: { slot: 'B', ok: true } }), bootExtra: NAV });
    p.tap();
    p.wq.question(2, false);
    p.back();
    expect(p.moment()).toBe('M6-review');
    expect(p.html()).toContain('question 2 again');
    p.back();
    expect(p.html()).toContain('question 1 again');
    p.tap();
    p.back();
    expect(p.html()).toContain('Go to your home page?');
    expect(p.hist.backs).toBe(0);
  });

  test('two Backs in a row without a tap both stay on the page (two spare history entries during play)', () => {
    const p = page({ lang: 'en', questions: QS, store: playing({ q1: { slot: 'A', ok: true }, q2: { slot: 'B', ok: true } }), bootExtra: NAV });
    p.tap();
    p.wq.question(2, false);
    p.back();
    p.back();
    expect(p.hist.backs).toBe(0);
    expect(p.moment()).toBe('M6-review');
  });

  test('on the results card the phone\'s Back offers Home instead of closing the page', () => {
    const p = page({ lang: 'en', questions: QS, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } }, bootExtra: NAV });
    p.tap();
    p.back();
    expect(p.hist.backs).toBe(0);
    expect(p.html()).toContain('Go to your home page?');
  });

  test('Urdu review copy is Urdu and gender-neutral', () => {
    const p = page({ lang: 'ur', questions: QS, store: playing({ q1: { slot: 'A', ok: true } }), bootExtra: NAV });
    p.wq.question(1, false);
    p.els['#wq-qback'].fire('click');
    const h = p.html();
    expect(h).toContain('پہلا جواب ہی گنا جاتا ہے');
    expect(h).not.toMatch(/رہا|رہی|بیٹا|بیٹی/);
  });

  test('switch off: no Back pill, and the phone\'s Back is today\'s (warn, then leave)', () => {
    const p = page({ lang: 'en', questions: QS, store: playing({ q1: { slot: 'A', ok: true } }) });
    p.tap();
    p.wq.question(1, false);
    expect(p.html()).not.toContain('id="wq-qback"');
    p.back();
    expect(p.toasts()).toEqual(['Your answers are saved. Press back again to leave.']);
  });
});
