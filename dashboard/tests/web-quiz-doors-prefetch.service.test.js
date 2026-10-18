/**
 * The Videos door's lists asked early (app_settings web_quiz_doors_prefetch; the boot's `wait_pre`, sent only with the
 * designed wait on). When the door screens load after the home has painted (WQDOORS.warm), the library's subjects are
 * asked, and with the shelves on each subject's shelf, so a Videos tap paints from rows already here. A tap while those
 * reads are on their way joins them (one read each). Never on Data Saver or 2G, never for a teacher's class preview,
 * and a read that failed is not kept (the tap asks again). Switch off: warm asks the library for nothing, as today.
 * Invented rows only.
 */
const { load, bootOf, TOKEN, LIB_SUBJECTS, LIB_CHAPTERS } = require('./wq-list-states-screens');

const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };
function live({ fetchImpl, connection } = {}) {
  const fetch = jest.fn(fetchImpl || (() => new Promise(() => {})));
  const document = { getElementById: () => null, querySelector: () => null, createElement: () => ({ setAttribute() {} }), head: { appendChild() {} } };
  const location = { hash: '#videos', pathname: `/h/${TOKEN}`, search: '' };
  const globals = { fetch, document, location, setImmediate, ...(connection ? { navigator: { connection } } : {}) };
  const W = load({ win: { scrollTo() {}, addEventListener() {} }, globals });
  return { W, fetch };
}
function paintRoot() {
  const paints = [];
  return {
    paints, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; },
    get innerHTML() { return paints[paints.length - 1] || ''; }, set innerHTML(v) { paints.push(v); },
    querySelector: () => null, querySelectorAll: () => [],
  };
}
const OK = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const LIB = (u) => (/[?&]s=/.test(u) ? OK(LIB_CHAPTERS) : OK(LIB_SUBJECTS));
const C = { token: TOKEN, lang: 'en', ev() {} };
const SHELF = { doors: { stories: [{ kind: 'shelf' }], games: [], videos: { href: '/lib/x', watch: true, shelf: true } } };
const ON = { ...bootOf('en', { wait_pre: true }), ...SHELF };
const libCalls = (fetch) => fetch.mock.calls.map((c) => c[0]).filter((u) => /^\/api\/wq\/lib\/h\//.test(u));

describe('switch on: the Videos lists are asked when the door screens load', () => {
  test('warm asks the subjects, then each subject\'s shelf, once each; the Videos tap then asks for nothing', async () => {
    const { W, fetch } = live({ fetchImpl: LIB });
    W.WQDOORS.warm(ON, C);
    expect(libCalls(fetch)).toEqual([`/api/wq/lib/h/${encodeURIComponent(TOKEN)}?kid=0123456789abcdef&l=en`]);
    await flush();
    expect(libCalls(fetch)).toEqual([
      `/api/wq/lib/h/${encodeURIComponent(TOKEN)}?kid=0123456789abcdef&l=en`,
      `/api/wq/lib/h/${encodeURIComponent(TOKEN)}?kid=0123456789abcdef&l=en&s=Science`,
    ]);
    const r = paintRoot();
    W.WQDOORS.mount(r, ON, C, 'videos');
    await flush();
    expect(libCalls(fetch)).toHaveLength(2);
    expect(r.paints[0]).toContain('Science');
    expect(r.paints[0]).not.toMatch(/aria-busy="true"/);
  });
  test('a tap while the subjects are on their way joins that read (one read), then paints them', async () => {
    let answer;
    const { W, fetch } = live({ fetchImpl: (u) => (/[?&]s=/.test(u) ? OK(LIB_CHAPTERS) : new Promise((res) => { answer = res; })) });
    W.WQDOORS.warm(ON, C);
    expect(libCalls(fetch)).toHaveLength(1); // asked before the tap
    const r = paintRoot();
    W.WQDOORS.mount(r, ON, C, 'videos');
    expect(libCalls(fetch)).toHaveLength(1);
    answer({ ok: true, status: 200, json: () => Promise.resolve(LIB_SUBJECTS) });
    await flush();
    expect(libCalls(fetch).filter((u) => !/[?&]s=/.test(u))).toHaveLength(1);
    expect(libCalls(fetch).filter((u) => /[?&]s=Science/.test(u))).toHaveLength(1);
    expect(r.paints[r.paints.length - 1]).toContain('Science');
  });
  test('a subjects read that failed is not kept: the tap asks again', async () => {
    let n = 0;
    const { W, fetch } = live({ fetchImpl: (u) => ((n += 1) === 1 ? Promise.reject(new Error('offline')) : LIB(u)) });
    W.WQDOORS.warm(ON, C);
    await flush();
    W.WQDOORS.mount(paintRoot(), ON, C, 'videos');
    await flush();
    expect(libCalls(fetch).filter((u) => !/[?&]s=/.test(u))).toHaveLength(2);
  });
  test('without the shelves: the subjects alone', async () => {
    const { W, fetch } = live({ fetchImpl: LIB });
    W.WQDOORS.warm(bootOf('en', { wait_pre: true }), C);
    await flush();
    expect(libCalls(fetch)).toHaveLength(1);
  });
});

describe('never asked', () => {
  test.each([['Data Saver', { saveData: true, effectiveType: '4g' }], ['2G', { effectiveType: '2g' }], ['slow 2G', { effectiveType: 'slow-2g' }]])('%s', async (_n, connection) => {
    const { W, fetch } = live({ fetchImpl: LIB, connection });
    W.WQDOORS.warm(ON, C);
    await flush();
    expect(libCalls(fetch)).toEqual([]);
  });
  test('a teacher\'s class preview', async () => {
    const { W, fetch } = live({ fetchImpl: LIB });
    W.WQDOORS.warm({ ...ON, practice: 1, kid: null }, C);
    await flush();
    expect(libCalls(fetch)).toEqual([]);
  });
  test.each([['no wait_pre', {}], ['wait_pre not true', { wait_pre: 1 }]])('switch off (%s): warm asks the library for nothing; a tap reads as today', async (_n, extra) => {
    const { W, fetch } = live({ fetchImpl: LIB });
    const B = { ...bootOf('en', extra), ...SHELF };
    W.WQDOORS.warm(B, C);
    await flush();
    expect(libCalls(fetch)).toEqual([]);
    W.WQDOORS.mount(paintRoot(), B, C, 'videos');
    W.WQDOORS.mount(paintRoot(), B, C, 'videos');
    expect(libCalls(fetch)).toHaveLength(2); // today: each mount before the subjects arrive asks on its own
  });
});
