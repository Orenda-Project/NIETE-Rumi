/**
 * The /quiz Flow's completion has to land somewhere.
 *
 * Two ways the Flow ends, and both must be recognised by the chat side, or they
 * fall to whatsapp-bot.js's generic "Thanks for your response! Type /menu…" arm —
 * or worse, to the attendance rule, which claims any payload that is only a
 * flow_token. Observed on sandbox, 10 Sep: the operator's Done tap on the DONE
 * screen was logged as flowType=attendance_marking.
 *
 *   1. make_* — the endpoint closes the Flow itself (Meta's reserved SUCCESS
 *      screen) because the chat already says "making it now".
 *   2. report / link / wait — DONE's Footer completes, carrying its kind.
 *
 * Both ship `tq_action`; the chat side only ever acknowledges by logging. The
 * message the teacher needs was already sent by the work itself (tqMaking, the
 * report, the resent link) — ONE message, not two, the remark branch's rule.
 */
const fs = require('fs');
const path = require('path');

describe('detectFlowType: a /quiz completion is recognised', () => {
  const { detectFlowType } = require('../../bot/shared/utils/flow-type-detector');

  it('tq_action → "transcript_quiz", and is NOT eaten by the loose attendance fallback', () => {
    expect(detectFlowType({ tq_action: 'make', language: 'en' })).toBe('transcript_quiz');
    expect(detectFlowType({ tq_action: 'make', flow_token: 'u:transcript-quiz:1' })).toBe('transcript_quiz');
    expect(detectFlowType({ tq_action: 'wait', flow_token: 'u:transcript-quiz:1' })).toBe('transcript_quiz');
  });

  it('existing detections unchanged', () => {
    expect(detectFlowType({ flow_token: 'a:b' })).toBe('attendance_marking');
    expect(detectFlowType({ status_action: 'done' })).toBe('status');
    expect(detectFlowType({})).toBe('unknown');
  });
});

describe('the completion ack is silent', () => {
  let sendMessage; let logToFile; let handler;
  beforeEach(() => {
    jest.resetModules();
    sendMessage = jest.fn().mockResolvedValue(true);
    logToFile = jest.fn();
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendMessage, sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    }));
    handler = require('../../bot/shared/handlers/flow-response.handler');
  });

  it.each(['make', 'report', 'link', 'wait'])('%s: recognised, logged, and sends nothing', async (kind) => {
    const handled = await handler.handleTranscriptQuizFlowCompletion({ tq_action: kind }, '923000000000');
    expect(handled).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('quiz flow completion'), expect.objectContaining({ action: kind }));
  });
});

describe('the dispatch in whatsapp-bot.js has the branch (wiring)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');
  it('routes transcript_quiz before the generic arm', () => {
    expect(src).toContain("flowType === 'transcript_quiz'");
    expect(src).toContain('handleTranscriptQuizFlowCompletion');
  });
});
