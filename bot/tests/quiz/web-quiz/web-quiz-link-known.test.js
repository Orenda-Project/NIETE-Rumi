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
  // A self-joined child's grade lives on the identity row (the grade tap); the quiz is grade 4.
  db.child_identity = [{ canonical_id: SELF, fixed_grade: 4 }, { canonical_id: SIB, fixed_grade: 4 }];
  db.students.push(
    { id: SELF, student_name: 'Sadia Testwala', student_name_urdu: 'سعدیہ', list_id: null, enrolled_by_user_id: null, phone: null, is_active: true, status: 'active', created_at: '2026-10-16T00:00:00Z' },
    { id: SIB, student_name: 'Iqra Testwala', list_id: null, enrolled_by_user_id: null, phone: null, is_active: true, status: 'active', created_at: '2026-10-16T00:00:00Z' },
    { id: OLD, student_name: 'Sadia Testwala', list_id: null, enrolled_by_user_id: null, phone: null, is_active: false, status: 'merged', merged_into: SELF, created_at: '2026-10-15T00:00:00Z' },
  );
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdRoster._resetCache(); Roster._resetCache(); IdFlags._resetCache(); HubFlags._resetCache();
  try { require('../../../shared/services/quiz/web-quiz-link-known')._resetCache(); } catch (_) { /* not there on the base */ }
}
// The child's home opened on this browser (`/quiz` → the hub): the hub trusts the browser for the token's children.
const homeOpened = (ids = [SELF], device = DEV) => HubDevice.deviceTrusted(T.signHub(ids), device);
// The device is the phone's wq_dv cookie, forwarded by the edge as x-wq-device — never what the page sends in the body.
const known = (device = DEV, code = 'AB12CD') => WQ.knownKids({ code }, { device });
const play = (body, device = body.device_ref) => WQ.startSession(body, { device });

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
      const s = await play({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV });
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
      await expect(play({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: FRESH })).rejects.toMatchObject({ status: 404 });
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

    test('after "Someone else", the held child typing only their FIRST name gets their one card, never a second child', async () => {
      await homeOpened();
      const before = db.students.length;
      await expect(play({ code: 'AB12CD', new: { name: 'sadia' }, device_ref: DEV }))
        .rejects.toMatchObject({ status: 409, body: { error: 'is_this_you', candidates: [expect.objectContaining({ chip: chip(SELF), first: 'Sadia' })] } });
      expect(db.students.length).toBe(before);
      // two held children with that first name: no card (today's path asks the name step's own questions)
      db.students.push({ id: '55555555-5555-4555-8555-000000000009', student_name: 'Sadia Khan Testwala', self_reported_class: 'Grade 4', list_id: null, is_active: true, status: 'active' });
      await homeOpened(['55555555-5555-4555-8555-000000000009']);
      const r = await play({ code: 'AB12CD', new: { name: 'sadia' }, device_ref: DEV }).catch((e) => e);
      expect(Boolean(r && r.body && r.body.error === 'is_this_you' && JSON.stringify(r.body).includes(chip(SELF)))).toBe(false);
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

describe('the device is the phone\'s own (x-wq-device), never what the page sends', () => {
  test('a body device_ref with no header names nobody and cannot start as the held child', async () => {
    seed();
    await homeOpened();
    expect(await WQ.knownKids({ code: 'AB12CD', device_ref: DEV })).toEqual({ kids: [] });
    await expect(WQ.startSession({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV })).rejects.toMatchObject({ status: 404 });
    // the trusted ref in the body and a fresh phone in the header: the header decides
    expect(await WQ.knownKids({ code: 'AB12CD', device_ref: DEV }, { device: FRESH })).toEqual({ kids: [] });
  });

  test('the typed first name is matched against the header phone\'s children only', async () => {
    seed();
    await homeOpened();
    const r = await WQ.startSession({ code: 'AB12CD', new: { name: 'sadia' }, device_ref: DEV }, { device: FRESH }).catch((e) => e);
    expect(Boolean(r && r.body && r.body.error === 'is_this_you' && JSON.stringify(r.body).includes(chip(SELF)))).toBe(false);
  });

  describe('the routes pass the header, never the body', () => {
    const express = require('express');
    let server; let base;
    beforeAll(async () => {
      const app = express();
      app.use(express.json());   // as the bot's server mounts it before the internal routes
      app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
      await new Promise((r) => { server = app.listen(0, r); });
      base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
    });
    afterAll(() => new Promise((r) => server.close(r)));
    const post = (path, body, device) => fetch(`${base}${path}`, { method: 'POST', headers: { 'x-api-key': 'test-key', 'content-type': 'application/json', ...(device ? { 'x-wq-device': device } : {}) }, body: JSON.stringify(body) });

    test('POST /known: the header names the held child; the body alone names nobody', async () => {
      seed();
      await homeOpened();
      expect(await (await post('/known', { code: 'AB12CD' }, DEV)).json()).toEqual({ kids: [expect.objectContaining({ chip: chip(SELF), first: 'Sadia' })] });
      expect(await (await post('/known', { code: 'AB12CD', device_ref: DEV })).json()).toEqual({ kids: [] });
    });

    test('POST /session via known: starts with the header; with the body alone it does not', async () => {
      seed();
      await homeOpened();
      expect((await post('/session', { code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV })).status).toBe(404);
      const ok = await post('/session', { code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV }, DEV);
      expect(ok.status).toBe(200);
      expect((await ok.json()).child.chip).toBe(chip(SELF));
    });
  });
});

describe('a class link names only a held child of THAT class (the sibling and other-teacher cases)', () => {
  test('a held sibling enrolled in another class is never named; the held child of this class is', async () => {
    seed();
    await homeOpened([F.kid(10)]);   // enrolled in 4-B, another class
    await homeOpened([F.kid(1)]);    // enrolled in 4-A, this link's class
    const r = await known();
    expect(r.kids.map((k) => k.chip)).toEqual([chip(F.kid(1))]);
    expect(JSON.stringify(r)).not.toContain('Zara');
    await expect(play({ code: 'AB12CD', chip: chip(F.kid(10)), via: 'known', device_ref: DEV })).rejects.toMatchObject({ status: 404 });
  });

  test('a phone that holds only children of other classes: nobody — today\'s name box', async () => {
    seed();
    await homeOpened([F.kid(10)]);
    expect(await known()).toEqual({ kids: [] });
  });

  test('a self-joined child of no class is named on a link of their grade, never on another grade\'s', async () => {
    seed();
    db.child_identity = [{ canonical_id: SELF, fixed_grade: 2 }];
    await homeOpened();
    expect(await known()).toEqual({ kids: [] });
    db.child_identity = [{ canonical_id: SELF, fixed_grade: 4 }];
    expect((await known()).kids.map((k) => k.chip)).toEqual([chip(SELF)]);
  });

  test('a held child of another grade who already played THIS code is named (their own link)', async () => {
    seed();
    db.child_identity = [{ canonical_id: SELF, fixed_grade: 2 }];
    db.quiz_sessions.push(F.done('s-own', SELF, 'Sadia Testwala', 3, 2, { device_ref: DEV }));
    await homeOpened();
    expect((await known()).kids.map((k) => k.chip)).toEqual([chip(SELF)]);
  });
});

describe('the class filter adds no serial wave', () => {
  test('its id-free reads start beside the held-children read; its id reads start together, the moment the ids land', async () => {
    seed();
    await homeOpened([F.kid(1)]);   // on 4-A's list: the list read is one of the id reads
    await homeOpened([SELF]);
    const Db = require('../../../shared/services/quiz/web-quiz-db-deadline');
    const real = Db.read;
    let settled = 0;
    const log = [];
    const spy = jest.spyOn(Db, 'read').mockImplementation((label, ...rest) => {
      log.push({ label, at: settled });
      const p = real(label, ...rest);
      Promise.resolve(p).then(() => { settled += 1; }, () => { settled += 1; });
      return p;
    });
    let r;
    try { r = await known(); } finally { spy.mockRestore(); }
    expect(r.kids).toHaveLength(2);
    const at = (t) => { const x = log.find((e) => e.label === `linkKnown:${t}:1`); if (!x) throw new Error(`no ${t} read`); return x.at; };
    expect(at('quizzes')).toBeLessThanOrEqual(at('students'));
    const ids = ['class_enrollments', 'quiz_sessions', 'child_identity', 'student_lists'].map(at);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeGreaterThan(at('students'));
  });

  test('the "may this phone name them" checks of the held children start together, not one after another', async () => {
    seed();
    await homeOpened([F.kid(1)]);
    await homeOpened([F.kid(2)]);
    await homeOpened([SELF]);
    const real = HubDevice.deviceMayName;
    let inflight = 0;
    let most = 0;
    const spy = jest.spyOn(HubDevice, 'deviceMayName').mockImplementation(async (...a) => {
      inflight += 1; most = Math.max(most, inflight);
      try { await new Promise((r) => setImmediate(r)); return await real(...a); } finally { inflight -= 1; }
    });
    let r;
    try { r = await known(); } finally { spy.mockRestore(); }
    expect(r.kids.map((k) => k.chip)).toEqual([chip(SELF), chip(F.kid(2)), chip(F.kid(1))]);
    expect(most).toBe(3);
  });

  test('a phone that holds nobody makes none of the filter\'s reads', async () => {
    seed();
    const Db = require('../../../shared/services/quiz/web-quiz-db-deadline');
    const spy = jest.spyOn(Db, 'read');
    try { expect(await known(FRESH)).toEqual({ kids: [] }); } finally { expect(spy.mock.calls.filter((c) => String(c[0]).startsWith('linkKnown:'))).toEqual([]); spy.mockRestore(); }
  });
});

describe('the one id the child is known by', () => {
  test('a phone trusted with an older, merged record offers the child it was merged into, and the session is on that child', async () => {
    seed({ canon: true });
    await homeOpened([OLD]);
    const r = await known();
    expect(r.kids).toEqual([{ chip: chip(SELF), first: 'Sadia', animal: T.animalFor(SELF) }]);
    await play({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV });
    expect(db.quiz_sessions.filter((x) => x.student_id === SELF)).toHaveLength(1);
    expect(db.quiz_sessions.filter((x) => x.student_id === OLD)).toHaveLength(0);
  });

  test('a phone trusted with two records of the same child (the old one merged into the new) names that child ONCE', async () => {
    seed({ canon: true });
    await homeOpened([OLD]);
    await homeOpened([SELF]);
    const r = await known();
    expect(r.kids).toEqual([{ chip: chip(SELF), first: 'Sadia', animal: T.animalFor(SELF) }]);
  });

  test('a "may this phone name them" check that fails drops only that child; the others are still named', async () => {
    seed();
    await homeOpened([SELF]);
    await homeOpened([SIB]);
    const real = HubDevice.deviceMayName;
    const spy = jest.spyOn(HubDevice, 'deviceMayName').mockImplementation(async (ids, d) => {
      if (ids.includes(SIB)) throw new Error('down');
      return real(ids, d);
    });
    let r;
    try { r = await known(); } finally { spy.mockRestore(); }
    expect(r.kids.map((k) => k.chip)).toEqual([chip(SELF)]);
  });

  test('a child whose trust on this phone has lapsed (still in the phone\'s list) is not named, and cannot be started by their chip', async () => {
    seed();
    await homeOpened([SELF]);
    await homeOpened([SIB]);
    const real = HubDevice.deviceMayName;
    const spy = jest.spyOn(HubDevice, 'deviceMayName').mockImplementation(async (ids, d) => (ids.includes(SIB) ? false : real(ids, d)));
    try {
      const r = await known();
      expect(r.kids.map((k) => k.chip)).toEqual([chip(SELF)]);
      await expect(play({ code: 'AB12CD', chip: chip(SIB), via: 'known', device_ref: DEV })).rejects.toMatchObject({ status: 404 });
    } finally { spy.mockRestore(); }
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
    ids.forEach((id, i) => db.students.push({ id, student_name: `Kid${i} Testwala`, self_reported_class: 'Grade 4', list_id: null, is_active: true, status: 'active' }));
    for (const id of ids) await homeOpened([id]);
    const r = await known();
    expect(r.kids.map((k) => k.first)).toEqual(['Kid5', 'Kid4', 'Kid3', 'Kid2']);
  });

  test('the four are counted AFTER the class filter: a fifth, older held child of this class is still named', async () => {
    seed();
    const others = Array.from({ length: 4 }, (_, i) => `55555555-5555-4555-8555-0000000002${i}0`);
    others.forEach((id, i) => {
      db.students.push({ id, student_name: `Other${i} Testwala`, list_id: null, is_active: true, status: 'active' });
      db.class_enrollments.push({ id: `e-o${i}`, class_id: F.CLS_B, student_id: id, roll_number: 20 + i, is_active: true });
    });
    await homeOpened([F.kid(1)]);                  // this link's class, trusted first (the oldest of five)
    for (const id of others) await homeOpened([id]);   // four newer children, all of another class
    const r = await known();
    expect(r.kids.map((k) => k.chip)).toEqual([chip(F.kid(1))]);
    await play({ code: 'AB12CD', chip: chip(F.kid(1)), via: 'known', device_ref: DEV });
    expect(db.quiz_sessions.filter((x) => x.student_id === F.kid(1))).toHaveLength(1);
  });
});

describe('golden: switch off', () => {
  for (const [name, value] of [['no row', undefined], ['false', false], ['the string "true" (JSON true only)', 'true'], ['the quoted string \'"true"\'', '"true"'], ['a number', 1]]) {
    test(`${name}: no link_known in the payload, nobody answered, and a known start is today's unknown chip`, async () => {
      seed({ known: value });
      if (value === undefined) db.app_settings = db.app_settings.filter((r) => r.key !== KEY);
      await homeOpened();
      const q = await WQ.getQuiz('AB12CD');
      expect(Object.prototype.hasOwnProperty.call(q, 'link_known')).toBe(false);
      expect(await known()).toEqual({ kids: [] });
      const before = db.quiz_sessions.length;
      await expect(play({ code: 'AB12CD', chip: chip(SELF), via: 'known', device_ref: DEV })).rejects.toMatchObject({ status: 404, body: { error: 'chip_unknown' } });
      expect(db.quiz_sessions.length).toBe(before);
    });
  }

  test('off: a typed first name on the holding phone takes today\'s path (no card from the first name)', async () => {
    seed({ known: false });
    await homeOpened();
    const r = await play({ code: 'AB12CD', new: { name: 'sadia' }, device_ref: DEV }).catch((e) => e);
    expect(Boolean(r && r.body && r.body.error === 'is_this_you' && JSON.stringify(r.body).includes(chip(SELF)))).toBe(false);
  });

  test('off: the payload is byte-identical to a code with no switch row at all', async () => {
    seed({ known: false });
    const off = await WQ.getQuiz('AB12CD');
    seed({ known: undefined });
    db.app_settings = db.app_settings.filter((r) => r.key !== KEY);
    const none = await WQ.getQuiz('AB12CD');
    expect(JSON.stringify(off)).toBe(JSON.stringify(none));
  });

  test('a switch read that throws: off, and the payload is byte-identical to a code with no switch row at all', async () => {
    seed({ known: undefined });
    db.app_settings = db.app_settings.filter((r) => r.key !== KEY);
    const none = await WQ.getQuiz('AB12CD');
    seed();
    await homeOpened();
    const from = supabase.from;
    // only this switch's read throws; every other setting reads as before
    supabase.from = (t) => {
      const q = from(t);
      if (t !== 'app_settings') return q;
      const select = q.select.bind(q);
      return { ...q, select: (...a) => { const r = select(...a); const inn = r.in.bind(r); return { ...r, in: (col, keys) => { if (keys.includes(KEY)) throw new Error('boom'); return inn(col, keys); } }; } };
    };
    try {
      const thrown = await WQ.getQuiz('AB12CD');
      expect(JSON.stringify(thrown)).toBe(JSON.stringify(none));
      expect(await known()).toEqual({ kids: [] });
    } finally { supabase.from = from; }
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

describe('the switch\'s own read on a quiz open', () => {
  for (const [name, value] of [['off', false], ['on', true]]) {
    test(`${name}: one app_settings read per 30 s, however many times the quiz page opens`, async () => {
      seed({ known: value });
      const from = supabase.from;
      let reads = 0;
      supabase.from = (t) => {
        const q = from(t);
        if (t !== 'app_settings') return q;
        const select = q.select.bind(q);
        return { ...q, select: (...a) => { const r = select(...a); const inn = r.in.bind(r); return { ...r, in: (col, keys) => { if (keys.includes(KEY)) reads += 1; return inn(col, keys); } }; } };
      };
      try {
        for (let i = 0; i < 5; i += 1) await WQ.getQuiz('AB12CD');
      } finally { supabase.from = from; }
      expect(reads).toBe(1);
    });
  }
});

describe('a CLOSED class link on a phone that holds a child: the way home (closedHome)', () => {
  const LinkKnown = () => require('../../../shared/services/quiz/web-quiz-link-known');
  test('one held child: a home link for that child, bound to THIS phone (the hub opens it there, nowhere else)', async () => {
    seed();
    await homeOpened();
    const r = await LinkKnown().closedHome({ device: DEV });
    expect(r.on).toBe(true);
    expect(r.home).toMatch(/^\/h\/[A-Za-z0-9._-]+\?from=link$/);
    const token = r.home.slice(3, r.home.indexOf('?'));
    expect(T.verify(token, 'h').ids).toEqual([SELF]);
    expect((await HubDevice.deviceTrusted(token, DEV)).ok).toBe(true);
    expect((await HubDevice.deviceTrusted(token, FRESH)).ok).toBe(false);
  });

  test('two held children: one home for both (the home asks who is playing)', async () => {
    seed();
    await homeOpened([SELF]);
    await homeOpened([SIB]);
    const r = await LinkKnown().closedHome({ device: DEV });
    expect(T.verify(r.home.slice(3, r.home.indexOf('?')), 'h').ids.sort()).toEqual([SELF, SIB].sort());
  });

  test('a phone that holds more than four: the home is for the newest four, as before', async () => {
    seed();
    const ids = Array.from({ length: 6 }, (_, i) => `55555555-5555-4555-8555-0000000003${i}0`);
    ids.forEach((id, i) => db.students.push({ id, student_name: `Kid${i} Testwala`, list_id: null, is_active: true, status: 'active' }));
    for (const id of ids) await homeOpened([id]);
    const r = await LinkKnown().closedHome({ device: DEV });
    expect(T.verify(r.home.slice(3, r.home.indexOf('?')), 'h').ids.sort()).toEqual(ids.slice(2).sort());
  });

  test('a fresh phone, no device, or Redis down: on, but no home', async () => {
    seed();
    await homeOpened();
    expect(await LinkKnown().closedHome({ device: FRESH })).toEqual({ on: true, home: null });
    expect(await LinkKnown().closedHome({})).toEqual({ on: true, home: null });
    redis._up = false;
    expect(await LinkKnown().closedHome({ device: DEV })).toEqual({ on: true, home: null });
  });

  for (const value of [false, 'true', undefined]) {
    test(`switch off (${String(value)}): {on: false}, nothing minted`, async () => {
      seed({ known: value });
      if (value === undefined) db.app_settings = db.app_settings.filter((r) => r.key !== KEY);
      await homeOpened();
      redis.set.mockClear();
      expect(await LinkKnown().closedHome({ device: DEV })).toEqual({ on: false });
      expect(redis.set).not.toHaveBeenCalled();
    });
  }
});
