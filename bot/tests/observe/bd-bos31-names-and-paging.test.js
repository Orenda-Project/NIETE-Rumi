/**
 * bd-bos31 (names) and bd-43474 (paging) — the Pending Debriefs list.
 *
 * bd-bos31. Bushra (R42), Rifat (R46) and Nouman all reported rows reading
 * "Observation" with no teacher name. It looked like missing data — 166 of 323
 * leader observations have no analysis_data.teacher_delivery.teacher_name — but
 * it is NOT. listPendingDebriefs already pipes rows through _withObservedTeacher,
 * which joins observation_schedules and attaches a top-level teacher_name; the
 * legacy WhatsApp list uses it (bd-2669) and the Flow screen ignored it, reading
 * only the analysis_data field. Measured on prod: the schedule supplies a name
 * for 104 of the 166, and on all 104 the schedule's coach matches the observing
 * coach. So this is a read-path fix, not a backfill.
 *
 *   Deliberately NOT sourced from coaching_sessions.user_id: on 65 of those 166
 *   rows user_id IS the observer, and the roles break down 53 coach / 111
 *   teacher / 2 principal. Where a schedule row also exists the two names agree
 *   just 2 times in 104. Backfilling from user_id would have labelled
 *   observations with the COACH's name — worse than blank.
 *
 * bd-43474. listUnsentReports and listPendingDebriefs each cap at
 * MAX_PENDING_ROWS = 9 — a WhatsApp interactive-list limit (9 + the sentinel =
 * 10). The Flow's NavigationList holds 20, so the Flow was inheriting a
 * constraint that does not apply to it. Rifat has 13 rows and could see 9;
 * Fatima 11; Warda 10.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

const mk = (n, prefix, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-${i}`, created_at: `2026-08-${String(10 + (i % 9)).padStart(2, '0')}T09:00:00Z`,
  analysis_data: {}, ...extra,
}));

const loadHandler = (pendings, unsent) => {
  jest.resetModules();
  jest.doMock('../../shared/services/observe/observe-debrief.service', () => ({
    listPendingDebriefs: async (_u, opts = {}) => {
      const o = opts.offset || 0; const l = opts.limit == null ? 9 : opts.limit;
      return pendings.slice(o, o + l);
    },
    listUnsentReports: async (_u, opts = {}) => {
      const o = opts.offset || 0; const l = opts.limit == null ? 9 : opts.limit;
      return unsent.slice(o, o + l);
    },
    countPending: async () => pendings.length + unsent.length,
  }), { virtual: true });
  return require('../../shared/handlers/observe-visit-flow.handler');
};

describe('bd-bos31 · the row shows WHO, using the name the query already resolved', () => {
  it('prefers the schedule-resolved teacher_name over the empty analysis_data field', async () => {
    const H = loadHandler([{ id: 's1', created_at: '2026-08-18T09:00:00Z', analysis_data: {}, teacher_name: 'Nighat Sultana' }], []);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    expect(items[0]['main-content'].title).toBe('Nighat Sultana');
  });

  it('still uses the analysis_data name when that is the only one there', async () => {
    const H = loadHandler([{ id: 's1', created_at: '2026-08-18T09:00:00Z',
      analysis_data: { teacher_delivery: { teacher_name: 'Raja Saleem' } } }], []);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    expect(items[0]['main-content'].title).toBe('Raja Saleem');
  });

  it('falls back to "Observation" only when neither source has a name', async () => {
    const H = loadHandler([{ id: 's1', created_at: '2026-08-18T09:00:00Z', analysis_data: {} }], []);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    expect(items[0]['main-content'].title).toBe('Observation');
  });

  it('unsent-report rows get a name too — on their OWN stage screen (bd-tju8f)', async () => {
    const H = loadHandler([], [{ id: 'u1', created_at: '2026-08-18T09:00:00Z', analysis_data: {}, teacher_name: 'Bushra Tariq' }]);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'work_send' }, 'c1', null)).data.items;
    expect(items[0]['main-content'].title).toBe('Bushra Tariq');
    expect(items[0]['on-click-action'].payload.observe_visit_action).toBe('send_report');
  });

  it('the service enriches unsent reports, not just pending debriefs', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/services/observe/observe-debrief.service.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function listUnsentReports'), src.indexOf('async function listUnsentReports') + 2000);
    expect(fn).toMatch(/_withObservedTeacher/);
  });
});

describe('bd-43474 · a coach can page through her whole backlog', () => {
  it('shows more than the old 9-row cap on one screen', async () => {
    const H = loadHandler(mk(13, 'p'), []);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    const real = items.filter((i) => i.id !== 'more' && i.id !== 'none');
    expect(real.length).toBe(13);          // Rifat's real backlog, all on screen
  });

  it('never exceeds what a NavigationList can render', async () => {
    const H = loadHandler(mk(40, 'p'), []);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    expect(items.length).toBeLessThanOrEqual(20);
  });

  it('offers a "show more" row when there is another page, carrying the offset', async () => {
    const H = loadHandler(mk(40, 'p'), []);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    const more = items.find((i) => i.id === 'more');
    expect(more).toBeTruthy();
    expect(more['on-click-action'].payload.step).toBe('debriefs');
    expect(more['on-click-action'].payload.offset).toBeGreaterThan(0);
  });

  it('the next page returns the following rows, not the same ones', async () => {
    const H = loadHandler(mk(40, 'p'), []);
    const p1 = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    const off = p1.find((i) => i.id === 'more')['on-click-action'].payload.offset;
    const p2 = (await H.handle('c1', 'data_exchange', 'DEBRIEFS', { step: 'debriefs', offset: off }, 'c1', null)).data.items;
    const ids1 = new Set(p1.map((i) => i.id));
    expect(p2.filter((i) => i.id !== 'more' && ids1.has(i.id))).toHaveLength(0);
  });

  it('stages page independently — debriefs and sends never share a screen (bd-tju8f)', async () => {
    // The stitched-offset bug class is now structurally impossible: each stage
    // pages its own query on its own screen. Verify both in one setup.
    const H = loadHandler(mk(25, 'p'), mk(10, 'u'));
    const p1 = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    const off = p1.find((i) => i.id === 'more')['on-click-action'].payload.offset;
    const p2 = (await H.handle('c1', 'data_exchange', 'DEBRIEFS', { step: 'debriefs', offset: off }, 'c1', null)).data.items;
    const ids1 = new Set(p1.filter((i) => i.id !== 'more').map((i) => i.id));
    expect(p2.filter((i) => i.id !== 'more' && ids1.has(i.id))).toHaveLength(0);
    const seenDebrief = new Set([...ids1, ...p2.filter((i) => i.id !== 'more').map((i) => i.id)]);
    expect(seenDebrief.size).toBe(25);
    const sends = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'work_send' }, 'c1', null)).data.items;
    expect(sends.filter((i) => i.id !== 'more' && i.id !== 'none')).toHaveLength(10);
    for (const s of sends.filter((i) => i.id !== 'more' && i.id !== 'none')) {
      expect(s['on-click-action'].payload.observe_visit_action).toBe('send_report');
    }
  });

  it('no "show more" when everything already fits', async () => {
    const H = loadHandler(mk(5, 'p'), []);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    expect(items.find((i) => i.id === 'more')).toBeFalsy();
  });

  it('an empty list still renders the placeholder — NavigationList needs a row', async () => {
    const H = loadHandler([], []);
    const items = (await H.handle('c1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'c1', null)).data.items;
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
