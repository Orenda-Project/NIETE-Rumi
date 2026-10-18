'use strict';
/**
 * bd-t7zk3t.11 — SPEC v2 §6 row 30: the FLN lane is invisible to the ch3-10 A/B (lp-ab-ch310) by construction.
 *  1. Loading the FLN routes and corpus service never loads lp-ab-ch310 (require.cache).
 *  2. Every niete_lp_opens read in lp-app-opens.store.js (the A/B's open readers) filters plan_kind = 'k5', so an
 *     `fln` open row is never in what they read. The readers are EXECUTED against a fake supabase that records every
 *     .eq() — no grep.
 */
const path = require('path');

const AB = path.resolve(__dirname, '..', '..', 'bot', 'shared', 'services', 'lp-ab-ch310.service.js');

afterEach(() => jest.restoreAllMocks());

test('requiring the FLN routes and corpus service never loads lp-ab-ch310 (real Node require.cache)', () => {
  // A child Node process: jest's module registry is not Node's require.cache. The two DB configs are stubbed at
  // Module._load so nothing connects; everything else loads for real.
  const { execFileSync } = require('child_process');
  const root = path.resolve(__dirname, '..', '..');
  const script = `
    const M = require('module'); const orig = M._load;
    M._load = function (r, p, i) { if (/config\\/(supabase|database)$/.test(r)) return { query: async () => ({ rows: [] }) }; return orig.apply(this, arguments); };
    require(${JSON.stringify(path.join(root, 'dashboard/services/fln-corpus.service'))});
    require(${JSON.stringify(path.join(root, 'dashboard/routes/portal-fln.routes'))});
    const keys = Object.keys(require.cache);
    process.stdout.write(JSON.stringify({ n: keys.length, ab: keys.filter((k) => k === ${JSON.stringify(AB)} || /lp-ab-ch310/.test(k)) }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, NODE_OPTIONS: '' } }).toString().trim().split('\n').pop());
  expect(out.n).toBeGreaterThan(2); // the two FLN modules (and their deps) really loaded
  expect(out.ab).toEqual([]);
});

test('and inside jest: a lp-ab-ch310 factory is never invoked by the FLN modules', () => {
  let loaded = false;
  jest.isolateModules(() => {
    jest.doMock('../../dashboard/config/supabase', () => ({}));
    jest.doMock('../../dashboard/config/database', () => ({ query: async () => ({ rows: [] }) }));
    jest.doMock('../../bot/shared/services/lp-ab-ch310.service', () => { loaded = true; return {}; });
    require('../../dashboard/services/fln-corpus.service');
    require('../../dashboard/routes/portal-fln.routes');
  });
  expect(loaded).toBe(false);
});

describe('every niete_lp_opens read in lp-app-opens.store filters plan_kind = k5', () => {
  let reads;
  const USER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';

  beforeEach(() => {
    jest.resetModules();
    reads = [];
    const fake = {
      from(table) {
        const rec = { table, eqs: [] };
        reads.push(rec);
        const q = {
          select: () => q,
          eq: (c, v) => { rec.eqs.push([c, v]); return q; },
          in: () => q, gte: () => q, lte: () => q, lt: () => q, order: () => q, limit: () => q,
          range: () => Promise.resolve({ data: [], error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (ok, ko) => Promise.resolve({ data: [], error: null }).then(ok, ko),
        };
        return q;
      },
    };
    jest.doMock('../../bot/shared/config/supabase', () => fake);
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
  });

  it('drives every exported reader', async () => {
    const S = require('../../bot/shared/services/quiz/lp-app-opens.store');
    await S.viewerOpensAsDownloads('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z');
    await S.viewerOpensForTeacher(USER, '2026-10-01T00:00:00Z');
    await S.teacherViewerOpens(USER, '2026-10-01T00:00:00Z');
    await S.teacherViewerOpensBetween(USER, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z');
    await S.viewerOpenById(USER, 42);
    await S.viewerOpenedLessonIds(USER);

    const opensReads = reads.filter((r) => r.table === 'niete_lp_opens');
    // the probe in readOpens is `select('id').limit(1)` — a row-existence check, not a read of what was opened
    const dataReads = opensReads.filter((r) => r.eqs.length > 0);
    expect(dataReads.length).toBeGreaterThanOrEqual(6);
    for (const r of dataReads) {
      expect(r.eqs).toContainEqual(['plan_kind', 'k5']);
      expect(r.eqs.some(([c, v]) => c === 'plan_kind' && v === 'fln')).toBe(false);
    }
    const unfiltered = opensReads.filter((r) => r.eqs.length === 0);
    expect(unfiltered.length).toBeLessThanOrEqual(1);
  });
});
