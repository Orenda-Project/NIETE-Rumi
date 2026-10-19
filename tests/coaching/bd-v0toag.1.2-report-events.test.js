'use strict';
/**
 * bd-v0toag.1.2 / .1.3 — coaching.report.* log events (Axiom, niete-logs). Logging only: no table, no column,
 * nothing a teacher sees. Each event carries userId (a users.id uuid — never a phone) and sessionId (the
 * coaching_sessions.id); correlationId is added by logEvent from the job's runWithCorrelation context.
 */
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));

const E = require('../../bot/shared/services/coaching/report-events');

const UID = '0b9c3f1e-1111-4222-8333-444444444444';
const SID = '22222222-3333-4444-8555-666666666666';
const PRIOR = '99999999-3333-4444-8555-666666666666';
const last = () => mockLogEvent.mock.calls[mockLogEvent.mock.calls.length - 1];

beforeEach(() => mockLogEvent.mockClear());

describe('coaching.report.generated (bd-v0toag.1.3)', () => {
  test('voice-note duration in whole seconds and the report text length in characters', () => {
    E.reportGenerated({
      userId: UID, sessionId: SID, format: 'image', audioDurationSeconds: 1799.6,
      caption: 'آپ کا سبق 🌱', narrative: { headline: 'abc', moments: [{ title: 'de', quote: 'f' }], strength: null },
    });
    expect(last()).toEqual(['coaching.report.generated', {
      userId: UID, sessionId: SID, format: 'image', audioDurationSec: 1800, reportChars: 11, narrativeChars: 6,
    }]);
  });

  test('a PDF report: no caption, no narrative — the lengths are null, never 0', () => {
    E.reportGenerated({ userId: UID, sessionId: SID, format: 'pdf', audioDurationSeconds: 600 });
    expect(last()[1]).toMatchObject({ format: 'pdf', audioDurationSec: 600, reportChars: null, narrativeChars: null });
  });

  test('an unknown duration is null, not 0', () => {
    E.reportGenerated({ userId: UID, sessionId: SID, format: 'image', audioDurationSeconds: null, caption: '' });
    expect(last()[1]).toMatchObject({ audioDurationSec: null, reportChars: 0 });
  });
});

describe('coaching.report.sent', () => {
  test('names the teacher by uuid and the session', () => {
    E.reportSent({ userId: UID, sessionId: SID, format: 'image' });
    expect(last()).toEqual(['coaching.report.sent', { userId: UID, sessionId: SID, format: 'image' }]);
  });

  test('a phone number in the userId slot is dropped, never logged', () => {
    E.reportSent({ userId: '923001234567', sessionId: SID, format: 'pdf' });
    expect(last()[1].userId).toBeNull();
    expect(JSON.stringify(mockLogEvent.mock.calls)).not.toContain('923001234567');
  });
});

describe('coaching.report.move_committed', () => {
  test('the teacher committed to the thing to try', () => {
    E.moveCommitted({ userId: UID, sessionId: SID });
    expect(last()).toEqual(['coaching.report.move_committed', { userId: UID, sessionId: SID }]);
  });
});

describe('coaching.report.check_back_sent', () => {
  test('the prior commitment came back on her next recording: which session it came from, and how it went', () => {
    E.checkBackSent({ userId: UID, sessionId: SID, priorSessionId: PRIOR, merged: true });
    expect(last()).toEqual(['coaching.report.check_back_sent', {
      userId: UID, sessionId: SID, priorSessionId: PRIOR, merged: true,
    }]);
  });
});

test('logging can never break the flow it watches', () => {
  mockLogEvent.mockImplementationOnce(() => { throw new Error('logger down'); });
  expect(() => E.reportSent({ userId: UID, sessionId: SID, format: 'image' })).not.toThrow();
});
