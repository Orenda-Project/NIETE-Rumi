'use strict';
/**
 * bd-2404 / bd-2405 — the class report must survive a FORWARDED link.
 *
 * bd-2404 — the early-fire rule assumed a closed cohort. It fires the moment
 * "every session on this code is terminal", which is true again and again as a
 * forwarded link trickles in. Operator's own test surfaced it: forward to a
 * class group at 2pm, one keen child finishes at 2:10, and at that instant the
 * only session that exists is terminal -> the report goes out reading
 * "1 of 1 students finished", report_sent_at is stamped, and the other 29
 * children that evening are never reported at all (one report per code).
 * Fix: all-terminal AND nothing new started for 2 hours. Otherwise fall through
 * to the scheduled report, now 12 hours out rather than next morning.
 *
 * bd-2405 — the "Why this happens" block was pasting CHILD-FACING feedback
 * verbatim into a TEACHER's report: "Nice effort! ... Keep learning!". Of 18,300
 * authored wrong-option strings, 11,799 open with a child opener and 9,876 close
 * with one. The teacher was being consoled for a question she never answered.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocumentFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const report = require('../../shared/services/quiz/video-quiz-report.service');

const MIN = 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** quiz_sessions rows for one share code. */
function stubSessions(rows) {
  supabase.from.mockImplementation((table) => {
    if (table === 'quiz_sessions') {
      const chain = { select: () => chain, eq: () => chain, in: () => chain, is: () => chain,
                      then: (res) => res({ data: rows, error: null }) };
      return chain;
    }
    const chain = { select: () => chain, eq: () => chain, in: () => chain, is: () => chain, update: () => chain,
                    maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }),
                    then: (res) => res({ data: [], error: null }) };
    return chain;
  });
}

beforeEach(() => jest.clearAllMocks());

describe('bd-2404 — a forwarded link must not fire the report on a sample of one', () => {
  // Asserted against the PURE predicate, not through maybeSendEarly(): that
  // function calls its local generate(), so a jest spy on the export never
  // intercepts it and the test would pass on a stubbed-null share code rather
  // than on the rule. A green that does not depend on the rule proves nothing.
  const should = report.shouldSendEarly;

  test('does NOT fire while a session started inside the quiet window', () => {
    // one child finished 5 min ago — 29 classmates have not opened it yet
    expect(should([{ status: 'completed', created_at: ago(5 * MIN) }])).toBe(false);
  });

  test('DOES fire once all are terminal and the class has gone quiet', () => {
    expect(should([
      { status: 'completed', created_at: ago(200 * MIN) },
      { status: 'completed', created_at: ago(150 * MIN) },
    ])).toBe(true);
  });

  test('a straggler still in progress blocks it regardless of age', () => {
    expect(should([
      { status: 'completed', created_at: ago(300 * MIN) },
      { status: 'in_progress', created_at: ago(280 * MIN) },
    ])).toBe(false);
  });

  test('the quiet window is 2 hours, not 45 minutes', () => {
    expect(should([{ status: 'completed', created_at: ago(90 * MIN) }])).toBe(false);
    expect(should([{ status: 'completed', created_at: ago(125 * MIN) }])).toBe(true);
  });

  test('no sessions at all is never an early send', () => {
    expect(should([])).toBe(false);
  });

  test('maybeSendEarly refuses when the class is still arriving', async () => {
    stubSessions([{ status: 'completed', created_at: ago(5 * MIN) }]);
    await expect(report.maybeSendEarly('sc-1')).resolves.toBe(false);
  });
});

describe('bd-2404 — the scheduled fallback is 12 hours, not next morning', () => {
  test('a mid-morning share reports the same evening', () => {
    // 09:00 PKT  ->  21:00 PKT the same day
    const at = new Date('2026-08-03T04:00:00Z');           // 09:00 PKT
    const t = report.reportTargetUtc(at);
    expect((t - at) / 3600000).toBeCloseTo(12, 1);
  });

  test('it never wakes a teacher in the middle of the night', () => {
    // 20:00 PKT + 12h = 08:00 PKT next day — fine.
    // 16:00 PKT + 12h = 04:00 PKT — must be pushed to a civil hour.
    const at = new Date('2026-08-03T11:00:00Z');           // 16:00 PKT
    const t = report.reportTargetUtc(at);
    const pktHour = new Date(t.getTime() + 5 * 3600000).getUTCHours();
    expect(pktHour).toBeGreaterThanOrEqual(7);
    expect(pktHour).toBeLessThan(22);
  });
});

describe('bd-2405 — the explanation is written for the TEACHER', () => {
  const strip = report.teacherFacing;

  test('the child-facing opener is removed', () => {
    expect(strip('A) Good try! Fins help swimming, while gills help breathing.'))
      .toBe('Fins help swimming, while gills help breathing.');
  });

  test('the child-facing closer is removed', () => {
    expect(strip('B) Nice effort! Milk and meat are products, not groups. Keep learning!'))
      .toBe('Milk and meat are products, not groups.');
  });

  test('the substance in the middle is never touched', () => {
    const out = strip('C) Good try. You used the monocot rule here: one cotyledon is for '
                      + 'monocots. Correct answer: B) Two, because a dicot seed has two '
                      + 'cotyledons. Keep going!');
    expect(out).toContain('one cotyledon is for monocots');
    expect(out).toContain('a dicot seed has two cotyledons');
    expect(out).not.toMatch(/good try/i);
    expect(out).not.toMatch(/keep going/i);
  });

  test('a string with no scaffolding survives unchanged', () => {
    expect(strip('D) Fins are for swimming.')).toBe('Fins are for swimming.');
  });

  test('empty or missing feedback stays null rather than becoming ""', () => {
    expect(strip('A) Good try! Keep going!')).toBeNull();
    expect(strip(null)).toBeNull();
  });
});
