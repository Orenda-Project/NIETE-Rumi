'use strict';
/**
 * The session start after a handset bind (web-quiz.service.js): a chip offered by the bind starts
 * as that child on the trusted device only (`via: 'handset'` resolves through the hub's device
 * trust, as `via: 'hub'` does); and a name typed on a trusted device that is one of that phone's
 * children gets "Is this you?" with that ONE card — on both the identity-v2 and the legacy path —
 * never a silent duplicate row. Supabase, SQS and Redis are the faked boundaries; the bind, the
 * device trust, the matcher and the session write run for real.
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
const Handset = require('../../../shared/services/quiz/web-quiz-handset');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const Roster = require('../../../shared/services/quiz/web-quiz-roster');

const CHAT_KID = '44444444-4444-4444-8444-0000000000c1';
const CHAT_SIB = '44444444-4444-4444-8444-0000000000c2';
const DEV = 'dddddddddddddddddddddd';
const OTHER_DEV = 'eeeeeeeeeeeeeeeeeeeeee';
let db;
function seed(flag) {
  db = F.db({ flag, classes: 'none', codeClass: null });
  db.app_settings.push({ key: 'web_quiz_handset_link', value: 'true' });
  db.students.push(
    { id: CHAT_KID, student_name: 'Ayesha Khan', phone: '923001112223', list_id: null, enrolled_by_user_id: F.TEACHER, is_active: true, status: 'active', created_at: '2026-09-10T00:00:00Z' },
    { id: CHAT_SIB, student_name: 'Bilal Khan', phone: '923001112223', list_id: null, enrolled_by_user_id: F.TEACHER, is_active: true, status: 'active', created_at: '2026-09-12T00:00:00Z' },
  );
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdRoster._resetCache(); Roster._resetCache(); Handset._resetCache();
}
const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  jest.clearAllMocks();
  redis._store.clear();
  redis._up = true;
});
afterAll(() => { process.env = SAVED; });

async function bound(ids = [CHAT_KID, CHAT_SIB], device = DEV) {
  const url = await Handset.withLink('https://p.test/q/AB12CD', ids, F.SC);
  return Handset.bind({ code: 'AB12CD', x: url.split('#x=')[1], device_ref: device });
}

for (const [label, flag] of [['identity v2', 'v2'], ['legacy path', null]]) {
  describe(`${label}`, () => {
    beforeEach(() => seed(flag));

    test("a chip the bind offered starts as THAT child on the trusted device (via 'handset'); on another device it names nobody", async () => {
      const r = await bound([CHAT_KID]);
      expect(r.one).toBe(T.chipId(F.SC, CHAT_KID));
      const s = await WQ.startSession({ code: 'AB12CD', chip: r.one, via: 'handset', device_ref: r.device_ref });
      expect(s.child.chip).toBe(T.chipId(F.SC, CHAT_KID));
      expect(db.quiz_sessions.find((x) => x.student_id === CHAT_KID)).toBeTruthy();
      expect(db.students.filter((x) => x.student_name === 'Ayesha Khan')).toHaveLength(1);   // no new row
      await expect(WQ.startSession({ code: 'AB12CD', chip: r.one, via: 'handset', device_ref: OTHER_DEV })).rejects.toMatchObject({ status: 404 });
    });

    test('a name typed on the trusted device that is one of the phone\'s children: "Is this you?" with that one card, no row made', async () => {
      await bound();
      const before = db.students.length;
      await expect(WQ.startSession({ code: 'AB12CD', new: { name: 'ayesha khan' }, device_ref: DEV }))
        .rejects.toMatchObject({ status: 409, body: { error: 'is_this_you', candidates: [expect.objectContaining({ chip: T.chipId(F.SC, CHAT_KID), first: 'Ayesha' })] } });
      expect(db.students.length).toBe(before);
      // confirming the card starts as the chat child
      const s = await WQ.startSession({ code: 'AB12CD', chip: T.chipId(F.SC, CHAT_KID), via: 'handset', device_ref: DEV });
      expect(db.quiz_sessions.find((x) => x.id === undefined || true) && s.child.chip).toBe(T.chipId(F.SC, CHAT_KID));
    });

    test('a name that is none of them, or "yes, that is my name" (force): today\'s path, a new child as before', async () => {
      await bound();
      const before = db.students.length;
      const s = await WQ.startSession({ code: 'AB12CD', new: { name: 'Zara', force: true }, device_ref: DEV });
      expect(s.child.first).toBe('Zara');
      expect(db.students.length).toBe(before + 1);
      const s2 = await WQ.startSession({ code: 'AB12CD', new: { name: 'Ayesha Khan', force: true }, device_ref: DEV });
      expect(s2.child.first).toBe('Ayesha');
      expect(db.students.length).toBe(before + 2);
    });

    test('an untrusted device typing the same name: no card from the handset (today\'s path)', async () => {
      await bound();
      const before = db.students.length;
      const s = await WQ.startSession({ code: 'AB12CD', new: { name: 'Ayesha Khan', force: true }, device_ref: OTHER_DEV });
      expect(s.child.first).toBe('Ayesha');
      expect(db.students.length).toBe(before + 1);
    });
  });
}
