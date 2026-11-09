/**
 * Reading Hour & Numeracy (FLN) is ICT's, not Gilgit-Baltistan's (operator, 9 Nov 2026: "Those should not be the
 * subjects for GB"). dashboard/lib/fln-access.js decides it where the lesson shelf decides GB vs ICT: teacher-books
 * bookKeysForUser — her region names its own books (region_features.book_keys) → no FLN at all: `lessons` and
 * `share` are false, so the band on the lessons page is not drawn, every /portal/fln/* page says "not available",
 * and every FLN route answers 404 (a link or a typed URL included). An ICT teacher or coach is exactly as before.
 *
 * The portal service does not install pino, which the bot's logger loads: teacher-books must load and decide in the
 * portal process with the bot logger unloadable (the second block runs that way).
 */
process.env.FLAG_CACHE_TTL_MS = '0';
const ICT_TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const ICT_COACH = '1a2b3c4d-0000-4c55-9a51-2d7f0e3b9c11';
const GB_TEACHER = '9b0e7c1d-2222-4c55-9a51-2d7f0e3b9c12';
const GB_COACH = '9b0e7c1d-3333-4c55-9a51-2d7f0e3b9c13';
const GB_BOOKS = ['gb_g1_english', 'gb_g1_urdu', 'gb_g1_maths', 'grade_1_islamiat'];
let settings; let users; let regionRows;

function fakeSupabase() {
  return {
    from(table) {
      const q = { filters: {} };
      const api = {
        select() { return api; },
        eq(col, val) { q.filters[col] = val; return api; },
        async maybeSingle() {
          if (table === 'app_settings') {
            return { data: q.filters.key in settings ? { value: settings[q.filters.key] } : null, error: null };
          }
          if (table === 'users') return { data: users[q.filters.id] || null, error: null };
          return { data: null, error: null };
        },
      };
      // teacher-books reads every region row at once (no filter, awaited directly).
      if (table === 'region_features') api.then = (ok, ko) => Promise.resolve({ data: regionRows, error: null }).then(ok, ko);
      return api;
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  settings = { portal_fln_lessons: 'teachers', portal_fln_share: true };
  users = {
    [ICT_TEACHER]: { id: ICT_TEACHER, role: 'teacher', preferred_language: 'ur', region: 'Sihala' },
    [ICT_COACH]: { id: ICT_COACH, role: 'coach', preferred_language: 'en', region: 'Tarnol' },
    [GB_TEACHER]: { id: GB_TEACHER, role: 'teacher', preferred_language: 'ur', region: 'Gilgit-Baltistan' },
    [GB_COACH]: { id: GB_COACH, role: 'coach', preferred_language: 'en', region: 'Gilgit-Baltistan' },
  };
  regionRows = [
    { region: 'sihala', display_name: 'Sihala', book_keys: null },
    { region: 'tarnol', display_name: 'Tarnol', book_keys: null },
    { region: 'gilgit-baltistan', display_name: 'Gilgit-Baltistan', book_keys: GB_BOOKS },
  ];
  jest.doMock('../../dashboard/config/supabase', () => fakeSupabase());
});

const load = () => require('../../dashboard/lib/fln-access');

async function run(chain, userId) {
  const req = { session: { portalUserId: userId } };
  let status = 200; let reached = false;
  const res = { set() { return this; }, status(c) { status = c; return this; }, json() { return this; } };
  for (const mw of chain) {
    let advanced = false;
    // eslint-disable-next-line no-await-in-loop
    await mw(req, res, () => { advanced = true; });
    if (!advanced) return { status, reached };
  }
  reached = true;
  return { status, reached };
}

function gbCases() {
  it('an ICT teacher and an ICT coach see FLN exactly as before', async () => {
    expect(await load().flnAccess(ICT_TEACHER)).toEqual({ lessons: true, share: false, role: 'teacher', ui_lang: 'ur' });
    expect(await load().flnAccess(ICT_COACH)).toEqual({ lessons: true, share: true, role: 'coach', ui_lang: 'en' });
  });

  it('a GB teacher gets no FLN: no band, no lists, no plan pages', async () => {
    expect(await load().flnAccess(GB_TEACHER)).toEqual({ lessons: false, share: false, role: 'teacher', ui_lang: 'ur' });
    expect(await run(load().requireFln.lessons, GB_TEACHER)).toEqual({ status: 404, reached: false });
  });

  it('a GB coach gets neither the lessons nor Share', async () => {
    expect(await load().flnAccess(GB_COACH)).toEqual({ lessons: false, share: false, role: 'coach', ui_lang: 'en' });
    expect(await run(load().requireFln.share, GB_COACH)).toEqual({ status: 404, reached: false });
  });

  it('no region names books (an environment before GB): everyone keeps FLN', async () => {
    regionRows = regionRows.map((r) => ({ ...r, book_keys: null }));
    expect((await load().flnAccess(GB_TEACHER)).lessons).toBe(true);
  });

  it('a region_features read that fails is today\'s answer (the shelf fails open the same way)', async () => {
    regionRows = null;
    jest.doMock('../../dashboard/config/supabase', () => {
      const db = fakeSupabase();
      return {
        from(t) {
          const api = db.from(t);
          if (t === 'region_features') api.then = (ok, ko) => Promise.resolve({ data: null, error: { message: 'down' } }).then(ok, ko);
          return api;
        },
      };
    });
    expect((await load().flnAccess(GB_TEACHER)).lessons).toBe(true);
  });
}

describe('FLN for a region that names its own books (GB)', () => {
  beforeEach(() => {
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  });
  gbCases();
});

describe('…in the portal process, where the bot logger cannot load (no pino)', () => {
  beforeEach(() => {
    jest.doMock('../../bot/shared/utils/logger', () => { throw new Error("Cannot find module 'pino'"); });
  });
  gbCases();
});
