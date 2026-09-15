/**
 * The truth table for observations that finished and never reached the teacher.
 *
 * Teacher delivery on the coach path is a manual tap. Three of its states are
 * written and read by nothing: `awaiting_confirm` (the coach saw the preview and
 * tapped neither Send nor Cancel), `previewing` (the render was queued and she
 * left), and a finished observation with no `teacher_delivery` key at all (she
 * never opened the send flow). A repo-wide grep finds the writes and no read:
 * the only sweep that looks inside `teacher_delivery` narrows to
 * `awaiting_teacher_tap` in the query itself.
 *
 * Measured read-only on production 15 Sep: of 2,499 finished coach
 * observations, 465 have no delivery record, 62 sit at `awaiting_confirm` and 12
 * at `previewing` -- 539 reports that no mechanism will ever mention again,
 * across 51 coaches, median age 14.4 days.
 *
 * That age distribution is what decides the shape of the planner rather than
 * its thresholds. 407 of the 539 are already over a week old, so a naive
 * "remind everyone overdue" first tick is a 400-message spam wave. That exact
 * mistake is already on the record for the sibling sweep, and its remedy is the
 * one copied here: past the ceiling, a delivery nobody ever chased is closed
 * SILENTLY.
 *
 * Pure -- no I/O, no clock of its own. The planner decides, the worker executes.
 */

const {
  classifyUndelivered,
  OWNED_DELIVERY_STATES,
  REMIND_AFTER_MS,
  GIVE_UP_AFTER_MS,
  EXPIRE_AFTER_MS,
} = require('../../shared/services/observe/observe-undelivered.service');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-15T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

const candidate = (over = {}) => ({
  deliveryStatus: 'awaiting_confirm',
  sessionStatus: 'observer_review_complete',
  finishedAt: ago(2 * DAY),
  reminded_at: null,
  gave_up_at: null,
  ...over,
});

const act = (over, now = NOW) => classifyUndelivered(candidate(over), now).action;
const why = (over, now = NOW) => classifyUndelivered(candidate(over), now).reason;

describe('the thresholds are the documented ones and are env-overridable', () => {
  test('24h remind, 72h give up, 7d expire', () => {
    expect(REMIND_AFTER_MS).toBe(24 * HOUR);
    expect(GIVE_UP_AFTER_MS).toBe(72 * HOUR);
    expect(EXPIRE_AFTER_MS).toBe(7 * DAY);
  });

  test('the three owned delivery states are named, not implied', () => {
    // Read as a set so the worker's queries and this planner cannot drift apart.
    expect([...OWNED_DELIVERY_STATES].sort()).toEqual(['awaiting_confirm', 'previewing']);
  });
});

describe('each owned state at each age', () => {
  const states = ['awaiting_confirm', 'previewing', null, undefined];

  test.each(states)('%s: under 24h → skip, the coach may still be mid-flow', (deliveryStatus) => {
    expect(act({ deliveryStatus, finishedAt: ago(0) })).toBe('skip');
    expect(act({ deliveryStatus, finishedAt: ago(23 * HOUR) })).toBe('skip');
    expect(why({ deliveryStatus, finishedAt: ago(1 * HOUR) })).toBe('within_grace_window');
  });

  test.each(states)('%s: 25h → remind', (deliveryStatus) => {
    expect(act({ deliveryStatus, finishedAt: ago(25 * HOUR) })).toBe('remind');
    expect(why({ deliveryStatus, finishedAt: ago(25 * HOUR) })).toBe('no_send_after_grace');
  });

  test.each(states)('%s: 73h and never reminded → still remind, not give_up', (deliveryStatus) => {
    // give_up is measured from the REMINDER, because give_up is the closing
    // event the coach is owed after being asked once. A row that was never
    // asked has not earned it yet.
    expect(act({ deliveryStatus, finishedAt: ago(73 * HOUR) })).toBe('remind');
  });

  test.each(states)('%s: 8 days and never reminded → expire, SILENTLY', (deliveryStatus) => {
    expect(act({ deliveryStatus, finishedAt: ago(8 * DAY) })).toBe('expire');
    expect(why({ deliveryStatus, finishedAt: ago(8 * DAY) })).toBe('too_old_to_chase');
  });

  test.each(states)('%s: reminded, then 72h of silence → give_up', (deliveryStatus) => {
    expect(act({
      deliveryStatus, finishedAt: ago(10 * DAY), reminded_at: ago(73 * HOUR),
    })).toBe('give_up');
    expect(why({
      deliveryStatus, finishedAt: ago(10 * DAY), reminded_at: ago(73 * HOUR),
    })).toBe('no_send_after_reminder');
  });

  test.each(states)('%s: reminded an hour ago → skip, give her time to answer', (deliveryStatus) => {
    expect(act({
      deliveryStatus, finishedAt: ago(10 * DAY), reminded_at: ago(1 * HOUR),
    })).toBe('skip');
  });

  test.each(states)('%s: a reminded row past the expire ceiling still gets its give_up', (deliveryStatus) => {
    // The ceiling only silences rows NOBODY ever chased. Once a coach has been
    // asked, she is told plainly that we stopped -- that is the whole point of
    // the closing event, and it fires exactly once.
    expect(act({
      deliveryStatus, finishedAt: ago(40 * DAY), reminded_at: ago(30 * DAY),
    })).toBe('give_up');
  });
});

describe('what the planner refuses to touch', () => {
  test('a delivery that already reached the teacher is never chased', () => {
    expect(act({ deliveryStatus: 'sent', finishedAt: ago(30 * DAY) })).toBe('skip');
    expect(why({ deliveryStatus: 'sent', finishedAt: ago(30 * DAY) })).toBe('not_undelivered');
  });

  test('awaiting_teacher_tap belongs to the untapped planner, not this one', () => {
    // Two sweeps acting on one row would nudge the coach and the teacher about
    // the same report in the same tick.
    expect(act({ deliveryStatus: 'awaiting_teacher_tap', finishedAt: ago(30 * DAY) })).toBe('skip');
  });

  test('a delivery the coach cancelled is terminal by intent', () => {
    expect(act({ deliveryStatus: 'cancelled', finishedAt: ago(30 * DAY) })).toBe('skip');
  });

  test('send_failed and operator_review are other owners, left alone', () => {
    expect(act({ deliveryStatus: 'send_failed', finishedAt: ago(30 * DAY) })).toBe('skip');
    expect(act({ deliveryStatus: 'operator_review', finishedAt: ago(30 * DAY) })).toBe('skip');
  });

  test('an observation still awaiting the observer review is NOT this sweep', () => {
    // A different owner is mid-fix on that state. Two sweeps on one row is how
    // a coach gets told two contradictory things about the same observation.
    expect(act({
      deliveryStatus: null, sessionStatus: 'awaiting_observer_review', finishedAt: ago(30 * DAY),
    })).toBe('skip');
    expect(why({
      deliveryStatus: null, sessionStatus: 'awaiting_observer_review', finishedAt: ago(30 * DAY),
    })).toBe('session_not_finished');
  });

  test('any unfinished session is out: the report does not exist yet', () => {
    for (const sessionStatus of ['transcribing', 'analyzing', 'generating_report',
      'awaiting_photo', 'awaiting_lesson_plan', 'conducting_conversation', 'initiated']) {
      expect(act({ deliveryStatus: null, sessionStatus, finishedAt: ago(30 * DAY) })).toBe('skip');
    }
  });

  test('cancelled and abandoned sessions are never chased', () => {
    expect(act({ deliveryStatus: null, sessionStatus: 'cancelled', finishedAt: ago(30 * DAY) })).toBe('skip');
    expect(act({ deliveryStatus: null, sessionStatus: 'abandoned', finishedAt: ago(30 * DAY) })).toBe('skip');
  });

  test('both finished statuses ARE in scope', () => {
    for (const sessionStatus of ['completed', 'observer_review_complete']) {
      expect(act({ deliveryStatus: null, sessionStatus, finishedAt: ago(25 * HOUR) })).toBe('remind');
    }
  });

  test('a row already given up on is never acted on twice', () => {
    expect(act({ finishedAt: ago(30 * DAY), gave_up_at: ago(1 * DAY) })).toBe('skip');
    expect(why({ finishedAt: ago(30 * DAY), gave_up_at: ago(1 * DAY) })).toBe('already_closed');
  });

  test('no usable timestamp → skip, never a guess', () => {
    expect(act({ finishedAt: null })).toBe('skip');
    expect(act({ finishedAt: 'not-a-date' })).toBe('skip');
    expect(why({ finishedAt: null })).toBe('no_finished_timestamp');
  });

  test('a garbage input is a skip, not a throw — this runs in a worker loop', () => {
    expect(classifyUndelivered(null, NOW).action).toBe('skip');
    expect(classifyUndelivered(undefined, NOW).action).toBe('skip');
    expect(classifyUndelivered({}, NOW).action).toBe('skip');
  });
});

describe('the production population, classified', () => {
  // The shape measured on prod 15 Sep, asserted as a table so the first tick's
  // behaviour is reviewable without running it.
  test('today\'s median row (14 days, never chased) expires silently', () => {
    expect(act({ finishedAt: ago(14.4 * DAY) })).toBe('expire');
  });

  test('a fresh one from this morning is left alone', () => {
    expect(act({ finishedAt: ago(4 * HOUR) })).toBe('skip');
  });

  test('the 3-7 day band is the one the coach actually hears about', () => {
    expect(act({ finishedAt: ago(4 * DAY) })).toBe('remind');
    expect(act({ finishedAt: ago(6.9 * DAY) })).toBe('remind');
    expect(act({ finishedAt: ago(7.1 * DAY) })).toBe('expire');
  });
});
