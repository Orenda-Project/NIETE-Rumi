'use strict';
/**
 * bd-2yyry.9 — the watch-more copy addressed the child in the feminine
 * (چاہیں گی / سکتی ہیں) and lived in an inline per-language map with two
 * English-only Flow strings beside it. Rule 19 (gender-neutral always) and the
 * language protocol (one catalog, every string cap-checked) both apply: the
 * copy moves to ux-strings.js, the Urdu is rewritten with imperatives, and the
 * Flow header/body/button follow the quiz language.
 */

jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/constants', () => ({ STUDENT_VIDEOS_FLOW_ID: 'flow-123' }));

const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { resolveUx } = require('../../shared/config/ux-strings');
const Binge = require('../../shared/services/quiz/video-quiz-binge.service');

const PHONE = '+923001234567';
const GENDERED_ADDRESS = /چاہیں گی|چاہیں گے|سکتی ہیں|سکتے ہیں|کریں گی|کریں گے/;
const cp = (s) => Array.from(String(s)).length;

beforeEach(() => jest.clearAllMocks());

describe('bd-2yyry.9 — the copy is catalogued, capped and neutral', () => {
  const KEYS = ['vqMoreAsk', 'vqMoreYes', 'vqMoreNo', 'vqMoreDeclined', 'vqMoreUnavailable',
                'vqMoreFlowHeader', 'vqMoreFlowBody', 'vqMoreFlowButton'];

  test.each(KEYS)('%s exists in both languages and never addresses the child by gender', (key) => {
    for (const language of ['en', 'ur']) {
      const s = resolveUx(key, { language });
      expect(s).toBeTruthy();
      expect(s).not.toMatch(GENDERED_ADDRESS);
    }
  });

  test('the WhatsApp caps hold in code points: buttons ≤ 20, Flow header ≤ 60', () => {
    for (const language of ['en', 'ur']) {
      expect(cp(resolveUx('vqMoreYes', { language }))).toBeLessThanOrEqual(20);
      expect(cp(resolveUx('vqMoreNo', { language }))).toBeLessThanOrEqual(20);
      expect(cp(resolveUx('vqMoreFlowButton', { language }))).toBeLessThanOrEqual(20);
      expect(cp(resolveUx('vqMoreFlowHeader', { language }))).toBeLessThanOrEqual(60);
    }
  });

  test('the offer is sent from the catalog, in the quiz language', async () => {
    await Binge.offerMore({ phone: PHONE, studentId: 'st-1', shareCodeId: 'sc-1', language: 'ur' });
    const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(opts.body).toBe(resolveUx('vqMoreAsk', { language: 'ur' }));
    expect(opts.buttons.map((b) => b.title)).toEqual([
      resolveUx('vqMoreYes', { language: 'ur' }), resolveUx('vqMoreNo', { language: 'ur' }),
    ]);
  });

  test('on YES the Flow header, body and button follow the quiz language (they were English-only)', async () => {
    redisService.get.mockResolvedValue({ studentId: 'st-1', shareCodeId: 'sc-1', language: 'ur' });
    await Binge.handleMoreButton(Binge.MORE_YES, PHONE);
    const [, flowData] = WhatsAppService.sendFlow.mock.calls[0];
    expect(flowData.header).toBe(resolveUx('vqMoreFlowHeader', { language: 'ur' }));
    expect(flowData.body).toBe(resolveUx('vqMoreFlowBody', { language: 'ur' }));
    expect(flowData.buttonText).toBe(resolveUx('vqMoreFlowButton', { language: 'ur' }));
  });

  test('on NO the decline line comes from the catalog', async () => {
    redisService.get.mockResolvedValue({ studentId: 'st-1', shareCodeId: 'sc-1', language: 'ur' });
    await Binge.handleMoreButton(Binge.MORE_NO, PHONE);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('vqMoreDeclined', { language: 'ur' }));
  });

  test('no inline per-language map survives in the module', () => {
    const src = require('fs').readFileSync(require.resolve('../../shared/services/quiz/video-quiz-binge.service'), 'utf8');
    expect(src).not.toMatch(/function moreStrings/);
  });
});
