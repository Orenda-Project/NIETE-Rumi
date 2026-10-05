/**
 * /observe2 — the two forms' completions reach their own handler.
 *
 * A completion nobody claims ends on the webhook's catch-all ("Thanks for your response! Type /menu"),
 * and one whose token carries a colon is silently taken as attendance marking. Both /observe2 forms
 * carry colon tokens (<userId>:observe2-form:<recordId>, <userId>:observe2-check:<recordId>), and Meta
 * drops extension_message_response from a completion, so the rule matches the flat key OR the marker.
 *
 * The chat follow-ups (what to do with the recording, the brief) are sent by the endpoint when the
 * coach taps "Seal and send" / "Submit", because the completion only arrives if they also tap "Done".
 * So the completion handler acknowledges nothing a second time.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));

const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');

describe('the detector claims both /observe2 completions', () => {
  test('the flat key from the sealed form', () => {
    expect(detectFlowType({ observe2: 'sealed', record_id: 'r1', flow_token: 'u1:observe2-form:r1' })).toBe('observe2');
  });
  test('the flat key from the check', () => {
    expect(detectFlowType({ observe2: 'checked', record_id: 'r1', flow_token: 'u1:observe2-check:r1' })).toBe('observe2');
  });
  test.each(['u1:observe2-form:r1', 'u1:observe2-check:r1'])('the token marker alone (%s), when Meta drops the keys', (token) => {
    expect(detectFlowType({ flow_token: token })).toBe('observe2');
  });
  test('never misrouted to attendance marking', () => {
    expect(detectFlowType({ flow_token: 'u1:observe2-form:r1' })).not.toBe('attendance_marking');
  });
});

describe('the rest of observe keeps its routes', () => {
  test('the visit planner started from /observe2 is still the visit planner', () => {
    expect(detectFlowType({ step: 'start', teacher_ext_id: 't1', school_ext_id: 's1', flow_token: 'u1:observe2-visit' })).toBe('observe_visit');
  });
  test('the classic FICO review is still observe', () => {
    expect(detectFlowType({ observe_action: 'submitted', flow_token: 'u1:s1' })).toBe('observe');
  });
  test('an attendance token is still attendance', () => {
    expect(detectFlowType({ flow_token: 'u1:c1:2026-09-30:morning:Class%204' })).toBe('attendance_marking');
  });
});

describe('the completion handler acknowledges nothing twice', () => {
  const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
  const { handleObserve2Completion } = require('../../bot/shared/handlers/flow-response.handler');

  beforeEach(() => jest.clearAllMocks());

  test.each(['sealed', 'checked'])('a %s completion is handled and sends no message', async (action) => {
    const out = await handleObserve2Completion({ observe2: action, record_id: 'r1', flow_token: `u1:observe2-${action === 'sealed' ? 'form' : 'check'}:r1` }, '923000000000', { id: 'u1' });
    expect(out).toEqual({ handled: true, action });
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a token-only completion is still handled', async () => {
    const out = await handleObserve2Completion({ flow_token: 'u1:observe2-check:r1' }, '923000000000', { id: 'u1' });
    expect(out).toEqual({ handled: true, action: 'checked' });
  });
});

describe('the webhook branches on it', () => {
  test('whatsapp-bot.js routes flowType observe2 to the handler, above the catch-all', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');
    const branch = src.indexOf("flowType === 'observe2'");
    // The literal also appears in comments above; the catch-all is the last, quoted occurrence.
    const catchAll = src.lastIndexOf('"Thanks for your response! Type /menu');
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(catchAll);
    expect(src.slice(branch, branch + 800)).toMatch(/FlowResponseHandler\.handleObserve2Completion\(/);
  });
});
