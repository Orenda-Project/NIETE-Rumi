'use strict';
/**
 * Free-form lesson plans — the switch (app_settings.freeform_lp), NIETE port.
 *
 * DEFAULT OFF: a missing row, a read that throws, invalid JSON, or JSON that is not a config
 * object all read as OFF — the inverse of a gate that stays on when it cannot read. The shape
 * is the same as the other Rumi deployment's (mode_by_segment, ab_share, testers, handoff.*), so
 * one operator runbook covers both. This deployment has ONE segment, 'NIETE' ('*' also matches).
 * Cached 30 s per process: a row edit is live within 30 s + the next request.
 */
let mockRow; // undefined = row absent; Error = query throws; anything else = data.value
const mockQueries = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = { table, filters: [] };
    mockQueries.push(q);
    const b = {
      select: jest.fn(() => b),
      eq: jest.fn((c, v) => { q.filters.push([c, v]); return b; }),
      maybeSingle: jest.fn(async () => {
        if (mockRow instanceof Error) throw mockRow;
        return { data: mockRow === undefined ? null : { value: mockRow }, error: null };
      }),
    };
    return b;
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const S = require('../../bot/shared/services/fflp/switch');

const ON = (extra = {}) => JSON.stringify({ mode_by_segment: { '*': 'on' }, handoff: { niete_catalogue_miss: true }, testers: [], ...extra });
const USER = { id: '00000000-0000-0000-0000-000000000001', phone: '923000000001' };
const MISS = { source: 'gamma_standard', contentType: 'lesson_plan', user: USER, entry: 'niete_catalogue_miss' };

beforeEach(() => { S._resetCache(); mockQueries.length = 0; mockRow = undefined; });

describe('SW ×3 — read() is OFF on every failure path', () => {
  test('row absent ⇒ {mode:"off"} (and the query is the one row by key)', async () => {
    expect(await S.read()).toEqual({ mode: 'off' });
    expect(mockQueries[0]).toEqual({ table: 'app_settings', filters: [['key', 'freeform_lp']] });
  });
  test('supabase read throws ⇒ {mode:"off"}', async () => {
    mockRow = new Error('connection reset');
    expect(await S.read()).toEqual({ mode: 'off' });
  });
  test('invalid JSON ⇒ {mode:"off"}', async () => {
    mockRow = '{"mode_by_segment": {"*": "on"';
    expect(await S.read()).toEqual({ mode: 'off' });
  });
  test('JSON that is not a config object ⇒ {mode:"off"}', async () => {
    for (const v of ['true', '"on"', '[]', '{}', '{"mode_by_segment":"on"}']) {
      S._resetCache(); mockRow = v;
      expect(await S.read()).toEqual({ mode: 'off' });
    }
  });
  test('a valid string row parses; a jsonb object row is accepted as-is', async () => {
    mockRow = ON();
    expect((await S.read()).mode_by_segment).toEqual({ '*': 'on' });
    S._resetCache();
    mockRow = { mode_by_segment: { NIETE: 'on' } };
    expect((await S.read()).mode_by_segment).toEqual({ NIETE: 'on' });
  });
});

describe('30 s memo (the rollback bound)', () => {
  test('a second read within 30 s does not query; after 30 s it does', async () => {
    const t0 = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(t0);
    mockRow = ON();
    await S.read();
    mockRow = undefined;
    expect((await S.read()).mode_by_segment).toEqual({ '*': 'on' });
    expect(mockQueries).toHaveLength(1);
    spy.mockReturnValue(t0 + 30_001);
    expect(await S.read()).toEqual({ mode: 'off' });
    expect(mockQueries).toHaveLength(2);
    spy.mockRestore();
  });
});

describe('decide() — the catalogue-miss door', () => {
  test('row absent ⇒ off, even for a listed tester', async () => {
    expect(await S.decide(MISS)).toMatchObject({ track: 'gamma_standard', mode: 'off', reason: 'switch_off' });
  });
  test('mode on but handoff.niete_catalogue_miss not strictly true ⇒ stays off', async () => {
    mockRow = JSON.stringify({ mode_by_segment: { '*': 'on' } });
    expect(await S.decide(MISS)).toMatchObject({ track: 'gamma_standard', reason: 'handoff_off:niete_catalogue_miss' });
    S._resetCache(); mockRow = ON({ handoff: { niete_catalogue_miss: 'true' } });
    expect((await S.decide(MISS)).track).toBe('gamma_standard');
  });
  test('mode on + handoff ⇒ freeform_v1, segment NIETE', async () => {
    mockRow = ON();
    expect(await S.decide(MISS)).toMatchObject({ track: 'freeform_v1', segment: 'NIETE', mode: 'on' });
  });
  test('the NIETE segment key wins over "*"', async () => {
    mockRow = JSON.stringify({ mode_by_segment: { NIETE: 'off', '*': 'on' }, handoff: { niete_catalogue_miss: true } });
    expect((await S.decide(MISS)).track).toBe('gamma_standard');
  });
  test('a tester wins over mode off (digits-only match)', async () => {
    mockRow = JSON.stringify({ mode_by_segment: { '*': 'off' }, handoff: { niete_catalogue_miss: true }, testers: ['+92 300 0000001'] });
    expect(await S.decide(MISS)).toMatchObject({ track: 'freeform_v1', reason: 'tester' });
  });
  test('an unknown mode value reads as off', async () => {
    mockRow = JSON.stringify({ mode_by_segment: { '*': 'ON!' }, handoff: { niete_catalogue_miss: true } });
    expect((await S.decide(MISS)).track).toBe('gamma_standard');
  });
  test('decide never throws: a broken user object stays on today\'s track', async () => {
    mockRow = ON();
    const d = await S.decide({ ...MISS, user: null });
    expect(d.track).toBe('freeform_v1'); // mode on needs no user
    expect(await S.decide(null)).toMatchObject({ mode: 'off' });
  });
});

describe('abBucket — the A/B formula of the other deployment (md5(user_id) first 8 hex / 0xffffffff)', () => {
  const crypto = require('crypto');
  test('formula', () => {
    const want = parseInt(crypto.createHash('md5').update('abc-123').digest('hex').slice(0, 8), 16) / 0xffffffff;
    expect(S.abBucket('abc-123')).toBe(want);
  });
  test('share 0 ⇒ never; share 1 ⇒ always; bucket == share ⇒ out (strict <)', () => {
    const row = (share) => ({ mode_by_segment: { '*': 'ab' }, ab_share: { '*': share }, handoff: { niete_catalogue_miss: true } });
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      const args = { ...MISS, user: { id, phone: '1' } };
      expect(S.decidePure(row(0), args).track).toBe('gamma_standard');
      expect(S.decidePure(row(1), args).track).toBe('freeform_v1');
      const b = S.abBucket(id);
      expect(S.decidePure(row(b), args).track).toBe('gamma_standard');
      expect(S.decidePure(row(b + 1e-9), args).track).toBe('freeform_v1');
    }
  });
});

describe('PRED — the predicate table (ROUTER_SEAM §4), on this deployment\'s one segment', () => {
  const TESTER = '923001110000';
  const pick = (want) => { for (let i = 0; ; i++) { const id = `u-${i}`; if (want(S.abBucket(id))) return id; } };
  const ids = { low: pick((b) => b < 0.5), high: pick((b) => b >= 0.5) };
  const cfg = (mode) => ({ mode_by_segment: { NIETE: mode, '*': 'off' }, ab_share: { '*': 0.5 }, testers: [TESTER] });
  const TABLE = [
    ['gamma_standard', 'lesson_plan', cfg('off'), false, null, 'gamma_standard'],
    ['gamma_standard', 'lesson_plan', cfg('off'), true, null, 'freeform_v1'],
    ['gamma_standard', 'lesson_plan', cfg('shadow'), false, null, 'freeform_shadow'],
    ['gamma_standard', 'lesson_plan', cfg('ab'), false, 'low', 'freeform_v1'],
    ['gamma_standard', 'lesson_plan', cfg('ab'), false, 'high', 'gamma_standard'],
    ['gamma_standard', 'lesson_plan', cfg('on'), false, null, 'freeform_v1'],
    ['gamma_standard', 'presentation', cfg('on'), true, null, 'gamma_standard'],
    ['gamma_enriched', 'lesson_plan', cfg('on'), true, null, 'gamma_enriched'],
    ['ug_lp', 'lesson_plan', cfg('on'), true, null, 'ug_lp'],
    ['gamma_standard', 'lesson_plan', { mode: 'off' }, true, null, 'gamma_standard'],
  ];
  test('fixture ids straddle the 0.5 share', () => {
    expect(S.abBucket(ids.low)).toBeLessThan(0.5);
    expect(S.abBucket(ids.high)).toBeGreaterThanOrEqual(0.5);
  });
  test.each(TABLE.map((r, i) => [i + 1, ...r]))('row %i: %s / %s / %j / tester=%s / bucket=%s ⇒ %s',
    (_i, source, contentType, row, tester, bucket, track) => {
      const user = { id: bucket ? ids[bucket] : 'u-x', phone: tester ? TESTER : '923009999999' };
      expect(S.decidePure(row, { source, contentType, user, entry: 'typed' }).track).toBe(track);
    });
});

describe('FflpModuleMissing — the lazy index', () => {
  test('a module that is not on disk yet throws FflpModuleMissing(name)', () => {
    const fflp = require('../../bot/shared/services/fflp');
    expect(() => fflp.engine).toThrow(fflp.FflpModuleMissing);
    try { fflp.engine; } catch (e) { expect(e.module).toBe('engine'); }
    expect(fflp.switch).toBe(S);
  });
  test('a module that IS on disk but fails to load re-throws its own error', () => {
    const fflp = require('../../bot/shared/services/fflp');
    const get = fflp._internals.lazy('x', null, () => { throw new SyntaxError('boom'); });
    expect(() => get()).toThrow(SyntaxError);
  });
});
