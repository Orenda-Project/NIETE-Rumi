'use strict';
/**
 * P2 corpus wiring: resolveCorpusRef (asset_id → version keys) + the rich label rendering through
 * buildLPSelectionList. These are what let a selected corpus LP carry the keys the fidelity pass needs.
 */
const { resolveCorpusRef } = require('../../../bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service');
const { buildLPSelectionList } = require('../../../bot/shared/services/coaching/lp-coaching/lp-selection-list.service');

// chainable supabase double: .from().select().eq().maybeSingle() resolves to `result`
function mockClient(result) {
  const calls = { eq: {} };
  const chain = {
    select() { return chain; },
    eq(c, v) { calls.eq[c] = v; return chain; },
    maybeSingle() { return Promise.resolve(result); },
  };
  return { calls, from(t) { calls.table = t; return chain; } };
}

describe('resolveCorpusRef', () => {
  test('asset_id → { lesson_id, version_stamp, content_hash } from niete_lp_assets', async () => {
    const c = mockClient({ data: { lesson_id: 'grade_5_math_ch5_seg3', version_stamp: 'v8', content_hash: 'h' }, error: null });
    const ref = await resolveCorpusRef('asset-uuid-1', c);
    expect(c.calls.table).toBe('niete_lp_assets');
    expect(c.calls.eq.id).toBe('asset-uuid-1');
    expect(ref).toEqual({ lesson_id: 'grade_5_math_ch5_seg3', version_stamp: 'v8', content_hash: 'h' });
  });

  test('a legacy lesson_plans id (no matching asset) → null → caller falls back', async () => {
    expect(await resolveCorpusRef('lp-1', mockClient({ data: null, error: null }))).toBeNull();
  });

  test('null/empty id → null (guard)', async () => {
    expect(await resolveCorpusRef(null, mockClient({ data: {}, error: null }))).toBeNull();
  });

  test('a DB error → null (non-blocking: never breaks the selection)', async () => {
    expect(await resolveCorpusRef('x', mockClient({ data: null, error: new Error('boom') }))).toBeNull();
  });
});

describe('buildLPSelectionList renders the rich D25 label for enriched LPs', () => {
  test('an enriched LP row shows topic + "Grade · Ch·Day · pages · recency"', () => {
    const enriched = [{
      id: 'asset-1', lesson_id: 'grade_5_math_ch5_seg3', topic: 'Adding unlike fractions',
      grade: '5', subject: 'math', chapter_number: 5, day_label: 'Day 3', pages_label: 'p.113–115',
      created_at: '2026-08-10T09:00:00Z',
    }];
    const res = buildLPSelectionList('sess-1', enriched, 'en');
    const row = res.listData.action.sections.find((s) => s.title === 'Recent Lesson Plans').rows[0];
    expect(row.id).toBe('lp_select_asset-1_sess-1'); // asset_id → selection id the linker resolves
    expect(row.title).toBe('Adding unlike fractions');
    expect(row.description).toContain('Grade 5 Math');
    expect(row.description).toContain('Ch5 Day 3');
    expect(row.description).toContain('p.113–115');
  });
});
