'use strict';
/**
 * The Challenge period id is the PKT calendar month, 'YYYY-MM', everywhere it is made:
 *   - every challenge_periods row a migration inserts: the id matches ^\d{4}-(0[1-9]|1[0-2])$, starts at PKT midnight
 *     on the first of that month and ends at PKT midnight on the first of the next;
 *   - the teacher's Jugnu tab (`periodOf` in teacher-jugnu.data.js);
 *   - the hub's lantern (web-quiz-hub-play.js), read through `playFor`: a Trail stop is done only when its record row
 *     carries the period the hub computes, so the lantern's "trail" line shows which period it used.
 * Instants either side of PKT midnight on a month boundary: 2026-10-31T18:30Z is still October in Pakistan,
 * 2026-10-31T19:30Z is already November. If two of these disagree, this test is red.
 * Supabase is the boundary and is faked (fake-supabase); the modules under test run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({ from: (...a) => global.__periodFake.from(...a) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { makeFake } = require('./fake-supabase');
const Jugnu = require('../../../shared/services/quiz/teacher-jugnu.data');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');

const PERIOD_ID = /^\d{4}-(0[1-9]|1[0-2])$/;
const MIGRATIONS = path.join(__dirname, '../../../database/migrations');
const KID = '44444444-4444-4444-8444-0000000000a1';

// Either side of PKT midnight (UTC+5) at three month boundaries, with the PKT month each instant belongs to.
const CASES = [
  ['2026-10-31T18:30:00Z', '2026-10'],
  ['2026-10-31T19:30:00Z', '2026-11'],
  ['2026-11-30T18:59:59Z', '2026-11'],
  ['2026-11-30T19:00:00Z', '2026-12'],
  ['2026-12-31T18:59:59Z', '2026-12'],
  ['2026-12-31T19:00:01Z', '2027-01'],
];

/** The challenge_periods rows the migrations insert: [{ file, period_id, starts_at, ends_at }]. */
function periodRows() {
  const out = [];
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    const rx = /INSERT\s+INTO\s+(?:public\.)?challenge_periods\s*\(([^)]*)\)\s*VALUES([\s\S]*?)(?:ON\s+CONFLICT|;)/gi;
    for (const m of sql.matchAll(rx)) {
      const cols = m[1].split(',').map((c) => c.trim());
      for (const t of m[2].matchAll(/\(([^()]*)\)/g)) {
        const vals = t[1].split(',').map((v) => v.trim().replace(/^'(.*)'$/, '$1'));
        out.push({ file, ...Object.fromEntries(cols.map((c, i) => [c, vals[i]])) });
      }
    }
  }
  return out;
}

/** PKT midnight on the first of a 'YYYY-MM' month, as an ISO instant. */
const pktMonthStart = (id) => {
  const [y, m] = id.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - 5 * 3600 * 1000).toISOString();
};
const nextMonth = (id) => {
  const [y, m] = id.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const sameInstant = (a, b) => Date.parse(a) === Date.parse(b);

describe('the challenge_periods rows the migrations insert', () => {
  const rows = periodRows();

  test('at least one row is read', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  test.each(rows.map((r) => [r.period_id, r]))('%s: a PKT YYYY-MM id spanning that PKT month', (id, r) => {
    expect(id).toMatch(PERIOD_ID);
    expect(sameInstant(r.starts_at, pktMonthStart(id))).toBe(true);
    expect(sameInstant(r.ends_at, pktMonthStart(nextMonth(id)))).toBe(true);
  });
});

describe("the teacher's Jugnu tab: periodOf", () => {
  test.each(CASES)('%s is %s', (iso, month) => {
    expect(Jugnu.periodOf(Date.parse(iso))).toBe(month);
  });
});

describe("the hub's lantern: the period its Trail reads", () => {
  const ON = (key) => ({ key, value: 'true' });
  function seed(periodId) {
    global.__periodFake = makeFake({
      app_settings: [ON(Play.KEYS.hub), ON(Play.KEYS.challenge), ON(Play.KEYS.v2)],
      web_quiz_challenge_runs: [{ student_id: KID, exercise: 'read', status: 'scored', mode: 'check', record: true, period_id: periodId, passage_id: 'en.read.1.ref01' }],
    });
    Play._resetCache();
  }
  const lantern = async (iso) => (await Play.playFor({ chosenId: KID, lang: 'en', now: iso, challenge: { on: true }, grade: 3, stopsOf: async () => ['read'] })).lantern;

  test.each(CASES)('%s: a record row for %s closes the stop; one for the month before does not', async (iso, month) => {
    seed(month);
    expect(await lantern(iso)).toBeNull();
    const before = new Date(Date.parse(`${month}-01T12:00:00Z`) - 5 * 24 * 3600 * 1000).toISOString().slice(0, 7);
    seed(before);
    expect(await lantern(iso)).toEqual({ kind: 'trail', stops: 1 });
  });

  test("the hub closes a stop on exactly the period the teacher's tab computes, on every case", async () => {
    for (const [iso] of CASES) {
      seed(Jugnu.periodOf(Date.parse(iso)));
      expect([iso, await lantern(iso)]).toEqual([iso, null]);
    }
  });
});
