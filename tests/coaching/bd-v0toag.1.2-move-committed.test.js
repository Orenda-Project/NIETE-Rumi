'use strict';
/**
 * bd-v0toag.1.2 — coaching.report.move_committed: the teacher taps "Yes" on "Will you commit to trying this in
 * your next class?" (card_yes_<session>). Later / No are not a commitment and log nothing.
 */
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  ...jest.requireActual('../../bot/shared/utils/structured-logger'), logEvent: (...a) => mockLogEvent(...a),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true) }));
const UID = '0b9c3f1e-1111-4222-8333-444444444444';
const SID = '22222222-3333-4444-8555-666666666666';
const mockSelects = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => {
    const b = {};
    b.select = (cols) => { mockSelects.push(cols); return b; };
    ['eq', 'update'].forEach((m) => { b[m] = () => b; });
    b.single = async () => ({ data: { prioritized_action: { action: 'x' }, user_id: '0b9c3f1e-1111-4222-8333-444444444444' }, error: null });
    b.then = (ok, ko) => Promise.resolve({ data: null, error: null }).then(ok, ko);
    return b;
  },
}));

const { handleCoachingCardResponse } = require('../../bot/shared/services/coaching/coaching-card/card-response.service');
const committed = () => mockLogEvent.mock.calls.filter((c) => c[0] === 'coaching.report.move_committed').map((c) => c[1]);

beforeEach(() => { mockLogEvent.mockClear(); mockSelects.length = 0; });

test('"Yes" logs move_committed with the teacher uuid and the session', async () => {
  await handleCoachingCardResponse(SID, 'yes');
  expect(committed()).toEqual([{ userId: UID, sessionId: SID }]);
});

test.each(['later', 'no'])('"%s" is not a commitment: nothing logged', async (r) => {
  await handleCoachingCardResponse(SID, r);
  expect(committed()).toEqual([]);
});
