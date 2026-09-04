/**
 * bd-htueq — a Chromium launch per gate/final render, unbounded.
 *
 * `bot/vendor/lp-v9/render_lp.js` launches a FRESH Chromium browser per call
 * (`pw.chromium.launch` at its own :325, closed at :392 — see SYNC.md §3.2/§3.7). Nothing
 * upstream of it ever bounded how many of those run at once: three ladder rounds plus a gate
 * probe plus the final render is up to 5 renders per lesson, `SQS_WORKER_CONCURRENCY` runs up to
 * 3 lessons at once per worker process, and none of that is serialised — up to ~15 concurrent
 * Chromium instances fighting over one container's CPU, RAM and the 64MB `/dev/shm` SYNC.md §3.7
 * already documents as tight for a SINGLE render. That is the measured cause of the load-test
 * latency blowup (3 of 5 concurrent jobs over 936s vs 227-390s solo).
 *
 * This suite adds a per-process FIFO semaphore around the actual Chromium launch, gated by
 * `LP612_RENDER_CONCURRENCY`. It is deliberately mocked at the `playwright-core` boundary — the
 * same seam `render.test.js` and SYNC.md §5 document as the only one a unit test can use without
 * launching a real browser — so every assertion here exercises the REAL acquire/release code in
 * `lp612-render.service.js`, not a stand-in for it.
 *
 * `jest.resetModules()` + a fresh `require` per test gives each test its own semaphore instance
 * (the module-level singleton production code needs would otherwise leak `active`/queued state
 * between tests) — the same isolation pattern `tests/lp612/flags.test.js` uses for its own
 * module-level state. Every binding the mock factory below touches is prefixed `mock` — jest's
 * hoisting guard for `jest.mock()` factories refuses any other out-of-scope reference.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

// Bumped on every chromium.launch() call and dropped on every browser.close() — the concurrency
// counter every test reads. Module-scoped so the mock factory (hoisted, can only close over
// module-scope bindings prefixed `mock`) can see it.
let mockConcurrent = 0;
let mockMaxConcurrent = 0;
let mockFailNextLaunches = 0; // how many upcoming launches should reject instead of rendering

const mockProbe = (() => {
  const page = (id) => ({
    id, contentHeight: 900, boxHeight: 1000, lastPaintedPx: 950, contentBottomPx: 900,
    footTopPx: 1000, innerBottomPx: 1000, lastElement: 'sec', overflowPx: 0, overflowingSections: [],
  });
  return {
    pageCount: 2, pagesByPart: { teach: 1, support: 1 }, minBodyFontPx: 18, minBodySample: 'x',
    minAnyFontPx: 18, minChipFontPx: 14, minChipSample: 'x', pages: [page('teach-1'), page('support-1')],
  };
})();

jest.mock('playwright-core', () => {
  const stubPage = () => ({
    goto: jest.fn().mockResolvedValue(null),
    emulateMedia: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn(async (src) => {
      const s = String(src);
      if (s.includes('document.fonts.ready')) return true;
      if (s.includes("classList.add('measuring')")) return { parts: { teach: [], support: [] }, probe: {} };
      if (s.includes('minBodyFontPx')) return mockProbe;
      return undefined;
    }),
    pdf: jest.fn(async () => Buffer.from('%PDF-1.4\n/Type /Page \n/Type /Page \n')),
    $$: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
  });
  return {
    chromium: {
      launch: jest.fn(async () => {
        mockConcurrent += 1;
        mockMaxConcurrent = Math.max(mockMaxConcurrent, mockConcurrent);
        if (mockFailNextLaunches > 0) {
          mockFailNextLaunches -= 1;
          mockConcurrent -= 1;
          throw new Error('chromium failed to launch (simulated contention)');
        }
        return {
          newPage: jest.fn(async () => stubPage()),
          close: jest.fn(async () => { mockConcurrent -= 1; }),
        };
      }),
    },
  };
}, { virtual: true });

let outDir;
let saved;

beforeEach(() => {
  saved = { ...process.env };
  jest.resetModules();
  mockConcurrent = 0;
  mockMaxConcurrent = 0;
  mockFailNextLaunches = 0;
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-render-conc-'));
});

afterEach(() => {
  process.env = saved;
  fs.rmSync(outDir, { recursive: true, force: true });
});

function load() {
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/lp612-render.service');
}

describe('bd-htueq — renders are capped at LP612_RENDER_CONCURRENCY per process', () => {
  test('never runs more than N Chromium launches at once, and all callers still complete', async () => {
    process.env.LP612_RENDER_CONCURRENCY = '2';
    const { renderLessonPlan } = load();

    const calls = Array.from({ length: 5 }, (_, i) =>
      renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: `s${i}`, outDir }));

    const results = await Promise.all(calls);

    expect(mockMaxConcurrent).toBeLessThanOrEqual(2);
    expect(results).toHaveLength(5);
    results.forEach((r) => expect(fs.existsSync(r.pdfPath)).toBe(true));
  });

  test('with concurrency=1, renders are fully serialised (never 2 at once)', async () => {
    process.env.LP612_RENDER_CONCURRENCY = '1';
    const { renderLessonPlan } = load();

    await Promise.all([
      renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'a', outDir }),
      renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'b', outDir }),
      renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'c', outDir }),
    ]);

    expect(mockMaxConcurrent).toBe(1);
  });

  test('defaults to a conservative cap when LP612_RENDER_CONCURRENCY is unset', async () => {
    delete process.env.LP612_RENDER_CONCURRENCY;
    const { renderLessonPlan } = load();

    await Promise.all(Array.from({ length: 6 }, (_, i) =>
      renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: `d${i}`, outDir })));

    // The default must be a real cap (not "unbounded") and small enough that 3 concurrent SQS
    // jobs (SQS_WORKER_CONCURRENCY default) times this number stays modest per process.
    expect(mockMaxConcurrent).toBeGreaterThan(0);
    expect(mockMaxConcurrent).toBeLessThanOrEqual(2);
  });

  test('a non-numeric or zero override falls back to the default rather than disabling the cap', async () => {
    process.env.LP612_RENDER_CONCURRENCY = '0';
    const { renderLessonPlan } = load();
    await Promise.all(Array.from({ length: 5 }, (_, i) =>
      renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: `e${i}`, outDir })));
    expect(mockMaxConcurrent).toBeGreaterThan(0);
    expect(mockMaxConcurrent).toBeLessThanOrEqual(2);
  });
});

describe('bd-htueq — the semaphore releases its slot on the failure path too', () => {
  test('a render that throws does not permanently burn its slot — the next queued render still runs', async () => {
    process.env.LP612_RENDER_CONCURRENCY = '1';
    const { renderLessonPlan } = load();
    mockFailNextLaunches = 1; // only the FIRST launch call fails

    const outcome = { a: null, b: null };
    const watchdog = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMED OUT — a queued render never ran; the semaphore leaked its slot on the throw path')), 4000);
    });

    const work = (async () => {
      outcome.a = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'fail-1', outDir }).catch((e) => e);
      // `a` must have already failed (concurrency=1, one launch already spent) before `b` is
      // even attempted, so this genuinely exercises "queued behind a failure", not two
      // independent unthrottled calls.
      outcome.b = await renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'ok-1', outDir }).catch((e) => e);
    })();

    await Promise.race([work, watchdog]);

    expect(outcome.a).toBeInstanceOf(Error);
    expect(outcome.a.code).toBe('RENDER_FAILED');
    expect(outcome.b.pdfPath).toBeTruthy(); // the second render actually completed, not an Error
    expect(mockMaxConcurrent).toBe(1); // the cap held throughout, proving it was really gated
  });

  test('with concurrency=1, a failing render queued AHEAD of a clean one still lets the clean one through', async () => {
    process.env.LP612_RENDER_CONCURRENCY = '1';
    const { renderLessonPlan } = load();
    mockFailNextLaunches = 1;

    const watchdog = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TIMED OUT — the second call never got its slot')), 4000);
    });

    // Both fired together (not awaited in sequence) so the second one is genuinely QUEUED behind
    // the first inside the semaphore, not just called after the first already finished.
    const settle = Promise.allSettled([
      renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'x', outDir }),
      renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem: 'y', outDir }),
    ]);

    const [first, second] = await Promise.race([settle, watchdog]);

    expect(first.status).toBe('rejected');
    expect(second.status).toBe('fulfilled');
    expect(mockMaxConcurrent).toBe(1);
  });
});

describe('bd-htueq — FIFO fairness', () => {
  test('queued renders are served in submission order, not reversed or interleaved', async () => {
    process.env.LP612_RENDER_CONCURRENCY = '1';
    const { renderLessonPlan } = load();

    const order = [];
    const track = (stem) => renderLessonPlan({ lpDoc: CLEAN_DOC, lang: 'en', stem, outDir })
      .then(() => order.push(stem));

    await Promise.all([track('first'), track('second'), track('third')]);

    expect(order).toEqual(['first', 'second', 'third']);
  });
});
