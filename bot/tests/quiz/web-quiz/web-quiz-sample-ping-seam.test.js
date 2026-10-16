'use strict';
/**
 * The direct ping's frame read (web-quiz-sample-ping.js) against the REAL binding store (child-phone-bindings.repo) and
 * the columns the tables really have. Faked: the supabase transport only (in-memory tables that apply filters, wrapped
 * so a column the schema mirror lacks answers 42703 as PostgREST does), and the loggers. Real: the binding store's
 * tombstone (a keyed hash of the phone), the term code, the plan.
 * The tombstone is the key the frame joins on: a STOP is found by it and a phone already pinged this term is found by
 * it. If the store and the ping ever disagreed on it, a family that said STOP would count as eligible.
 */
process.env.WQ_TOMB_SALT = 'test-tomb-salt-not-a-secret-000000000000';

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const { strictFrom, COLUMNS } = require('./strict-columns');
const { fixturePhone } = require('./fixture-phone');
const supabase = require('../../../shared/config/supabase');
const { logError } = require('../../../shared/utils/logger');
const { logEvent } = require('../../../shared/utils/structured-logger');
const Repo = require('../../../shared/services/quiz/child-phone-bindings.repo');
const Ping = require('../../../shared/services/quiz/web-quiz-sample-ping');

// 16 Oct 2026, 10:00 PKT (term 2026-27b)
const T0 = Date.parse('2026-10-16T05:00:00Z');
const TERM = '2026-27b';
const FUTURE = '2027-03-31T18:59:59.000Z';
const PAST = '2026-09-01T00:00:00.000Z';
const TABLES = ['child_phone_bindings', 'class_enrollments', 'class_round_draws', 'sample_pings', 'sample_ping_consents', 'users'];
const uuid = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let DB;
let seq;

function world() {
  seq = 0;
  DB = {
    app_settings: [], child_phone_bindings: [], class_enrollments: [], class_round_draws: [], sample_ping_consents: [],
    sample_pings: [], users: [],
  };
  const fake = makeFake(DB, { uniques: { sample_pings: ['term_code', 'phone_tomb'] } });
  const strict = strictFrom(fake.from, TABLES);
  supabase.from = (t) => {
    const b = strict(t);
    b.or = () => b;
    return b;
  };
  supabase.rpc = fake.rpc;
}

/** One consenting family on a class; the binding row is stored with NO tombstone, so only the store's tombOf gives it. */
function family(n) {
  const phone = fixturePhone(n);
  seq += 1;
  const child = uuid('a', seq);
  const bind = uuid('b', seq);
  DB.child_phone_bindings.push({ id: bind, canonical_id: child, phone_norm: phone, phone_tomb: null, via: 'save', bound_at: PAST, expires_at: FUTURE, revoked_at: null, revoked_by: null });
  DB.class_enrollments.push({ id: `e-${seq}`, student_id: child, class_id: uuid('c', seq), is_active: true });
  DB.sample_ping_consents.push({ binding_id: bind, consent_v: 1, consented_at: PAST });
  return phone;
}

beforeEach(() => { world(); jest.clearAllMocks(); });

test('the mirror has every table the frame reads (the parse is real, not empty)', () => {
  TABLES.forEach((t) => expect(COLUMNS[t]).toBeDefined());
  expect(COLUMNS.sample_pings.has('phone_tomb')).toBe(true);
  expect(COLUMNS.child_phone_bindings.has('phone_tomb')).toBe(true);
});

test('every column the frame selects or filters on exists: the counts come back, no read failed', async () => {
  family(1);
  family(2);
  const counts = await Ping.frameCounts({ now: T0 });
  expect(counts).toEqual({
    term: TERM, frame_n: 2, eligible_n: 2, would_send_n: 2, classes_n: 2, max_per_class: 1,
    excl_loose: 0, excl_drawn: 0, excl_teacher: 0, excl_stop: 0, excl_consent: 0, excl_done: 0,
  });
  expect(logError).not.toHaveBeenCalled();
  expect(logEvent).not.toHaveBeenCalled();
});

test('the store\'s tombstone is the join key: a STOP row and a ping this term are found by it', async () => {
  const stopped = family(1);
  const pinged = family(2);
  family(3);
  expect(Repo.tombOf(stopped)).toMatch(/^[0-9a-f]{32}$/);
  // the erased binding a STOP left behind keeps only the tombstone
  DB.child_phone_bindings.push({ id: uuid('b', 90), canonical_id: uuid('a', 90), phone_norm: null, phone_tomb: Repo.tombOf(stopped), via: 'save', bound_at: PAST, expires_at: FUTURE, revoked_at: PAST, revoked_by: 'stop' });
  DB.sample_pings.push({ id: uuid('f', 1), term_code: TERM, phone_tomb: Repo.tombOf(pinged), class_id: null, state: 'sent', created_at: PAST, sent_at: PAST });
  const counts = await Ping.frameCounts({ now: T0 });
  expect(counts).toMatchObject({ frame_n: 3, excl_stop: 1, excl_done: 1, eligible_n: 1, would_send_n: 1 });
});
