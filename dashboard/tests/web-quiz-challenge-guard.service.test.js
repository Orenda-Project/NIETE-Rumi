/**
 * The read screen under the read guard (the exercise says guard:true, with its copy): a local microphone check
 * before the minute, no Done during it, "The rest is too hard" only after the first line's window, the story
 * revealed when the clock starts, no countdown, Home asks first, and a result that says how the reading ended.
 * Without the guard the page is today's. The whole shipped page runs in the harness's vm.
 */
const { page, ok, MENU, READ, READ_GUARD, COPY } = require('./wqc-page-harness');

const LINE1_MS = 20000;
const routes = (ex = READ_GUARD, result = { score: { correct: 42, stopped: false }, wcpm: 42, ended: 'timer' }) => ({
  'ch/HUB.TOKEN/read': ok(ex),
  'ch/upload': ok({ put_url: 'https://r2.test/put/abc', key: 'challenge/sandbox/r/read-1.webm', content_type: 'audio/webm' }),
  'r2.test/put': () => ({ status: 200, body: {} }),
  'ch/result$': ok(result),
});
const toRead = async (p) => { await p.click('wqc-ex-read'); await p.click('wqc-go'); };
const netCalls = (p) => p.fetches.filter((f) => f.url !== '/api/wq/e' && !/ch\/HUB\.TOKEN\/read(\?|$)/.test(f.url));

describe('the microphone check is local', () => {
  test('after the microphone is granted the page listens for 3 s with Web Audio: no upload, no result call, no recorder; a voice passes and the reading starts', async () => {
    const p = page({ routes: routes(), micLevel: 170 });
    await toRead(p);
    expect(p.screen()).toBe('mic-check');
    expect(p.html()).toContain(COPY.micSay);
    expect(p.mic.ctx).toBe(1);
    expect(p.recs).toHaveLength(0);
    expect(netCalls(p)).toHaveLength(0);
    await p.runTimers((x) => x.ms === 3000);
    expect(p.recs).toHaveLength(1);
    expect(p.recs[0].state).toBe('recording');
    expect(p.screen()).toBe('read-rec');
  });

  test('silence during the check: "Jugnu can\'t hear you yet", Try again and Skip, nothing recorded, nothing sent', async () => {
    const p = page({ routes: routes(), micLevel: 128 });
    await toRead(p);
    await p.runTimers((x) => x.ms === 3000);
    expect(p.screen()).toBe('mic-silent');
    expect(p.html()).toContain(COPY.micSilent);
    expect(p.has('wqc-again')).toBe(true);
    expect(p.has('wqc-skip')).toBe(true);
    expect(p.recs).toHaveLength(0);
    expect(netCalls(p)).toHaveLength(0);
    expect(p.mic.stops).toBe(1);
  });

  test('without the guard the page is today\'s: no check, the recorder starts at once, no AudioContext', async () => {
    const p = page({ routes: routes(READ) });
    await toRead(p);
    expect(p.screen()).toBe('read-rec');
    expect(p.mic.ctx).toBe(0);
    expect(p.has('wqc-stop')).toBe(true);
  });
});

describe('the minute itself', () => {
  const started = async (micLevel = 170) => {
    const p = page({ routes: routes(), micLevel, href: 'https://portal.test/c/HUB.TOKEN?home=1' });
    await toRead(p);
    await p.runTimers((x) => x.ms === 3000);
    return p;
  };

  test('the story is not on the ready screen and is on the recording screen; no Done, no countdown', async () => {
    const p = page({ routes: routes(), micLevel: 170 });
    await toRead(p);
    expect(p.html()).not.toContain('Imran woke up early');
    await p.runTimers((x) => x.ms === 3000);
    expect(p.screen()).toBe('read-rec');
    expect(p.html()).toContain('Imran woke up early');
    expect(p.has('wqc-stop')).toBe(false);
    expect(p.html()).not.toContain('id="wqc-left"');
  });

  test('"The rest is too hard" is absent until the first line\'s 20 s window has passed; then it ends the reading as stuck', async () => {
    const p = await started();
    expect(p.has('wqc-stuck')).toBe(false);
    await p.runTimers((x) => x.ms === LINE1_MS);
    expect(p.has('wqc-stuck')).toBe(true);
    expect(p.html()).toContain(COPY.stuck);
    await p.click('wqc-stuck');
    await p.flush();
    const res = p.fetches.find((f) => f.url === '/api/wq/ch/result');
    expect(JSON.parse(res.init.body)).toMatchObject({ ct: 'CT1', ended: 'stuck', mic_check: 'pass' });
    expect(JSON.parse(res.init.body).read_s).toBeGreaterThanOrEqual(0);
    expect(p.mic.closed).toBe(1);
  });

  test('Home during the minute asks first; "yes" ends the reading as home', async () => {
    const p = await started();
    await p.click('wq-home');
    expect(p.screen()).toBe('stop-ask');
    expect(p.html()).toContain(COPY.stopAsk);
    expect(p.recs[0].state).toBe('recording');
    await p.click('wqc-stop-no');
    expect(p.screen()).toBe('read-rec');
    await p.click('wq-home');
    await p.click('wqc-stop-yes');
    await p.flush();
    const res = p.fetches.find((f) => f.url === '/api/wq/ch/result');
    expect(JSON.parse(res.init.body)).toMatchObject({ ended: 'home' });
  });

  test('a silent minute after a passed check ends itself at 10 s as silent; a voice does not', async () => {
    const q = await started();
    await q.runTimers((x) => x.ms === 10000);
    expect(q.fetches.find((f) => f.url === '/api/wq/ch/result')).toBeUndefined();
    expect(q.recs[0].state).toBe('recording');
    const p = await started();
    p.mic.level = 128;
    await p.runTimers((x) => x.ms === 10000);
    const res = p.fetches.find((f) => f.url === '/api/wq/ch/result');
    expect(res).toBeTruthy();
    expect(JSON.parse(res.init.body)).toMatchObject({ ended: 'silent', mic_check: 'pass' });
  });
});

describe('the result says how the reading ended', () => {
  const show = (r) => { const p = page({ routes: routes() }); p.w.S.data = READ_GUARD; p.w.readResult(r); return p; };

  test('incomplete: the words read and Try again, never a per-minute number', () => {
    const p = show({ failed: true, reason: 'incomplete', words: 35 });
    expect(p.html()).toContain('You read 35 words. Read for the whole minute to get your number!');
    expect(p.has('wqc-again')).toBe(true);
    expect(p.html()).not.toMatch(/words in a minute/);
  });

  test('abandoned: the same line without a count', () => {
    const p = show({ failed: true, reason: 'abandoned' });
    expect(p.html()).toContain('Read for the whole minute');
    expect(p.html()).not.toMatch(/You read \d+ words\./);
  });

  test('silent: "Good try!" and no Try again', () => {
    const p = show({ score: { correct: 0, attempted: 0, stopped: true }, wcpm: 0, ended: 'silent' });
    expect(p.html()).toContain('Good try!');
    expect(p.has('wqc-again')).toBe(false);
    expect(p.has('wqc-menu')).toBe(true);
  });

  test('the whole minute and the whole story have their own lines, each with the words per minute', () => {
    const a = show({ score: { correct: 42, stopped: false }, wcpm: 42, ended: 'timer' });
    expect(a.html()).toContain(COPY.wholeMinute);
    expect(a.html()).toContain('You read 42 words in a minute!');
    const b = show({ score: { correct: 60, stopped: false }, wcpm: 80, ended: 'last_word' });
    expect(b.html()).toContain('Great reading! Well done.');
    expect(b.html()).toContain('You read 80 words in a minute!');
  });
});

describe('the menu under record', () => {
  test('a done read is ticked without a number; a done bigger likewise', () => {
    const p = page({ menu: { ...MENU, record: true, exercises: [
      { id: 'bigger', name: 'Which is bigger?', mins: 2, done: true, last: null },
      { id: 'read', name: 'Read aloud', mins: 2, done: true, last: null },
    ] } });
    expect((p.html().match(/✓/g) || []).length).toBe(2);
    expect(p.html()).not.toMatch(/\d+ \/ \d+|words a minute/);
  });
});
