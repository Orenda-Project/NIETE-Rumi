'use strict';
/**
 * P2 — the recent-LP SOURCE for the coaching selection list. Reads niete_lp_downloads (dedup by
 * lesson_id, recent-first), enriches each via the V8 catalog (topic/day/pages/chapter), and carries the
 * (lesson_id, version_stamp, content_hash) keys the fidelity resolver needs. DB + catalog injected.
 */
const { getRecentFidelityLps } = require('../../../bot/shared/services/coaching/lp-coaching/recent-fidelity-lps.service');

// chainable supabase double: .from().select().eq().eq().order() resolves to `result`
function mockSb(result) {
  const calls = { eq: {} };
  const chain = {
    select() { return chain; },
    eq(c, v) { calls.eq[c] = v; return chain; },
    order() { return Promise.resolve(result); },
  };
  return { calls, from(t) { calls.table = t; return chain; } };
}
const cat = (lessonId) => {
  const m = {
    grade_5_urdu_ch1_seg8: { lesson: { topic: 'Topic Eight', day_label: 'Day 8', pages_label: 'p.12–14' }, chapter: { number: 1, title: 'Ch One' }, book: { grade: 5, subject: 'urdu' } },
    grade_5_urdu_ch1_seg995: { lesson: { topic: null, day_label: 'Revision', pages_label: 'p.2–17' }, chapter: { number: 1, title: 'Ch One' }, book: { grade: 5, subject: 'urdu' } },
  };
  return m[lessonId] || null;
};

const dl = (lesson_id, over = {}) => ({ asset_id: `a_${lesson_id}`, lesson_id, version_stamp: 'v8', content_hash: 'h', grade: '5', subject: 'urdu', chapter_number: 1, created_at: '2026-08-20T09:00:00Z', ...over });

describe('recent-fidelity-lps', () => {
  test('dedups by lesson_id (keeps most recent), carries the fidelity keys + catalog enrichment', async () => {
    const rows = [
      dl('grade_5_urdu_ch1_seg8', { created_at: '2026-08-20T10:00:00Z' }),
      dl('grade_5_urdu_ch1_seg8', { created_at: '2026-08-20T08:00:00Z' }), // dup, older
      dl('grade_5_urdu_ch1_seg995', { created_at: '2026-08-19T10:00:00Z' }),
    ];
    const out = await getRecentFidelityLps('u1', { client: mockSb({ data: rows, error: null }), lessonById: cat });
    expect(out).toHaveLength(2); // deduped
    const first = out[0];
    expect(first.lesson_id).toBe('grade_5_urdu_ch1_seg8');
    expect(first.id).toBe('a_grade_5_urdu_ch1_seg8'); // asset_id → selection id
    expect(first.version_stamp).toBe('v8');
    expect(first.content_hash).toBe('h');
    expect(first.topic).toBe('Topic Eight');
    expect(first.day_label).toBe('Day 8');
    expect(first.pages_label).toBe('p.12–14');
    expect(first.chapter_number).toBe(1);
  });

  test('queries only this user\'s SENT downloads', async () => {
    const sb = mockSb({ data: [], error: null });
    await getRecentFidelityLps('u9', { client: sb, lessonById: cat });
    expect(sb.calls.table).toBe('niete_lp_downloads');
    expect(sb.calls.eq.user_id).toBe('u9');
    expect(sb.calls.eq.status).toBe('sent');
  });

  // bd-zrlcp — the default dropped from 15 to 8 to match what the LP-selection
  // list can actually render: WhatsApp caps an interactive list at 10 rows and
  // the Options section always takes 2. At 15 the prompt was silently refused by
  // our own send helper and the session stranded at awaiting_lesson_plan.
  test('caps the list at the LP-selection row budget (default 8)', async () => {
    const many = Array.from({ length: 25 }, (_, i) => dl(`grade_5_urdu_ch1_seg${i}`));
    const out = await getRecentFidelityLps('u1', { client: mockSb({ data: many, error: null }), lessonById: () => null });
    expect(out.length).toBe(8);
  });

  test('an explicit limit still wins over the default', async () => {
    const many = Array.from({ length: 25 }, (_, i) => dl(`grade_5_urdu_ch1_seg${i}`));
    const out = await getRecentFidelityLps('u1', { client: mockSb({ data: many, error: null }), lessonById: () => null, limit: 3 });
    expect(out.length).toBe(3);
  });

  test('a lesson missing from the catalog still appears (structural fields from the download row)', async () => {
    const out = await getRecentFidelityLps('u1', { client: mockSb({ data: [dl('unknown_lesson')], error: null }), lessonById: () => null });
    expect(out).toHaveLength(1);
    expect(out[0].lesson_id).toBe('unknown_lesson');
    expect(out[0].topic).toBeNull(); // no catalog topic → formatter falls back to day/segment
    expect(out[0].grade).toBe('5');
  });

  test('a DB error surfaces (caller falls back to the Yes/No path)', async () => {
    await expect(getRecentFidelityLps('u1', { client: mockSb({ data: null, error: new Error('boom') }), lessonById: cat })).rejects.toThrow('boom');
  });
});
