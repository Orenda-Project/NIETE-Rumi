/**
 * Web quiz page inside WhatsApp's in-app browser (an Android WebView): no share sheet of its own, a
 * hardware Back button that closes the browser when the page has no history, reloads mid-video.
 * Runs the whole shipped page in the harness's vm.
 */
const { page } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5 } };
const finished = () => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT } });
const waHref = (p) => {
  const m = /id="wq-wa" href="([^"]+)"/.exec(p.html());
  return m ? decodeURIComponent(m[1].replace(/&amp;/g, '&')) : null;
};

describe('the Android back button', () => {
  test('on a side screen it goes back to the screen the child came from, not out of the page', () => {
    const p = page({ lang: 'en' });
    p.tap();
    p.wq.who();
    expect(p.moment()).toBe('M4');
    p.back();
    expect(p.moment()).toBe('M3');
    expect(p.hist.backs).toBe(0);
  });

  test('on a question the first Back only warns (answers are saved); the page stays', () => {
    const p = page({ lang: 'en', store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [] } } });
    p.tap();
    p.wq.question(0, false);
    expect(p.moment()).toBe('M6');
    p.back();
    expect(p.moment()).toBe('M6');
    expect(p.hist.backs).toBe(0);
    expect(p.toasts()).toEqual(['Your answers are saved. Press back again to leave.']);
  });

  test('a second Back on a question leaves', () => {
    const p = page({ lang: 'en', store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [] } } });
    p.tap();
    p.wq.question(0, false);
    p.back();
    p.tap();
    p.back();
    expect(p.hist.backs).toBe(1);
  });

  test('on the share screen it returns to the card', () => {
    const p = page({ lang: 'en', store: finished() });
    p.tap();
    expect(p.moment()).toBe('M10');
    p.els['#wq-chal'].fire('click');
    expect(p.moment()).toBe('M12-fallback');
    p.back();
    expect(p.moment()).toBe('M10');
    expect(p.hist.backs).toBe(0);
  });

  test('on the card (the end) Back leaves the page', () => {
    const p = page({ lang: 'en', store: finished() });
    p.tap();
    p.back();
    expect(p.hist.backs).toBe(1);
  });
});

describe('sharing from the card without a share sheet', () => {
  test('"Share to class group" sends the CLASS link, so classmates count in the teacher\'s report', () => {
    const p = page({ lang: 'en', store: finished() });
    p.els['#wq-share'].fire('click');
    const href = waHref(p);
    expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(href).toContain('https://example.test/q/TEST');
    expect(href).not.toContain('CHAL12');
  });

  test('"Challenge a friend" sends the child\'s own challenge code', () => {
    const p = page({ lang: 'en', store: finished() });
    p.els['#wq-chal'].fire('click');
    expect(waHref(p)).toContain('https://example.test/q/CHAL12');
  });

  test('the message preview keeps the link on its own left-to-right line (an Urdu message never scrambles it)', () => {
    const p = page({ lang: 'ur', store: finished() });
    p.els['#wq-chal'].fire('click');
    expect(p.html()).toMatch(/<p class="wq-url" dir="ltr">https:\/\/example\.test\/q\/CHAL12<\/p>/);
    expect(waHref(p)).toContain('https://example.test/q/CHAL12');
  });

  test('the WhatsApp button opens in the same view (no new tab: popups are unreliable in the in-app browser)', () => {
    const p = page({ lang: 'ur', store: finished() });
    p.els['#wq-chal'].fire('click');
    expect(p.html()).not.toMatch(/id="wq-wa"[^>]*target=/);
  });
});

describe('a reload in the middle of the lesson video', () => {
  const VIDEO = { url: 'https://r2.example/v.mp4' };
  test('the page remembers where the video was', () => {
    const p = page({ lang: 'en', video: VIDEO, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [] } } });
    p.wq.video();
    const vid = p.els['video'];
    vid.currentTime = 42.4;
    vid.fire('timeupdate');
    expect(p.wq.S.vt).toBe(42);
  });

  test('a pause keeps the exact second, between the every-few-seconds saves', () => {
    const p = page({ lang: 'en', video: VIDEO, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [] } } });
    p.wq.video();
    const vid = p.els['video'];
    vid.currentTime = 1.2; vid.fire('timeupdate');
    vid.currentTime = 3.6; vid.fire('timeupdate');
    expect(p.wq.S.vt).toBe(1);
    vid.fire('pause');
    expect(p.wq.S.vt).toBe(3);
  });

  test('after the reload the child continues the video where it was, without picking their name again', () => {
    const p = page({ lang: 'en', video: VIDEO, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], vt: 42 } } });
    expect(p.moment()).toBe('M3-continue');
    p.els['#wq-cont'].fire('click');
    expect(p.moment()).toBe('M5');
    expect(p.html()).toContain('src="https://r2.example/v.mp4#t=42"');
  });

  test('a skipped video does not come back after a reload', () => {
    const p = page({ lang: 'en', video: VIDEO, store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], vt: 42 } } });
    p.els['#wq-cont'].fire('click');
    p.els['#wq-skip'].fire('click');
    expect(p.wq.S.vdone).toBe(1);
    expect(p.moment()).toBe('M6');
  });
});

describe('small copy fixes on the after-quiz screens', () => {
  test('"today" shows the number once: the caption does not repeat it', () => {
    const p = page({ lang: 'en', store: finished() });
    p.ctx.__wq.today();
    const h = p.html();
    expect(h).toContain('children played today');
    expect(h).not.toMatch(/0 children in Islamabad played today/);
  });

  test('the league table\'s button after a finished quiz says where it goes ("My scores"), not just "Next"', async () => {
    const { flush } = require('./wq-page-harness');
    const p = page({ lang: 'ur', store: finished(), board: { finishers_n: 1, class_avg_pct: 60, rows: [] } });
    p.ctx.__wq.board();
    await flush();
    expect(p.html()).toMatch(/id="wq-next">میرے اسکور</);
  });

  test('a zero score is shared as "played", never as a score to beat', () => {
    const zero = { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: { ...RESULT, card: { ...RESULT.card, correct: 0, stars: 0 } } } };
    const p = page({ lang: 'en', store: zero });
    p.els['#wq-chal'].fire('click');
    const href = waHref(p);
    expect(href).toContain('Zara played Plants. Your turn!');
    expect(href).not.toContain('0/5');
  });
});
