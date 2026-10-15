'use strict';
/**
 * Jugnu's Book (web-quiz-book.js) and its one line in the hub payload (web-quiz-hub.js hubPayload).
 * Supabase and Redis are the boundaries and are faked (the fake applies every filter); the hub token, the device
 * trust, the hub and the Book run for real. Invented children only.
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
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const redis = require('../../../shared/services/cache/railway-redis.service');

const KID = '44444444-4444-4444-8444-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const CLASS = '66666666-6666-4666-8666-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
// Wednesday 11 November 2026, 10:00 PKT: the week began Monday 9 November 00:00 PKT, the term on 1 October.
const NOW = Date.parse('2026-11-11T05:00:00Z');
const MON = '2026-11-09T06:00:00Z';
const WED = '2026-11-11T04:00:00Z';
const THU_LAST = '2026-11-05T06:00:00Z';
const OCT = '2026-10-15T06:00:00Z';
const GOLDEN = path.join(__dirname, 'web-quiz-book-hub-golden.json');

let db;
const ON = ['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_challenge_v2', 'web_quiz_challenge_book'];
const settings = (keys) => keys.map((key) => ({ key, value: 'true' }));

function seed(over = {}) {
  db = {
    app_settings: settings(ON),
    students: [{ id: KID, student_name: 'Zara Khan', student_name_urdu: 'زارا خان', self_reported_class: '3', list_id: LIST, is_active: true }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    web_quiz_challenge_runs: [],
    ...over,
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
// A v2 check row of this child.
let seq = 0;
function run(extra = {}) {
  seq += 1;
  return { id: `r${seq}`, student_id: KID, canonical_id: null, exercise: 'read', status: 'scored', mode: 'check', record: true, period_id: '2026-11',
    passage_id: null, item_set_id: null, class_id: null, exposure_no: 1, created_at: WED, scored_at: WED, wcpm: 30, score: { correct: 20 }, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'book-test-secret';
  Hub._resetCache();
  redis._store.clear();
  redis._up = true;
  seed();
  try { require('../../../shared/services/quiz/web-quiz-book')._resetCache(); } catch (_) { /* absent on the base */ }
});

const book = (over = {}) => require('../../../shared/services/quiz/web-quiz-book').bookFor({ hub: T.signHub([KID]), kid: T.chipId('h', KID), device: DEV, lang: 'en', ...over }, NOW);

describe('lamps come from child_rungs only', () => {
  test('runs that would meet R3 but no child_rungs row: 0 lamps, one outline on each ladder', async () => {
    db.web_quiz_challenge_runs.push(run({ passage_id: 'p-en-b1-001', band: 1, comp_ok: 3, comp_n: 3 }), run({ exercise: 'missing', item_set_id: 's1' }));
    const out = await book();
    expect(out.lamps).toEqual({ reading: 0, numbers: 0 });
    expect(out.next_outline).toEqual({ reading: true, numbers: true });
    expect(out.levelup).toBeUndefined();
  });

  test('the table missing (an error) fails closed to 0 lamps and never throws', async () => {
    const fake = makeFake(db);
    Object.assign(supabase, { from: (t) => (t === 'child_rungs' ? { select: () => ({ eq: async () => ({ data: null, error: { message: 'relation "child_rungs" does not exist' } }) }) } : fake.from(t)) });
    const out = await book();
    expect(out.lamps).toEqual({ reading: 0, numbers: 0 });
  });

  test('the highest rung of each ladder is lit, from the rung rows', async () => {
    db.child_rungs = [
      { canonical_id: KID, ladder: 'reading', rung: 1, period_id: '2026-10', set_at: OCT },
      { canonical_id: KID, ladder: 'reading', rung: 2, period_id: '2026-10', set_at: OCT },
      { canonical_id: KID, ladder: 'numbers', rung: 3, period_id: '2026-10', set_at: OCT },
    ];
    const out = await book();
    expect(out.lamps).toEqual({ reading: 2, numbers: 3 });
  });
});

describe('the outline: exactly one per ladder after the lit lamps, none at 5, none for grade 1', () => {
  test('reading at 5: no outline; numbers at 2: one', async () => {
    db.child_rungs = [{ canonical_id: KID, ladder: 'reading', rung: 5, period_id: '2026-10', set_at: OCT }, { canonical_id: KID, ladder: 'numbers', rung: 2, period_id: '2026-10', set_at: OCT }];
    const out = await book();
    expect(out.next_outline).toEqual({ reading: false, numbers: true });
  });
  test('grade 1: no outline on either ladder', async () => {
    db.child_identity = [{ canonical_id: KID, fixed_grade: 1 }];
    const out = await book();
    expect(out.next_outline).toEqual({ reading: false, numbers: false });
    expect(out.grade_band).toBe('G1');
  });
});

describe('class lights (shown only with >= 5 children in the term)', () => {
  // `kids` children with `term` lights in October, and `week` lights this week from the first `weekKids` children.
  function classRows(kids, term, week, weekKids) {
    const rows = [];
    const id = (i) => `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`;
    for (let i = 0; i < term; i += 1) rows.push(run({ student_id: id(i % kids), class_id: CLASS, passage_id: `p-oct-${i}`, created_at: OCT, scored_at: OCT }));
    for (let i = 0; i < week; i += 1) rows.push(run({ student_id: id(i % weekKids), class_id: CLASS, passage_id: `p-wk-${i}`, created_at: MON, scored_at: MON }));
    rows.push(run({ class_id: CLASS, passage_id: 'p-mine', created_at: OCT, scored_at: OCT }));
    return rows;
  }
  beforeEach(() => { db.app_settings.push({ key: 'web_quiz_class_wall', value: 'true' }); });

  test('3 children in the term: hidden, no number', async () => {
    db.web_quiz_challenge_runs.push(...classRows(2, 8, 0, 1));
    const out = await book();
    expect(out.class_lights).toEqual({ shown: false });
  });
  test('12 children, 41 lights, 7 this week from 4 children: total 41, +7', async () => {
    db.web_quiz_challenge_runs.push(...classRows(11, 33, 7, 4));
    const out = await book();
    expect(out.class_lights).toEqual({ shown: true, term_total: 41, week_n: 7 });
  });
  test('6 lights this week from 2 children: no "+n"', async () => {
    db.web_quiz_challenge_runs.push(...classRows(11, 34, 6, 2));
    const out = await book();
    expect(out.class_lights).toEqual({ shown: true, term_total: 41 });
  });
  test('a replay (exposure 2) is not a light', async () => {
    db.web_quiz_challenge_runs.push(...classRows(11, 33, 7, 4), run({ class_id: CLASS, passage_id: 'p-again', exposure_no: 2 }));
    const out = await book();
    expect(out.class_lights.term_total).toBe(41);
  });
  test('the wall switch off: no lights at all', async () => {
    db.app_settings = settings(ON);
    db.web_quiz_challenge_runs.push(...classRows(11, 33, 7, 4));
    const out = await book();
    expect(out.class_lights).toBeNull();
  });
});

describe('days this week: Mon..Sun PKT, lit only', () => {
  test('Monday and Wednesday lit; last week is not shown', async () => {
    db.web_quiz_challenge_runs.push(run({ created_at: MON, scored_at: MON }), run({ exercise: 'bigger', created_at: WED, scored_at: WED }), run({ created_at: THU_LAST, scored_at: THU_LAST }));
    const out = await book();
    expect(out.days_this_week).toEqual([true, false, true, false, false, false, false]);
  });
  test('a new week with nothing played yet: an empty row', async () => {
    db.web_quiz_challenge_runs.push(run({ created_at: THU_LAST, scored_at: THU_LAST }));
    const out = await book();
    expect(out.days_this_week).toEqual([false, false, false, false, false, false, false]);
  });
});

describe('the new lamp: only when the server has one this period', () => {
  test('Story Time off: levelup carries no opens (the room it would name is closed)', async () => {
    db.child_rungs = [{ canonical_id: KID, ladder: 'reading', rung: 3, period_id: '2026-11', set_at: WED }];
    const out = await book();
    expect(out.levelup).toEqual({ ladder: 'reading', rung: 3 });
  });
  test('a rung set this period, Story Time on -> levelup {ladder, rung, opens}', async () => {
    db.app_settings.push({ key: 'web_quiz_challenge_story', value: 'true' });
    db.child_rungs = [{ canonical_id: KID, ladder: 'reading', rung: 3, period_id: '2026-11', set_at: WED }, { canonical_id: KID, ladder: 'reading', rung: 2, period_id: '2026-10', set_at: OCT }];
    const out = await book();
    expect(out.levelup).toEqual({ ladder: 'reading', rung: 3, opens: 'longer' });
  });
  test('a rung from an earlier period -> no levelup', async () => {
    db.child_rungs = [{ canonical_id: KID, ladder: 'numbers', rung: 2, period_id: '2026-10', set_at: OCT }];
    const out = await book();
    expect(out.levelup).toBeUndefined();
  });
});

describe('stickers', () => {
  test('B1: a 0-word first read lights the read stop\'s Trail sticker', async () => {
    db.web_quiz_challenge_runs.push(run({ wcpm: 0, score: { correct: 0 }, passage_id: 'p-en-b1-002' }));
    const out = await book();
    expect(out.trail_stickers).toEqual(['read']);
    expect(out.lamps.reading).toBe(0);
  });
  test('practice rows and last month\'s rows give no Trail sticker; a story finish gives one story sticker per passage', async () => {
    db.challenge_passages = [{ passage_id: 'p-st-1', title_en: 'The kite', title_ur: 'پتنگ' }];
    db.web_quiz_challenge_runs.push(
      run({ exercise: 'bigger', mode: 'practice', record: false, item_set_id: 'x' }),
      run({ exercise: 'listen', period_id: '2026-10', created_at: OCT, scored_at: OCT }),
      run({ mode: 'practice', record: false, passage_id: 'p-st-1' }),
      run({ mode: 'practice', record: false, passage_id: 'p-st-1', exposure_no: 2 }),
    );
    const out = await book();
    expect(out.trail_stickers).toEqual([]);
    expect(out.story_stickers).toEqual([{ passage_id: 'p-st-1', title: 'The kite' }]);
  });
  test('a story sticker carries the title in the child\'s language (registry title_en / title_ur)', async () => {
    db.challenge_passages = [{ passage_id: 'p-st-2', title_en: 'The mango tree', title_ur: 'آم کا درخت' }];
    db.web_quiz_challenge_runs.push(run({ mode: 'practice', record: false, passage_id: 'p-st-2' }));
    expect((await book()).story_stickers).toEqual([{ passage_id: 'p-st-2', title: 'The mango tree' }]);
    expect((await book({ lang: 'ur' })).story_stickers).toEqual([{ passage_id: 'p-st-2', title: 'آم کا درخت' }]);
  });
  test('first name only, in the page language', async () => {
    expect((await book()).name).toBe('Zara');
    expect((await book({ lang: 'ur' })).name).toBe('زارا');
  });
});

describe('served and abandoned rows light nothing', () => {
  test('a served row alone (and an abandoned one): no sticker, no day dot, no light', async () => {
    db.app_settings.push({ key: 'web_quiz_class_wall', value: 'true' });
    const id = (i) => `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`;
    db.web_quiz_challenge_runs.push(
      run({ status: 'served', class_id: CLASS, passage_id: 'p-s' }),
      run({ status: 'abandoned', exercise: 'bigger', class_id: CLASS, item_set_id: 'i-s' }),
      ...[1, 2, 3, 4, 5, 6].map((i) => run({ student_id: id(i), status: 'served', class_id: CLASS, passage_id: `p-x${i}` })),
    );
    const out = await book();
    expect(out.trail_stickers).toEqual([]);
    expect(out.story_stickers).toEqual([]);
    expect(out.days_this_week).toEqual([false, false, false, false, false, false, false]);
    expect(out.class_lights).toEqual({ shown: false });
  });
});

describe('the door', () => {
  test('Book off (v2 off): 503; a chip that is not this token\'s: 401', async () => {
    db.app_settings = settings(['web_quiz_hub', 'web_quiz_challenge', 'web_quiz_challenge_book']);
    await expect(book()).rejects.toMatchObject({ status: 503 });
    require('../../../shared/services/quiz/web-quiz-book')._resetCache();
    db.app_settings = settings(ON);
    await expect(book({ kid: 'ffffffffffffffff' })).rejects.toMatchObject({ status: 401 });
  });
});

describe('the hub payload', () => {
  test('Book on: book_on is set; with the wall on, the class lights too', async () => {
    db.app_settings.push({ key: 'web_quiz_class_wall', value: 'true' });
    const out = await Hub.hub(T.signHub([KID]), { kid: T.chipId('h', KID), device: DEV });
    expect(out.book_on).toBe(true);
    expect(out).toHaveProperty('class_lights');
  });
});

// Golden (SPEC §5): with every new switch off the hub payload and its events are the base's, byte for byte.
// The golden file was written once on the base branch and is only read here.
describe('golden: every new switch off -> the hub payload is the base\'s', () => {
  const BASE = ['web_quiz_hub', 'web_quiz_challenge'];
  async function snap(keys) {
    jest.useFakeTimers({ now: NOW, doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    try {
      seed({ app_settings: settings(keys), web_quiz_challenge_runs: [run({ class_id: CLASS, passage_id: 'p-g' })], child_rungs: [{ canonical_id: KID, ladder: 'reading', rung: 3, period_id: '2026-11', set_at: WED }] });
      Hub._resetCache();
      try { require('../../../shared/services/quiz/web-quiz-book')._resetCache(); } catch (_) { /* absent on the base */ }
      redis._store.clear();
      logEvent.mockClear();
      const payload = await Hub.hub(T.signHub([KID]), { kid: T.chipId('h', KID), device: DEV });
      return JSON.parse(JSON.stringify({ payload, events: logEvent.mock.calls }));
    } finally {
      jest.useRealTimers();
    }
  }
  test('switches absent, book off under v2, book on without v2, wall on without book: all equal the base', async () => {
    const base = await snap(BASE);
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    expect(base).toEqual(golden);
    expect(await snap([...BASE, 'web_quiz_challenge_v2'])).toEqual(golden);
    expect(await snap([...BASE, 'web_quiz_challenge_book', 'web_quiz_class_wall'])).toEqual(golden);
    expect(await snap([...BASE, 'web_quiz_challenge_v2', 'web_quiz_class_wall'])).toEqual(golden);
  });
});

describe('class_wall_shown passes the page-event allow-list (NAME_PROPS, web_quiz_events_v2)', () => {
  const { cleanEvent, NAME_PROPS } = require('../../../shared/services/quiz/web-quiz.service');
  const v2 = { v2: true };
  test('its props live in the relay\'s one name-scoped map', () => {
    expect(Object.keys(NAME_PROPS.class_wall_shown).sort()).toEqual(['shown', 'term_total', 'week_n']);
  });
  test('v2 on: shown, term_total and week_n are kept as w:p; anything else is dropped', () => {
    expect(cleanEvent({ n: 'class_wall_shown', shown: 'total', term_total: 41, week_n: 7, cls: 'x', kid: 'y' }, v2)).toEqual({ name: 'class_wall_shown', props: { shown: 'total', term_total: 41, week_n: 7, w: 'p' } });
    expect(cleanEvent({ n: 'class_wall_shown', shown: 'hidden_under5' }, v2)).toEqual({ name: 'class_wall_shown', props: { shown: 'hidden_under5', w: 'p' } });
    expect(cleanEvent({ n: 'class_wall_shown', shown: 'Zara', term_total: '41' }, v2).props).toEqual({ w: 'p' });
    // name-scoped: another event never keeps these props
    expect(cleanEvent({ n: 'hub_view', shown: 'total', term_total: 41, week_n: 7 }, v2).props).toEqual({ w: 'p' });
  });
  test('v2 off: the relay is today\'s (no wall props)', () => {
    expect(cleanEvent({ n: 'class_wall_shown', shown: 'total', term_total: 41, week_n: 7 }).props).toEqual({});
  });
});
