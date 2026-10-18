'use strict';
/**
 * The first hub answer after idle keeps the look (app_settings web_quiz_look_after, default off, JSON true only, riding
 * the hub's one settings read). The route looks at web_quiz_one_button / web_quiz_adventure_look (and the hub at
 * web_quiz_fast) BEFORE the hub's reads run; a cold process or a cache older than 2 TTLs answered without
 * `one_button`, `adv`, `fast` (and so `plain_paint`) while the next answer had them. On: each is looked at again once
 * the answer lands. Off: the answer is byte for byte today's.
 *
 * Supabase, Redis and WhatsApp are the boundaries and are faked; the hub and the route's carries run for real, in the
 * route's order (web-quiz-internal.routes.js GET /hub/:token).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Fast = require('../../../shared/services/quiz/web-quiz-fast');
const OneButton = require('../../../shared/services/quiz/web-quiz-one-button');
const AdvLook = require('../../../shared/services/quiz/web-quiz-adventure-look');
const PlainPaint = require('../../../shared/services/quiz/web-quiz-plain-paint');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { fixturePhone } = require('./fixture-phone');

const KID = '44444444-4444-4444-8444-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const LOOK = ['web_quiz_hub', 'web_quiz_fast', 'web_quiz_one_button', 'web_quiz_adventure_look', 'web_quiz_plain_paint'];

function seed(keys, extra = []) {
  const db = {
    app_settings: [...keys.map((key) => ({ key, value: true })), ...extra],
    students: [{ id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: fixturePhone(1), created_at: new Date().toISOString() }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

// The route's carries around the hub, in its order: the switches are looked at when each carry is called.
const route = () => PlainPaint.carryHub(AdvLook.carry(OneButton.carry(Hub.hub(T.signHub([KID]), A))));
const stable = (o) => JSON.parse(JSON.stringify(o));
const look = (o) => ({ one_button: o.one_button, adv: o.adv, fast: o.fast, plain_paint: o.plain_paint });
const ALL = { one_button: true, adv: true, fast: true, plain_paint: true };

function cold() {
  Hub._resetCache();
  Fast._reset();
  redis._store.clear();
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._up = true;
  cold();
});

describe('web_quiz_look_after on', () => {
  test('a cold process: the first answer carries the look, as the next one does', async () => {
    seed([...LOOK, 'web_quiz_look_after']);
    const first = stable(await route());
    redis._store.clear();
    const next = stable(await route());
    expect(look(first)).toEqual(ALL);
    expect(first).toEqual(next);
  });

  test('a switch cache older than 2 TTLs (the first open after idle): the look stays', async () => {
    seed([...LOOK, 'web_quiz_look_after']);
    await Flags.flags(Date.now() - 61 * 1000);
    const first = stable(await route());
    expect(look(first)).toEqual(ALL);
  });

  test('the switches warm, the fast read cold (reads started together): `fast` and `plain_paint` stay', async () => {
    seed([...LOOK, 'web_quiz_look_after', 'web_quiz_hub_fanout']);
    await Flags.flags();
    const first = stable(await route());
    expect(look(first)).toEqual(ALL);
  });

  test('a switch that is off stays off after the answer lands', async () => {
    seed(['web_quiz_hub', 'web_quiz_fast', 'web_quiz_look_after']);
    const first = stable(await route());
    expect(look(first)).toEqual({ one_button: undefined, adv: undefined, fast: true, plain_paint: undefined });
  });
});

describe('web_quiz_look_after off', () => {
  test('a cold process: today\'s first answer, byte for byte (the look comes from the next answer)', async () => {
    seed(LOOK);
    const first = stable(await route());
    expect(look(first)).toEqual({ one_button: undefined, adv: undefined, fast: undefined, plain_paint: undefined });
    redis._store.clear();
    expect(look(stable(await route()))).toEqual(ALL);
  });

  test('the stored string "true" is off', async () => {
    seed(LOOK);
    const off = stable(await route());
    cold();
    seed(LOOK, [{ key: 'web_quiz_look_after', value: 'true' }]);
    expect(stable(await route())).toEqual(off);
  });

  test('no read of its own: the key is one of the hub\'s switches', () => {
    expect(Flags.KEYS).toContain('web_quiz_look_after');
  });
});
