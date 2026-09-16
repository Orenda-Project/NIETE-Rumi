/**
 * bd-gc1ge — the photo-gate auto-advance greeting, for a person with no name
 * and for a person who does not read English.
 *
 * WHAT WENT WRONG
 * ---------------
 * The sweep's one outbound line was:
 *
 *   `Hi ${notifyName}! I'm putting together your coaching report${dated} now. 📊`
 *
 * with `notifyName = session.users.name` taken RAW. Three defects on one line:
 *
 *   1. a template literal renders a null name as the literal word "null", so a
 *      nameless teacher was greeted "Hi null!". On NIETE prod 6,282 of 15,552
 *      users have `name IS NULL` and 117 have `name = ''` ("Hi !").
 *      Swapping in a person-name helper ALONE does not fix this — `firstNameOf`
 *      returns null for a nameless person by design, so it yields "Hi !". A
 *      no-name variant of the SENTENCE is required.
 *   2. the copy was hardcoded English in a cohort that is ~95% Urdu — measured
 *      over the 3,209 sessions this sweep has actually notified, 3,045 of the
 *      notified people have preferred_language='ur' (Rule 20).
 *   3. the date was `toLocaleDateString('en-GB')` regardless of language, which
 *      is the same defect the video-quiz report footer already fixed by moving
 *      to formatLessonDate.
 *
 * WHY THE EXISTING SWEEP TEST DID NOT CATCH IT
 * -------------------------------------------
 * tests/observe/bd-tju8f-sweep-observer.test.js builds its fixture with
 * `users: { first_name: 'Ayesha' }` — but `first_name` was DROPPED (bd-60092);
 * `name` is the only name column and it is what the worker selects. So that
 * fixture has always driven `session.users.name === undefined` and rendered
 * "Hi undefined!", and its one message assertion is `toMatch(/\d/)`, which a
 * broken greeting passes. This file asserts the TEXT a person receives.
 *
 * These tests drive the REAL processStuckPhotoGateSessions — the claim, the
 * observer-identity branch and the send — and assert only on the outbound
 * string, so they hold whichever language resolver the fix uses.
 */

'use strict';

// NIETE serves the FICO pack. Set before the worker (and anything market-aware
// it reaches) is required: getObservePack() defaults to 'mewaka' when this is
// unset, and mewaka's market default is SWAHILI.
process.env.OBSERVE_FRAMEWORK = 'fico';
// Keep the gate thresholds at their production defaults so the fixtures below
// are eligible for the reason they claim to be (age), not an env override.
delete process.env.COACHING_PHOTO_GATE_MINUTES;
delete process.env.OBSERVE_LP_GATE_MINUTES;

const mockState = { rows: [], users: {}, updates: [] };

function mockBuilder(table) {
  const ctx = { table, filters: {}, op: null, payload: null };
  const userRow = () => {
    const key = ctx.filters.id || ctx.filters.phone_number;
    return mockState.users[key] || null;
  };
  const b = {
    select: (cols) => { ctx.cols = cols; return b; },
    update: (payload) => { ctx.op = 'update'; ctx.payload = payload; return b; },
    eq: (k, v) => { ctx.filters[k] = v; return b; },
    in: (k, v) => { ctx.filters[`in:${k}`] = v; return b; },
    lt: (k, v) => { ctx.filters[`lt:${k}`] = v; return b; },
    order: () => b,
    limit: () => b,
    // Both spellings: the sweep's coach lookup uses .single(), and the language
    // resolver in observe-language uses .maybeSingle().
    single: async () => ({ data: ctx.table === 'users' ? userRow() : null, error: null }),
    maybeSingle: async () => ({ data: ctx.table === 'users' ? userRow() : null, error: null }),
    then: (resolve) => {
      let out;
      if (ctx.op === 'update') {
        mockState.updates.push({ table: ctx.table, payload: ctx.payload, filters: ctx.filters });
        const row = mockState.rows.find((r) => r.id === ctx.filters.id);
        const statusOk = row && (!ctx.filters['in:status'] || ctx.filters['in:status'].includes(row.status));
        if (row && statusOk && !row.claimed) {
          row.claimed = true; row.status = ctx.payload.status;
          out = { data: [row], error: null };
        } else {
          out = { data: [], error: null };   // another replica won the claim
        }
      } else {
        const cut = ctx.filters['lt:updated_at'] || ctx.filters['lt:created_at'];
        out = { data: mockState.rows.filter((r) => !cut || (r.updated_at || r.created_at) < cut), error: null };
      }
      return Promise.resolve(out).then(resolve);
    },
  };
  return b;
}

jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockBuilder(t) }));

const mockSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, msg) => { mockSent.push({ to, msg }); return true; }),
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueAnalysis: jest.fn(async () => 'mid'),
  queueReport: jest.fn(async () => 'mid'),
  queueTranscription: jest.fn(async () => 'mid'),
}));
jest.mock('../../shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: jest.fn(async () => ({})) }));

const HOURS = 3600 * 1000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const URDU = /[؀-ۿ]/;
// `Sept?` on purpose: the broken code emits en-GB's "Sept" and the fix emits
// formatLessonDate's "Sep", and the "no English month in an Urdu message"
// assertion has to catch BOTH spellings or it silently stops guarding.
const EN_MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/;
const UR_MONTHS = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];

/**
 * A session parked at the lesson-plan gate, stale enough to sweep.
 * `users` carries `name` + `preferred_language` — the columns that actually
 * exist (bd-60092) and the ones the worker projects.
 */
function gateRow(over = {}) {
  const { user, ...rest } = over;
  return {
    id: over.id || `s-${Math.random().toString(36).slice(2, 8)}`,
    user_id: 'teacher-1',
    observer_user_id: null,
    observation_type: null,
    status: 'awaiting_lesson_plan',
    created_at: iso(3 * HOURS),
    updated_at: iso(3 * HOURS),
    transcript_text: 'x'.repeat(500),
    conversation_state: {},
    users: { phone_number: '92-TEACHER', name: 'Ayesha Bibi', preferred_language: 'ur', ...(user || {}) },
    ...rest,
  };
}

/** Register the session's own teacher in the users table too, so a by-id or
 *  by-phone language lookup resolves to the SAME person the row joins. */
function withTeacherUser(row) {
  mockState.users[row.user_id] = { id: row.user_id, ...row.users };
  mockState.users[row.users.phone_number] = { id: row.user_id, ...row.users };
  return row;
}

let processStuckPhotoGateSessions;
beforeAll(() => {
  ({ processStuckPhotoGateSessions } = require('../../workers/stale-session.worker'));
});
beforeEach(() => {
  mockState.rows = []; mockState.users = {}; mockState.updates = [];
  mockSent.length = 0;
  jest.clearAllMocks();
});

/** The one thing that must never reach a person, in any language. */
function expectNoBrokenName(msg) {
  expect(msg).not.toMatch(/\bnull\b/);
  expect(msg).not.toMatch(/\bundefined\b/);
  // "Hi !" / "Hi  !" — a helper that returns null for a nameless person leaves
  // exactly this hole, which is why a no-name SENTENCE is required.
  expect(msg).not.toMatch(/Hi\s+!/);
  expect(msg).not.toMatch(/^\s*Hi\s*!/);
}

describe('bd-gc1ge — a nameless person is greeted like a person', () => {
  test('name IS NULL: the greeting says neither "null" nor "Hi !"', async () => {
    mockState.rows = [withTeacherUser(gateRow({ id: 'no-name', user: { name: null } }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    expectNoBrokenName(mockSent[0].msg);
    // It must still say something — a silent or empty send is not the fix.
    expect(mockSent[0].msg.trim().length).toBeGreaterThan(10);
  });

  test("name = '' (117 prod rows): the greeting does not render an empty gap", async () => {
    mockState.rows = [withTeacherUser(gateRow({ id: 'blank-name', user: { name: '' } }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    expectNoBrokenName(mockSent[0].msg);
  });

  test('a named teacher is still greeted by her first name', async () => {
    mockState.rows = [withTeacherUser(gateRow({ id: 'named', user: { name: 'Ayesha Bibi' } }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].msg).toContain('Ayesha');
    // The FIRST name, not the full name — the rest of this worker's greetings
    // use firstNameOf, so "Hi Ayesha Bibi!" would be a new inconsistency.
    expect(mockSent[0].msg).not.toContain('Ayesha Bibi');
    expectNoBrokenName(mockSent[0].msg);
  });
});

describe('bd-gc1ge — the greeting is in the notified person\'s language', () => {
  test('an Urdu teacher is written to in Urdu, not English', async () => {
    mockState.rows = [withTeacherUser(gateRow({ id: 'ur-named', user: { name: 'Ayesha Bibi', preferred_language: 'ur' } }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].msg).toMatch(URDU);
    expectNoBrokenName(mockSent[0].msg);
  });

  test('a nameless Urdu teacher gets the Urdu no-name variant', async () => {
    mockState.rows = [withTeacherUser(gateRow({ id: 'ur-nameless', user: { name: null, preferred_language: 'ur' } }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].msg).toMatch(URDU);
    expectNoBrokenName(mockSent[0].msg);
  });

  test('an English teacher still reads English', async () => {
    mockState.rows = [withTeacherUser(gateRow({ id: 'en-named', user: { name: 'Sara Khan', preferred_language: 'en' } }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].msg).toContain('Sara');
    expect(mockSent[0].msg).not.toMatch(URDU);
    expectNoBrokenName(mockSent[0].msg);
  });

  test('a bound leader observation greets the COACH, in the COACH\'s language, even when the coach has no name', async () => {
    const row = withTeacherUser(gateRow({
      id: 'obs-1',
      observation_type: 'leader_observation',
      observer_user_id: 'coach-1',
      // A leader observation's gate is 8 HOURS, not 60 minutes (bd-5knlj:
      // the coach is mid-school-visit and answers the LP prompt hours later).
      // A 3-hour fixture is not eligible and the coach branch never runs — so
      // this row has to be older than the observation threshold to test anything.
      created_at: iso(10 * HOURS),
      updated_at: iso(10 * HOURS),
      // the joined row is the observed TEACHER — English-preferring and named,
      // so borrowing her language or her name would be visible.
      user: { phone_number: '92-TEACHER', name: 'Ayesha Bibi', preferred_language: 'en' },
    }));
    mockState.rows = [row];
    mockState.users['coach-1'] = { id: 'coach-1', phone_number: '92-COACH', name: null, preferred_language: 'ur' };

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].to).toBe('92-COACH');
    expect(mockSent[0].msg).toMatch(URDU);              // the coach's language
    expect(mockSent[0].msg).not.toContain('Ayesha');    // never the teacher's name
    expectNoBrokenName(mockSent[0].msg);
  });
});

describe('bd-gc1ge — the lesson date is localised with the sentence', () => {
  test('an Urdu dated greeting carries an Urdu month, not "en-GB"', async () => {
    mockState.rows = [withTeacherUser(gateRow({
      id: 'ur-dated',
      created_at: iso(30 * HOURS),
      updated_at: iso(30 * HOURS),
      user: { name: 'Ayesha Bibi', preferred_language: 'ur' },
    }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    const { msg } = mockSent[0];
    expect(msg).toMatch(URDU);
    expect(UR_MONTHS.some((m) => msg.includes(m))).toBe(true);
    expect(msg).not.toMatch(EN_MONTH);
    expectNoBrokenName(msg);
  });

  test('an English dated greeting still carries an English month', async () => {
    mockState.rows = [withTeacherUser(gateRow({
      id: 'en-dated',
      created_at: iso(30 * HOURS),
      updated_at: iso(30 * HOURS),
      user: { name: 'Sara Khan', preferred_language: 'en' },
    }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    expect(mockSent[0].msg).toMatch(EN_MONTH);
    expectNoBrokenName(mockSent[0].msg);
  });

  test('a nameless Urdu teacher on a dated session gets both variants at once', async () => {
    mockState.rows = [withTeacherUser(gateRow({
      id: 'ur-dated-nameless',
      created_at: iso(30 * HOURS),
      updated_at: iso(30 * HOURS),
      user: { name: null, preferred_language: 'ur' },
    }))];

    await processStuckPhotoGateSessions();

    expect(mockSent).toHaveLength(1);
    const { msg } = mockSent[0];
    expect(msg).toMatch(URDU);
    expect(UR_MONTHS.some((m) => msg.includes(m))).toBe(true);
    expect(msg).not.toMatch(EN_MONTH);
    expectNoBrokenName(msg);
  });
});
