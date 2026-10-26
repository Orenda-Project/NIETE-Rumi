'use strict';
/**
 * bd-gzfdu9 (VIDREC), r-ab ab/EVENTS_SCHEMA.md §2: the status webhook turns Meta's delivered / read / failed for the
 * clip message into `video_reco_events` rows (delivered / read / send_failed + the Meta code), looked up by the wamid
 * the send stored on the row. Unknown wamids are ignored; a repeat is a no-op (the first-only unique index);
 * flag off → no read at all. Never throws.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const S = require('../../../bot/shared/services/coaching/video-reco/status-events');

const REC = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
function db({ rows = [{ id: REC, wamid: 'wamid.V' }], insertError = null } = {}) {
  const log = [];
  return {
    log,
    from(table) {
      const q = { table, filters: [] };
      const chain = {
        select: () => chain,
        eq: (f, v) => { q.filters.push([f, v]); return chain; },
        maybeSingle: async () => {
          log.push(['read', table, ...q.filters.flat()]);
          const hit = rows.find((r) => q.filters.every(([f, v]) => r[f] === v));
          return { data: hit ? { id: hit.id } : null, error: null };
        },
        insert: async (row) => { log.push(['insert', table, row]); return { error: insertError }; },
      };
      return chain;
    },
  };
}
const st = (status, extra = {}) => ({ id: 'wamid.V', status, timestamp: '1792230213', ...extra });

test.each([['delivered', 'delivered'], ['read', 'read']])('%s → a %s event on the clip, at Meta\'s timestamp, surface wa', async (status, event) => {
  const d = db();
  await expect(S.recordStatus(st(status), { supabase: d, enabled: () => true })).resolves.toBe(true);
  expect(d.log).toEqual([
    ['read', 'video_recommendations', 'wamid', 'wamid.V'],
    ['insert', 'video_reco_events', { recommendation_id: REC, event, surface: 'wa', created_at: new Date(1792230213 * 1000).toISOString() }],
  ]);
});

test('failed → send_failed with the Meta code', async () => {
  const d = db();
  await S.recordStatus(st('failed', { errors: [{ code: 131047 }] }), { supabase: d, enabled: () => true });
  expect(d.log[1][2]).toMatchObject({ event: 'send_failed', code: '131047' });
});

test('an unknown wamid (any other message): one indexed read, nothing written', async () => {
  const d = db({ rows: [] });
  await expect(S.recordStatus(st('delivered'), { supabase: d, enabled: () => true })).resolves.toBe(false);
  expect(d.log.map((e) => e[0])).toEqual(['read']);
});

test('a second delivered (unique index 23505) is a quiet no-op', async () => {
  const d = db({ insertError: { code: '23505', message: 'duplicate key' } });
  await expect(S.recordStatus(st('delivered'), { supabase: d, enabled: () => true })).resolves.toBe(false);
});

test.each([['sent'], ['deleted'], [undefined]])('status %p: nothing read', async (status) => {
  const d = db();
  await S.recordStatus(st(status), { supabase: d, enabled: () => true });
  expect(d.log).toEqual([]);
});

test('flag off: nothing read', async () => {
  const d = db();
  await expect(S.recordStatus(st('delivered'), { supabase: d, enabled: () => false })).resolves.toBe(false);
  expect(d.log).toEqual([]);
});

test('no flags.js on disk (engine not deployed): off, nothing required, no throw', async () => {
  await expect(S.recordStatus(st('delivered'))).resolves.toBe(false);
});

test('the database throws → false, never throws', async () => {
  const d = { from: () => { throw new Error('pool'); } };
  await expect(S.recordStatus(st('read'), { supabase: d, enabled: () => true })).resolves.toBe(false);
});
