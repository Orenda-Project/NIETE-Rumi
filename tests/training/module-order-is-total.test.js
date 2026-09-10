/**
 * bd-u2td8 — the module a teacher is shown next is decided by an unstable sort.
 *
 * WHAT IS WRONG
 * -------------
 * Six active courses carry DUPLICATE order_index values, and two of them carry
 * nothing else: all 14 modules of Beacon House "AI literacy" (course 48) and all
 * 14 of "AI Literacy" (course 53) sit at order_index = 1. Two more course pairs
 * tie inside a level. Every one of those six courses is under
 * module_unlock_logic='chain', so the order is not cosmetic — it decides which
 * module unlocks next. 4,158 distinct teachers have progress in one of them.
 *
 * Nothing breaks the tie:
 *
 *   content-delivery.js:184   .order('order_index')                  findNextModule
 *   content-delivery.js:246   .order('order_index').limit(1)         the FIRST module
 *   endpoint.js:701           (no .order() at all)                   the picker
 *   endpoint.js:709           levelModules.sort(... a.order_index - b.order_index)
 *
 * Postgres guarantees no row order for equal sort keys, and Array.prototype.sort
 * is stable — so the JS sort faithfully preserves whatever arbitrary order the
 * query plan returned. Change the plan (seq scan vs index scan, a vacuum, an
 * update) and the "next" module changes with it.
 *
 * WHAT THIS TEST PINS
 * -------------------
 * Only determinism: the same rows in a different arrival order must produce the
 * same sequence. It does NOT pin the sequence being pedagogically right — the 28
 * tied modules still need a real order_index backfilled by someone who knows the
 * intended progression. That is a content fix, not a code one.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(),
  getCurrentCorrelationId: () => null,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }), { virtual: true });
jest.mock('pdfkit', () => jest.fn(), { virtual: true });

const USER = 'u-1';
const LEVEL = 20;

// One course, four modules, ALL tied at order_index 1 — course 48's shape.
const COURSE = { id: 48, title: 'AI literacy', order_index: 1, level_id: LEVEL };
const MODULES = [
  { id: 293, course_id: 48, title: 'AI for Lesson Planning', order_index: 1 },
  { id: 294, course_id: 48, title: 'What is AI',             order_index: 1 },
  { id: 295, course_id: 48, title: 'Model vs Agent',         order_index: 1 },
  { id: 296, course_id: 48, title: 'AI Literacy Framework',  order_index: 1 },
];

/**
 * supabase stand-in. The important behaviour: it returns rows in the order the
 * test hands them over, applying ONLY the sort keys the query actually asked
 * for. That is what a real plan is free to do, and it is the thing a mock that
 * always sorts by id would hide.
 */
function makeSupabase(moduleArrival) {
  const build = (table) => {
    const st = { table, filters: {}, orders: [], limited: null };
    const chain = {
      select() { return chain; },
      eq(c, v) { st.filters[c] = v; return chain; },
      in() { return chain; },
      order(col, opts) { st.orders.push({ col, asc: opts ? opts.ascending !== false : true }); return chain; },
      limit(n) { st.limited = n; return chain; },
      then(res) { return res(settle()); },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: null }),
    };
    function rows() {
      let r = [];
      if (st.table === 'training_courses') r = [COURSE];
      else if (st.table === 'training_modules') r = [...moduleArrival];
      else if (st.table === 'teacher_training_progress') r = [];      // nothing done yet
      else if (st.table === 'training_levels') r = [{ id: LEVEL, vendor_id: 'v-1', name: 'General Science' }];
      else if (st.table === 'training_vendors') r = [{ id: 'v-1', key: 'BEACONHOUSE', module_unlock_logic: 'chain' }];
      if (st.orders.length) {
        r = [...r].sort((a, b) => {
          for (const { col, asc } of st.orders) {
            const av = a[col], bv = b[col];
            const cmp = (av === bv) ? 0 : (av > bv ? 1 : -1);
            if (cmp !== 0) return asc ? cmp : -cmp;
          }
          return 0;   // tie -> arrival order survives, exactly like a real plan
        });
      }
      if (st.limited) r = r.slice(0, st.limited);
      return r;
    }
    const settle = () => ({ data: rows(), error: null });
    return chain;
  };
  return { from: (t) => build(t), rpc: jest.fn() };
}

function load(moduleArrival) {
  jest.resetModules();
  jest.doMock('../../bot/shared/config/supabase', () => makeSupabase(moduleArrival));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendInteractiveMessage: jest.fn().mockResolvedValue(true),
    sendDocumentByLink: jest.fn().mockResolvedValue(true),
  }));
  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2/signed'),
    buildR2PublicUrl: (k) => `https://r2/${k}`,
  }));
  return require('../../bot/shared/routes/teacher-training-endpoint');
}

describe('bd-u2td8 — tied order_index must still yield ONE definite sequence', () => {
  test('the picker returns the same order however the rows arrive', async () => {
    const forward = load(MODULES);
    expect(typeof forward.loadModulesWithProgress).toBe('function');
    const a = await forward.loadModulesWithProgress(USER, LEVEL);

    const reversed = load([...MODULES].reverse());
    const b = await reversed.loadModulesWithProgress(USER, LEVEL);

    expect(a.map(m => m.id)).toEqual(b.map(m => m.id));
  });

  test('and the module marked "next" is the same one either way', async () => {
    const forward = load(MODULES);
    const a = await forward.loadModulesWithProgress(USER, LEVEL);
    const reversed = load([...MODULES].reverse());
    const b = await reversed.loadModulesWithProgress(USER, LEVEL);

    const nextOf = (list) => (list.find(m => m.lock === 'next') || {}).id;
    expect(nextOf(a)).toBeDefined();
    expect(nextOf(a)).toBe(nextOf(b));
  });

  test('a genuine order_index still wins over the tiebreaker (regression guard)', async () => {
    const ordered = [
      { id: 999, course_id: 48, title: 'Last by id, first by order', order_index: 1 },
      { id: 100, course_id: 48, title: 'First by id, last by order', order_index: 9 },
    ];
    const m = load(ordered);
    const out = await m.loadModulesWithProgress(USER, LEVEL);
    // order_index 1 must precede order_index 9 regardless of id.
    expect(out.map(x => x.id)).toEqual([999, 100]);
  });
});
