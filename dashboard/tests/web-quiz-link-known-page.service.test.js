/**
 * A class link on a phone that already holds a child (boot link_known, app_settings web_quiz_link_known_child): the
 * page asks POST known {code} once at boot (the edge forwards the phone's own cookie) and, when the server answers this phone's own children, asks
 * "Is it <First>?" (one) or "Whose turn is it?" (two or more) before the name box. "Yes" / a card starts the session as
 * that child (via 'known'); "Someone else" is today's landing. Asked once per quiz on this phone. Today's landing is
 * drawn at once while it asks; the answer swaps it for the question only while the child has not touched the page
 * (no tap, key, touch or scroll) — after a touch a late answer is dropped and `link_known_late {ms}` records it, and
 * every answer is timed (`link_known_answer {ms, kids}`). A phone with no device, an answer of nobody, an error or
 * offline: today's screen, drawn exactly as today. Never on the teacher's preview, a friend's challenge, a hub link
 * (?k=), or a run in progress. Runs the whole shipped page.
 */
const { page, flush } = require('./wq-page-harness');

const DEV = 'dddddddddddddddddddddd';
const ZAR = { chip: 'cz', first: 'Sadia', animal: 'owl' };
const MAH = { chip: 'cm', first: 'Iqra', animal: 'cat' };
const asks = (p) => p.fetches.filter((f) => f.url.indexOf('/api/wq/known') >= 0);
const starts = (p) => p.fetches.filter((f) => f.url.indexOf('/api/wq/session') >= 0).map((f) => JSON.parse(f.init.body));
const SESSION = { st: 's1', device_ref: DEV, child: ZAR, resume: { answered: [] } };
// the page's queued events, as the pagehide beacon sends them
const evs = (p) => { p.fireWin('pagehide'); return p.fetches.filter((f) => f.url === '/api/wq/e').flatMap((f) => JSON.parse(f.init.body).events); };
const named = (p, n) => evs(p).filter((e) => e.n === n);
const on = (o = {}) => page({ lang: 'en', store: { wq_d: DEV }, bootExtra: { link_known: true }, api: { '/api/wq/known': { kids: [ZAR] }, '/api/wq/session': SESSION }, ...o });

describe('switch on: a phone that holds ONE child', () => {
  test('asks once with the code (the phone is its own cookie, never the body), then "Is it Sadia?" with Yes / Someone else', async () => {
    const p = on();
    // today's landing is drawn at once while it asks (never a blank wait), exactly as with the switch off
    expect(p.moment()).toBe('M3');
    expect(p.html()).toBe(page({ lang: 'en', store: { wq_d: DEV } }).html());
    await flush(); await flush();
    expect(asks(p)).toHaveLength(1);
    expect(JSON.parse(asks(p)[0].init.body)).toEqual({ code: 'TEST' });
    expect(p.moment()).toBe('M4-known');
    expect(p.html()).toContain('Is it <bdi>Sadia</bdi>?');
    expect(p.html()).toContain('Yes, that&#39;s me');
    expect(p.html()).toContain('Someone else');
  });

  test('"Yes" starts the session as that child (via known) and the question is not asked again on this phone', async () => {
    const p = on();
    await flush(); await flush();
    p.els['#wq-kn-yes'].fire('click');
    await flush(); await flush();
    expect(starts(p)).toEqual([expect.objectContaining({ code: 'TEST', chip: 'cz', via: 'known', device_ref: DEV })]);
    expect(JSON.parse(p.ls.get('wq_kn_TEST'))).toBe(1);
  });

  test('"Someone else": today\'s landing, drawn exactly as with the switch off; asked once — never again for this quiz', async () => {
    const p = on();
    await flush(); await flush();
    p.els['#wq-kn-else'].fire('click');
    const off = page({ lang: 'en', store: { wq_d: DEV } });
    await flush();
    expect(p.moment()).toBe('M3');
    expect(p.html()).toBe(off.html());
    expect(starts(p)).toEqual([]);
    const again = on({ store: { wq_d: DEV, wq_kn_TEST: 1 } });
    await flush(); await flush();
    expect(asks(again)).toHaveLength(0);
    expect(again.moment()).toBe('M3');
  });

  test('Urdu: «کیا آپ سعدیہ ہیں؟»', async () => {
    const p = on({ lang: 'ur', api: { '/api/wq/known': { kids: [{ ...ZAR, first: 'سعدیہ' }] } } });
    await flush(); await flush();
    expect(p.html()).toContain('کیا آپ <bdi>سعدیہ</bdi> ہیں؟');
  });

  test('Urdu: "Yes" reads «جی ہاں، میں ہی ہوں» and "Someone else" «نہیں، میں کوئی اور ہوں»', async () => {
    const p = on({ lang: 'ur', api: { '/api/wq/known': { kids: [{ ...ZAR, first: 'سعدیہ' }] } } });
    await flush(); await flush();
    expect(p.html()).toContain('جی ہاں، میں ہی ہوں');
    expect(p.html()).not.toContain('جی ہاں، میں ہوں<');
    expect(p.html()).toContain('نہیں، میں کوئی اور ہوں');
  });

  test('Urdu with a name saved in Latin letters: the name is isolated, so «؟» stays at the end of the question', async () => {
    const p = on({ lang: 'ur' });
    await flush(); await flush();
    expect(p.html()).toContain('<h2>کیا آپ <bdi>Sadia</bdi> ہیں؟</h2>');
  });

  test('a name carrying markup or a direction mark is escaped inside its isolate', async () => {
    const p = on({ lang: 'ur', api: { '/api/wq/known': { kids: [{ ...ZAR, first: '<b>\u202eSadia' }] } } });
    await flush(); await flush();
    expect(p.html()).toContain('<bdi>&lt;b&gt;\u202eSadia</bdi>');
  });

  test('identity v2 page: "Someone else" goes to v2\'s own landing, as the switch-off page shows it', async () => {
    const cls = { label: 'Class 3-B', teacher: 'Ms Testwala', chips: [], identity: { mode: 'v2', class: { state: 'known', label: '3-B' }, roster: true, invited: false } };
    const p = on({ cls, ident: true });
    await flush(); await flush();
    expect(p.moment()).toBe('M4-known');
    p.els['#wq-kn-else'].fire('click');
    const off = page({ lang: 'en', cls, ident: true, store: { wq_d: DEV } });
    expect(p.moment()).toBe(off.moment());
    expect(p.html()).toBe(off.html());
  });
});

describe('switch on: a phone that holds TWO children', () => {
  test('"Whose turn is it?" with both first names and Someone else; a card starts as that child', async () => {
    const p = on({ api: { '/api/wq/known': { kids: [MAH, ZAR] }, '/api/wq/session': SESSION } });
    await flush(); await flush();
    expect(p.moment()).toBe('M4-known');
    expect(p.html()).toContain('Whose turn is it?');
    expect(p.html()).toContain('Iqra');
    expect(p.html()).toContain('Sadia');
    expect(p.html()).toContain('Someone else');
    p.els['#wq-kn-1'].fire('click');
    await flush(); await flush();
    expect(starts(p)).toEqual([expect.objectContaining({ chip: 'cz', via: 'known' })]);
  });
});

describe('today\'s screen, drawn exactly as with the switch off', () => {
  const replies = {
    'nobody held': { kids: [] }, 'an error': { __status: 503, error: 'off' }, offline: { __offline: true },
    'a reply of the wrong shape': { kids: 'x' }, 'a card with no chip': { kids: [{ first: 'Sadia' }] },
  };
  for (const [name, reply] of Object.entries(replies)) {
    test(name, async () => {
      const p = on({ api: { '/api/wq/known': reply } });
      await flush(); await flush();
      const off = page({ lang: 'en', store: { wq_d: DEV } });
      expect(p.moment()).toBe('M3');
      expect(p.html()).toBe(off.html());
    });
  }

  test('the child is already a card on this phone\'s landing: no second question', async () => {
    const p = on({ store: { wq_d: DEV, wq_kids: [ZAR] } });
    await flush(); await flush();
    expect(p.moment()).toBe('M3');
    expect(p.html()).toBe(page({ lang: 'en', store: { wq_d: DEV, wq_kids: [ZAR] } }).html());
  });
});

describe('a slow answer: the question still lands while the child has not touched the page', () => {
  const slow = () => { let answer; const p = on({ api: { '/api/wq/known': () => new Promise((r) => { answer = r; }), '/api/wq/session': SESSION } }); return { p, answer: (b) => answer(b) }; };
  const offHtml = () => page({ lang: 'en', store: { wq_d: DEV } }).html();

  test('no fixed wait: no timer stands between the child and today\'s landing, and an answer after 3.5 s with no touch swaps in the question', async () => {
    const { p, answer } = slow();
    expect(p.moment()).toBe('M3');
    p.runTimers(3500);                                  // whatever the page timed, 3.5 s pass
    expect(p.moment()).toBe('M3');
    answer({ kids: [ZAR] }); await flush(); await flush();
    expect(p.moment()).toBe('M4-known');
    expect(p.html()).toContain('Is it <bdi>Sadia</bdi>?');
    const [a] = named(p, 'link_known_answer');
    expect(a).toMatchObject({ kids: 1 });
    expect(Number.isInteger(a.ms) && a.ms >= 0).toBe(true);
    expect(named(p, 'link_known_late')).toEqual([]);
  });

  const touches = {
    'a scroll': (p) => p.fireWin('scroll'),
    'a key': (p) => p.fireDoc('keydown'),
    'a finger on the screen': (p) => p.fireDoc('touchstart'),
    'a pointer press': (p) => p.fireDoc('pointerdown'),
  };
  for (const [name, touch] of Object.entries(touches)) {
    test(`after ${name}: no swap — today's landing stays exactly — and link_known_late records the answer`, async () => {
      const { p, answer } = slow();
      touch(p);
      answer({ kids: [ZAR] }); await flush(); await flush();
      expect(p.moment()).toBe('M3');
      expect(p.html()).toBe(offHtml());
      const [late] = named(p, 'link_known_late');
      expect(Number.isInteger(late.ms) && late.ms >= 0).toBe(true);
      expect(late).not.toHaveProperty('kids');
      expect(named(p, 'link_known_answer')).toEqual([expect.objectContaining({ kids: 1 })]);
    });
  }

  test('after a tap on «Play»: the name step stays, never the question', async () => {
    const { p, answer } = slow();
    p.els['#wq-play'].fire('click');
    const m = p.moment();
    expect(m).not.toBe('M3');
    answer({ kids: [ZAR] }); await flush(); await flush();
    expect(p.moment()).toBe(m);
    expect(p.html()).not.toContain('Is it');
    expect(named(p, 'link_known_late')).toHaveLength(1);
  });

  test('a slow answer of nobody: nothing moves and nothing is late; the answer is timed with kids 0', async () => {
    const { p, answer } = slow();
    answer({ kids: [] }); await flush(); await flush();
    expect(p.moment()).toBe('M3');
    expect(p.html()).toBe(offHtml());
    expect(named(p, 'link_known_late')).toEqual([]);
    expect(named(p, 'link_known_answer')).toEqual([expect.objectContaining({ kids: 0 })]);
  });

  test('a touch after the question is up changes nothing (the sheet stays, no late line)', async () => {
    const p = on();
    await flush(); await flush();
    expect(p.moment()).toBe('M4-known');
    p.fireWin('scroll');
    expect(p.moment()).toBe('M4-known');
    expect(named(p, 'link_known_late')).toEqual([]);
  });
});

describe('never asked', () => {
  const cases = {
    'a fresh phone (no device yet: a forwarded link)': { store: {} },
    'the teacher\'s preview': { preview: true },
    'a friend\'s challenge': { challenge: { first: 'Omar', correct: 2, total: 5 }, bootExtra: { link_known: true, invited: true } },
    'a hub link that already names the child (?k=)': { search: '?k=cz' },
    'a run in progress': { store: { wq_d: DEV, wq_s_TEST: { st: 's1', child: ZAR, answers: { q1: { slot: 'A', ok: true } }, queue: [], result: null } } },
  };
  for (const [name, o] of Object.entries(cases)) {
    test(name, async () => {
      const p = on(o);
      await flush(); await flush();
      expect(asks(p)).toHaveLength(0);
      expect(p.moment()).not.toBe('M4-known');
    });
  }
});

describe('golden: switch off (no link_known in the boot JSON)', () => {
  test('no request, and the same landing as today', async () => {
    const p = page({ lang: 'en', store: { wq_d: DEV }, api: { '/api/wq/known': { kids: [ZAR] } } });
    const u = page({ lang: 'ur', store: { wq_d: DEV }, api: { '/api/wq/known': { kids: [ZAR] } } });
    await flush(); await flush();
    expect(asks(p)).toHaveLength(0);
    expect(asks(u)).toHaveLength(0);
    expect(p.moment()).toBe('M3');
    expect(u.moment()).toBe('M3');
    expect(evs(p).filter((e) => /^link_known_/.test(e.n))).toEqual([]);
  });
});
