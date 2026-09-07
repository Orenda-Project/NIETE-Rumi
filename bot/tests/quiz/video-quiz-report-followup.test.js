'use strict';
/**
 * Operator, 2026-09-07, on the class report: "since we dont know the size of the
 * class, I thought reports go 12 hours after the quiz? Why did some of them go
 * now? These might be incomplete?"
 *
 * They were. Of the three reports sent that day, two fired 12.0h and 12.2h after
 * their first child — the scheduled path, correct. The third fired 3.0h after
 * its first child, because the EARLY path sends as soon as every session it can
 * see is terminal and 2h have passed since the newest:
 *
 *    link to teacher 12:56 · first child 17:32 · report sent 20:35
 *    children: 17:32 done · 17:38 done · 20:33 done · 20:38 started
 *
 * At the instant of the check only the 17:32 and 17:38 children existed. A third
 * was mid-quiz at 20:33 and a fourth started three minutes after the report went
 * out — and because there was one report per share code, ever, neither could
 * ever reach the teacher.
 *
 * The defect was never the length of the window. It was deciding on a SNAPSHOT
 * and then closing the door for good. We do not know the class size, so "every
 * session is terminal" cannot mean "the class is done"; it only ever means
 * "nobody happens to be mid-quiz right now".
 *
 * So: the early path is deleted, and the deadline report is followed by ONE
 * follow-up when materially more children finish afterwards.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const report = require('../../shared/services/quiz/video-quiz-report.service');

describe('1 · the early path is gone', () => {
  test('shouldSendEarly no longer exists', () => {
    expect(report.shouldSendEarly).toBeUndefined();
  });
  test('maybeSendEarly no longer exists', () => {
    expect(report.maybeSendEarly).toBeUndefined();
  });
});

describe('2 · one follow-up, when materially more children finish', () => {
  const d = (o) => report.followUpDecision(o);

  test('three more children finishing earns a follow-up', () => {
    expect(d({ reportedOn: 12, finishedSince: 3, alreadyFollowedUp: false }).send).toBe(true);
  });
  test('two more does not, when it is a small share of what was reported', () => {
    expect(d({ reportedOn: 12, finishedSince: 2, alreadyFollowedUp: false }).send).toBe(false);
  });
  test('half again as many earns it even when the absolute number is small', () => {
    // MGMM39's real shape: 2 children reported, a third finishes afterwards.
    expect(d({ reportedOn: 2, finishedSince: 1, alreadyFollowedUp: false }).send).toBe(true);
  });
  test('nobody new means no follow-up', () => {
    expect(d({ reportedOn: 9, finishedSince: 0, alreadyFollowedUp: false }).send).toBe(false);
  });
  test('only ONE follow-up, however many arrive after it', () => {
    expect(d({ reportedOn: 9, finishedSince: 20, alreadyFollowedUp: true }).send).toBe(false);
    expect(d({ reportedOn: 9, finishedSince: 20, alreadyFollowedUp: true }).why).toBe('followup_already_sent');
  });
  test('the reason is named either way, so a suppression is readable in the logs', () => {
    expect(d({ reportedOn: 9, finishedSince: 1, alreadyFollowedUp: false }).why).toBe('not_enough_new');
    expect(d({ reportedOn: 9, finishedSince: 5, alreadyFollowedUp: false }).why).toBe('more_children_finished');
  });
  test('a report that covered nobody is followed up by the first finisher', () => {
    expect(d({ reportedOn: 0, finishedSince: 1, alreadyFollowedUp: false }).send).toBe(true);
  });
});

describe('3 · the deadline itself is unchanged', () => {
  test('a noon lesson lands at midnight, so it is held to 07:00 the next morning', () => {
    const noon = new Date(Date.UTC(2026, 8, 8, 7, 0));            // 12:00 PKT
    expect(report.reportTargetUtc(noon).toISOString())
      .toBe(new Date(Date.UTC(2026, 8, 9, 2, 0)).toISOString());  // 07:00 PKT, next day
  });
  test('a 09:00 first child is reported at 21:00 the same evening', () => {
    const nine = new Date(Date.UTC(2026, 8, 8, 4, 0));            // 09:00 PKT
    expect(report.reportTargetUtc(nine).toISOString())
      .toBe(new Date(Date.UTC(2026, 8, 8, 16, 0)).toISOString()); // 21:00 PKT
  });
});
