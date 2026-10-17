'use strict';
/**
 * A class link on a phone that already holds a child (app_settings `web_quiz_link_known_child`, JSON true only).
 *
 * A child who joined on their own is kept by their phone: opening their home (`/quiz` → the hub) trusts this browser
 * for them (web-quiz-hub-device deviceTrusted). When the teacher's class link is later opened in the same browser, the
 * page asks the server which children this browser holds and asks "Is it <First>?" before the name box; "Yes" starts
 * the session as THAT child (the one id the child is known by), so the finish reaches the home `/quiz` opens and no
 * second child is made. A browser that holds nobody (a forwarded link on a fresh phone) is answered nobody. Switch off:
 * no `link_known` in the payload, nobody answered, and a `known` start is today's unknown chip.
 * Supabase, SQS and Redis are the faked boundaries; the device trust, the session write and the finish run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn(async function set(k, v) { if (!this._up) return false; store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const HubDevice = require('../../../shared/services/quiz/web-quiz-hub-device');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Roster = require('../../../shared/services/quiz/web-quiz-roster');
const Home = require('../../../shared/services/quiz/web-quiz-hub-home');

const KEY = 'web_quiz_link_known_child';
const SELF = '55555555-5555-4555-8555-000000000001';    // joined on their own, bound to the family phone
const SIB = '55555555-5555-4555-8555-000000000002';     // a sibling joined on the same phone
const OLD = '55555555-5555-4555-8555-000000000003';     // an earlier record of SELF, merged into SELF
const DEV = 'dddddddddddddddddddddd';                   // the family phone's browser
const FRESH = 'eeeeeeeeeeeeeeeeeeeeee';                 // a phone the link was forwarded to
const chip = (id) => T.chipId(F.SC, id);

let db;
function seed({ flag = 'v2', known = true, canon = false } = {}) {
  db = F.db({ flag, classes: 'one' });
  if (known !== undefined) db.app_settings.push({ key: KEY, value: known });
  if (canon) db.app_settings.push({ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_identity_canon', value: true });
  db.students.push(
    { id: SELF, student_name: 'Sadia Testwala', student_name_urdu: 'سعدیہ', list_id: null, enrolled_by_user_id: null, phone: null, is_active: true, status: 'active', created_at: '2026-10-16T00:00:00Z' },
    { id: SIB, student_name: 'Iqra Testwala', list_id: null, enrolled_by_user_id: null, phone: null, is_active: true, status: 'active', created_at: '2026-10-16T00:00:00Z' },
    { id: OLD, student_name: 'Sadia', list_id: null, enrolled_by_user_id: null, phone: null, is_active: false, status: 'merged', merged_into: SELF, created_at: '2026-10-15T00:00:00Z' },
  );
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdRoster._resetCache(); Roster._resetCache(); IdFlags._resetCache(); HubFlags._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-link-known')._resetCache(); } catch (_) { /* not there on the base */ }
}
// The child's home opened on this browser (`/quiz` → the hub): the hub trusts the browser for the token's children.
const homeOpened = (ids = [SELF], device = DEV) => HubDevice.deviceTrusted(T.signHub(ids), device);
const known = (device = DEV, code = 'AB12CD') => WQ.knownKids({ code, device_ref: device });

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  redis._store.clear();
  redis._up = true;
});
afterAll(() => { process.env = SAVED; });

for (const [label, flag] of [['identity v2', 'v2'], ['legacy path', null]]) {
  describe(`switch on (${label})`, () => {
    beforeEach(() => seed({ flag }));

    test('the class link\'s payload says the page may ask', async () => {
      const q = await WQ.getQuiz('AB12CD');
      expect(q.link_known).toBe(true);
    });

    test('a phone that holds ONE child: that child\'s card (first name only) — "Is it Sadia?"', async () => {
      await homeOpened();
      const r = await known();
      expect(r).toEqual({ kids: [{ chip: chip(SELF), first: 'Sadia', animal: T.animalFor(SELF) }] });
      expect(JSON.stringify(r)).not.toContain('Testwala');
    });

    test('"Yes" starts the session as the held child: the finish is on that child\'s id, and no student row is made', async () => {
      await homeOpened();
      const before = db.students.length;
      const s = await WQ.startSession({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV });
      expect(s.child.chip).toBe(chip(SELF));
      expect(db.students.length).toBe(before);
      const row = db.quiz_sessions.find((x) => x.student_id === SELF);
      expect(row).toEqual(expect.objectContaining({ share_code_id: F.SC, device_ref: DEV, status: 'in_progress' }));
      // The finish lands on the same child: the home's day-dot for today is filled from that child's history.
      row.status = 'completed';
      row.completed_at = new Date().toISOString();
      const stamps = db.quiz_sessions.filter((x) => x.student_id === SELF && x.status === 'completed').map((x) => x.completed_at);
      expect(Home.headOf(stamps).today).toBe(true);
    });

    test('a phone that holds TWO children: both cards ("Who is playing?"), first names only, newest first', async () => {
      await homeOpened([SELF]);
      await homeOpened([SIB]);
      const r = await known();
      expect(r.kids.map((k) => k.first)).toEqual(['Iqra', 'Sadia']);
      expect(r.kids.map((k) => k.chip)).toEqual([chip(SIB), chip(SELF)]);
    });

    test('a forwarded link on a fresh phone names NOBODY, and the held child\'s chip cannot be played there', async () => {
      await homeOpened();
      expect(await known(FRESH)).toEqual({ kids: [] });
      expect(await known(null)).toEqual({ kids: [] });
      const before = db.quiz_sessions.length;
      await expect(WQ.startSession({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: FRESH })).rejects.toMatchObject({ status: 404 });
      expect(db.quiz_sessions.length).toBe(before);
    });

    test('a classmate this phone never held is never named, even one who played this code here', async () => {
      await homeOpened();
      db.quiz_sessions.push(F.done('s-mate', F.kid(1), 'Ayesha Testwala', 3, 1, { device_ref: DEV }));
      const r = await known();
      expect(r.kids.map((k) => k.chip)).toEqual([chip(SELF)]);
      expect(JSON.stringify(r)).not.toContain('Ayesha');
      // a chip this browser does not hold is never resolved as a held child: it takes today's chip rules, as any card does
      expect(await require('../../../shared/services/quiz/web-quiz-link-known').kidFor({ shareCodeId: F.SC }, chip(F.kid(1)), DEV)).toBeNull();
    });

    test('"Someone else": the name box is today\'s — a typed name makes its own child as before', async () => {
      await homeOpened();
      const before = db.students.length;
      const s = await WQ.startSession({ code: 'AB12CD', new: { name: 'Dua Testwala', force: true }, device_ref: DEV });
      expect(s.child.first).toBe('Dua');
      expect(db.students.length).toBe(before + 1);
    });

    test('never on a friend\'s challenge code, nor the teacher\'s preview', async () => {
      await homeOpened();
      expect(await known(DEV, 'FR13ND')).toEqual({ kids: [] });
      const q = await WQ.getQuiz('FR13ND');
      expect(q.link_known).toBeUndefined();
    });

    test('a left or merged child is never offered; Redis down = nobody', async () => {
      await homeOpened([SELF, SIB]);
      db.students.find((x) => x.id === SIB).is_active = false;
      expect((await known()).kids.map((k) => k.chip)).toEqual([chip(SELF)]);
      redis._up = false;
      expect(await known()).toEqual({ kids: [] });
    });
  });
}

describe('the one id the child is known by', () => {
  test('a phone trusted with an older, merged record offers the child it was merged into, and the session is on that child', async () => {
    seed({ canon: true });
    await homeOpened([OLD]);
    const r = await known();
    expect(r.kids).toEqual([{ chip: chip(SELF), first: 'Sadia', animal: T.animalFor(SELF) }]);
    await WQ.startSession({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV });
    expect(db.quiz_sessions.filter((x) => x.student_id === SELF)).toHaveLength(1);
    expect(db.quiz_sessions.filter((x) => x.student_id === OLD)).toHaveLength(0);
  });

  test('an Urdu class link shows the name as written in Urdu', async () => {
    seed();
    db.quiz_share_codes.find((c) => c.id === F.SC).language = 'ur';
    await homeOpened();
    expect((await known()).kids[0].first).toBe('سعدیہ');
  });

  test('at most four cards, the newest the phone was trusted with first', async () => {
    seed();
    const ids = Array.from({ length: 6 }, (_, i) => `55555555-5555-4555-8555-0000000001${i}0`);
    ids.forEach((id, i) => db.students.push({ id, student_name: `Kid${i} Testwala`, list_id: null, is_active: true, status: 'active' }));
    for (const id of ids) await homeOpened([id]);
    const r = await known();
    expect(r.kids.map((k) => k.first)).toEqual(['Kid5', 'Kid4', 'Kid3', 'Kid2']);
  });
});

describe('golden: switch off', () => {
  for (const [name, value] of [['no row', undefined], ['false', false], ['the string "true" (JSON true only)', 'true'], ['a number', 1]]) {
    test(`${name}: no link_known in the payload, nobody answered, and a known start is today's unknown chip`, async () => {
      seed({ known: value });
      if (value === undefined) db.app_settings = db.app_settings.filter((r) => r.key !== KEY);
      await homeOpened();
      const q = await WQ.getQuiz('AB12CD');
      expect(Object.prototype.hasOwnProperty.call(q, 'link_known')).toBe(false);
      expect(await known()).toEqual({ kids: [] });
      const before = db.quiz_sessions.length;
      await expect(WQ.startSession({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'chip_unknown' } });
      expect(db.quiz_sessions.length).toBe(before);
    });
  }

  test('off: the payload is byte-identical to a code with no switch row at all', async () => {
    seed({ known: false });
    const off = await WQ.getQuiz('AB12CD');
    seed({ known: undefined });
    db.app_settings = db.app_settings.filter((r) => r.key !== KEY);
    const none = await WQ.getQuiz('AB12CD');
    expect(JSON.stringify(off)).toBe(JSON.stringify(none));
  });

  test('a settings read that fails = off (never cached)', async () => {
    seed();
    await homeOpened();
    const from = supabase.from;
    supabase.from = (t) => (t === 'app_settings' ? { select: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'down' } }) }) } : from(t));
    expect(await known()).toEqual({ kids: [] });
    supabase.from = from;
    expect((await known()).kids).toHaveLength(1);
  });
});
