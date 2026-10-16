'use strict';
/**
 * The flags seam: `quiz_maker_page` (`makerPage`) and `quiz_first_door` (`firstDoor`) read through the identity
 * switches' one map, so the unknown path makes NO new read for a switch. With the keys absent every other field is
 * byte-identical to today's and the read count is unchanged (one `.in()` over the key list); `firstDoor` reads OFF
 * unless `makerPage` is ON (the hard parent in code); a failed read is OFF for all five.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const IdFlags = require('../../shared/services/quiz/web-quiz-identity-flags');
const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
const { seedDb, GUEST_ON } = require('./door-fixture');

const SAVED = { ...process.env };
let fake;
const seed = (settings) => {
  fake = seedDb(supabase, { settings });
  IdFlags._resetCache();
  HubFlags._resetCache();
};
const identityReads = () => fake.inLists.filter((c) => c.table === 'app_settings' && c.values.includes(IdFlags.CANON_KEY));
const sisterFields = (f) => ({ canon: f.canon, phoneBind: f.phoneBind, guestHome: f.guestHome });

beforeEach(() => {
  process.env = { ...SAVED, WQ_TOMB_SALT: 'unit-salt-not-a-secret' };
  jest.clearAllMocks();
});
afterAll(() => { process.env = SAVED; });

describe('the two keys, by name', () => {
  test('the key names are SPEC v2 §1\'s', () => {
    expect([IdFlags.MAKER_PAGE_KEY, IdFlags.FIRST_DOOR_KEY]).toEqual(['quiz_maker_page', 'quiz_first_door']);
  });

  test('keys absent → makerPage:false, firstDoor:false; the sister\'s three fields byte-identical to today\'s read', async () => {
    seed(GUEST_ON);
    const f = await IdFlags.flags();
    expect(f).toMatchObject({ makerPage: false, firstDoor: false });
    expect(sisterFields(f)).toEqual({ canon: true, phoneBind: true, guestHome: true });
    expect(Object.keys(f).sort()).toEqual(['at', 'canon', 'firstDoor', 'guestHome', 'makerPage', 'phoneBind']);
  });

  test('the read count is unchanged: ONE .in() over the key list, which now names the five keys', async () => {
    seed(GUEST_ON);
    await IdFlags.flags();
    const ours = identityReads();
    expect(ours).toHaveLength(1);
    expect(ours[0].values).toStrictEqual([IdFlags.CANON_KEY, IdFlags.PHONE_BIND_KEY, IdFlags.GUEST_HOME_KEY, IdFlags.MAKER_PAGE_KEY, IdFlags.FIRST_DOOR_KEY]);
  });

  test('quiz_maker_page alone → makerPage:true, firstDoor:false', async () => {
    seed({ quiz_maker_page: true });
    expect(await IdFlags.flags()).toMatchObject({ makerPage: true, firstDoor: false });
  });

  test('quiz_first_door without its parent → firstDoor:false (D6: a teacher tap can never land on the dead end)', async () => {
    seed({ quiz_first_door: true });
    expect(await IdFlags.flags()).toMatchObject({ makerPage: false, firstDoor: false });
    seed({ quiz_first_door: true, quiz_maker_page: false });
    expect(await IdFlags.flags()).toMatchObject({ makerPage: false, firstDoor: false });
  });

  test('both ON → both true, as booleans or as the strings app_settings stores; the sister\'s fields untouched', async () => {
    seed({ ...GUEST_ON, quiz_maker_page: true, quiz_first_door: true });
    const on = await IdFlags.flags();
    expect(on).toMatchObject({ makerPage: true, firstDoor: true });
    expect(sisterFields(on)).toEqual({ canon: true, phoneBind: true, guestHome: true });
    seed({ quiz_maker_page: 'true', quiz_first_door: '"true"' });
    expect(await IdFlags.flags()).toMatchObject({ makerPage: true, firstDoor: true });
  });

  test('ours ON with the sister\'s OFF → their three stay false (no parent of theirs is ours)', async () => {
    seed({ quiz_maker_page: true, quiz_first_door: true });
    expect(await IdFlags.flags()).toEqual({ at: expect.any(Number), canon: false, phoneBind: false, guestHome: false, makerPage: true, firstDoor: true });
  });

  test('a failed read → all five false (the OFF constant gains the two fields by name)', async () => {
    seed({ ...GUEST_ON, quiz_maker_page: true, quiz_first_door: true });
    supabase.from = () => { throw new Error('down'); };
    expect(await IdFlags.flags()).toEqual({ canon: false, phoneBind: false, guestHome: false, makerPage: false, firstDoor: false });
  });

  test('the 30 s cache carries the two fields: a second call makes no read', async () => {
    seed({ quiz_maker_page: true, quiz_first_door: true });
    const first = await IdFlags.flags();
    const n = fake.calls.length;
    const second = await IdFlags.flags();
    expect(second).toBe(first);
    expect(second.firstDoor).toBe(true);
    expect(fake.calls.length).toBe(n);
  });
});
