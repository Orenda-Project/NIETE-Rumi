/**
 * An old, finished class link opened again on the phone that finished it (boot link_home, app_settings
 * web_quiz_link_home): the page asks POST linkhome {code, device_ref} once at boot and goes to the child's hub
 * (location.replace) when the server answers one. Only for ONE remembered child on this phone; never on the
 * teacher's preview, a friend's challenge, unsent answers or a run in progress. Any other answer, an error, or
 * no answer in 3 s: today's screen. Runs the whole shipped page in the harness's vm.
 */
const { page, flush } = require('./wq-page-harness');

const CHILD = { first: 'Zara', chip: 'c1', animal: 'owl' };
const SIB = { first: 'Omar', chip: 'c2', animal: 'cat' };
const DEV = 'dddddddddddddddddddddd';
const RESULT = { card: { first: 'Zara', animal: 'owl', correct: 3, total: 5, stars: 3 }, score: { correct: 3, total: 5 } };
const finished = (extra = {}) => ({ wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT, vdone: true, ...extra }, wq_kids: [CHILD], wq_d: DEV });
const HOME = '/h/abc.def?from=link';
const asks = (p) => p.fetches.filter((f) => f.url.indexOf('/api/wq/linkhome') >= 0);

describe('switch on: one remembered child who finished, on this phone', () => {
  test('the page asks once with the code and this phone, and replaces itself with the child\'s hub', async () => {
    const p = page({ lang: 'en', store: finished(), bootExtra: { link_home: true }, api: { '/api/wq/linkhome': { home: HOME } } });
    expect(p.html()).toBe('');                       // nothing drawn while it asks (the shell's "Opening the quiz…")
    await flush(); await flush();
    expect(asks(p)).toHaveLength(1);
    expect(JSON.parse(asks(p)[0].init.body)).toEqual({ code: 'TEST', device_ref: DEV });
    // In the page's language (the pages' link helper, wq-tel.js WQT.withLang).
    expect(p.hist.assigned).toEqual([`${HOME}&lang=en`]);
  });

  test('the server says no (null, an error, offline), or a reply that is not a hub link: today\'s card', async () => {
    for (const reply of [{ home: null }, { __status: 503, error: 'off' }, { __offline: true }, { home: 'https://evil.test/' }]) {
      const p = page({ lang: 'en', store: finished(), bootExtra: { link_home: true }, api: { '/api/wq/linkhome': reply } });
      await flush(); await flush();
      expect(p.hist.assigned).toEqual([]);
      expect(p.moment()).toBe('M10');
    }
  });

  test('no answer in 3 s: today\'s card, and a late answer moves nothing', async () => {
    let answer;
    const p = page({ lang: 'en', store: finished(), bootExtra: { link_home: true }, api: { '/api/wq/linkhome': () => new Promise((r) => { answer = r; }) } });
    expect(p.runTimers(3000)).toBeGreaterThan(0);
    expect(p.moment()).toBe('M10');
    answer({ home: HOME }); await flush(); await flush();
    expect(p.hist.assigned).toEqual([]);
  });

  test('a phone whose storage lost this quiz\'s run: still asked; a no shows the landing', async () => {
    const store = { wq_kids: [CHILD], wq_d: DEV };
    const p = page({ lang: 'en', store, bootExtra: { link_home: true }, api: { '/api/wq/linkhome': { home: null } } });
    await flush(); await flush();
    expect(asks(p)).toHaveLength(1);
    expect(p.moment()).toBe('M3');
  });
});

describe('never asked', () => {
  const cases = {
    'two remembered children (the landing asks "Whose turn?")': { store: { ...finished(), wq_kids: [CHILD, SIB] } },
    'a phone with no device yet': { store: { ...finished(), wq_d: undefined } },
    'a run in progress': { store: finished({ result: null, answers: { q1: { slot: 'A', ok: true } } }) },
    'answers waiting to be sent': { store: finished({ queue: [{ qid: 'q1' }] }) },
    'the teacher\'s preview': { preview: true },
    'a friend\'s challenge': { challenge: { first: 'Omar', correct: 2, total: 5 }, bootExtra: { link_home: true, invited: true } },
  };
  for (const [name, o] of Object.entries(cases)) {
    test(name, async () => {
      const p = page({ lang: 'en', store: finished(), bootExtra: { link_home: true }, api: { '/api/wq/linkhome': { home: HOME } }, ...o });
      await flush(); await flush();
      expect(asks(p)).toHaveLength(0);
      expect(p.hist.assigned).toEqual([]);
    });
  }
});

describe('golden: switch off (no link_home in the boot JSON)', () => {
  test('no request, and the same screen as today: the card for a finished run, the landing otherwise', async () => {
    const card = page({ lang: 'en', store: finished(), api: { '/api/wq/linkhome': { home: HOME } } });
    const land = page({ lang: 'ur', store: { wq_kids: [CHILD], wq_d: DEV }, api: { '/api/wq/linkhome': { home: HOME } } });
    await flush(); await flush();
    expect(asks(card)).toHaveLength(0);
    expect(asks(land)).toHaveLength(0);
    expect(card.moment()).toBe('M10');
    expect(land.moment()).toBe('M3');
    expect(card.hist.assigned).toEqual([]);
  });
});
