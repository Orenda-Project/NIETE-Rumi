'use strict';

jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(true),
  delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/constants', () => ({ STUDENT_VIDEOS_FLOW_ID: 'flow-123' }));

const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const ChildFlowToken = require('../../shared/services/quiz/child-flow-token');
const Binge = require('../../shared/services/quiz/video-quiz-binge.service');

const PHONE = '+923001234567';
const MORE_KEY = `videoquiz:923001234567:more`;

beforeEach(() => jest.clearAllMocks());

describe('offerMore', () => {
  it('is a silent no-op without studentId or shareCodeId — nothing to attribute the next round to', async () => {
    expect(await Binge.offerMore({ phone: PHONE, studentId: null, shareCodeId: 'sc-1' })).toBe(false);
    expect(await Binge.offerMore({ phone: PHONE, studentId: 'st-1', shareCodeId: null })).toBe(false);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  it('stores context and sends a 2-button watch-more offer', async () => {
    const ok = await Binge.offerMore({
      phone: PHONE, studentId: 'st-1', shareCodeId: 'sc-1', language: 'ur',
    });
    expect(ok).toBe(true);
    expect(redisService.set).toHaveBeenCalledWith(
      MORE_KEY,
      { studentId: 'st-1', shareCodeId: 'sc-1', language: 'ur' },
      expect.any(Number)
    );
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledWith(PHONE, expect.objectContaining({
      buttons: [
        expect.objectContaining({ id: Binge.MORE_YES }),
        expect.objectContaining({ id: Binge.MORE_NO }),
      ],
    }));
  });
});

describe('handleMoreButton', () => {
  it('returns false for a button id it does not own', async () => {
    expect(await Binge.handleMoreButton('vq_invite_yes', PHONE)).toBe(false);
  });

  it('is a no-op (but claims the tap) when the offer has expired', async () => {
    redisService.get.mockResolvedValue(null);
    expect(await Binge.handleMoreButton(Binge.MORE_NO, PHONE)).toBe(true);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  });

  it('on NO: tells the child they can always come back via /video, and does not open the picker', async () => {
    redisService.get.mockResolvedValue({ studentId: 'st-1', shareCodeId: 'sc-1', language: 'en' });
    expect(await Binge.handleMoreButton(Binge.MORE_NO, PHONE)).toBe(true);
    expect(redisService.delete).toHaveBeenCalledWith(MORE_KEY);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(
      PHONE, expect.stringContaining('/video')
    );
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
  });

  it('on YES: opens the Student Videos Flow with a childpick token carrying the same studentId/shareCodeId/language', async () => {
    redisService.get.mockResolvedValue({ studentId: 'st-1', shareCodeId: 'sc-1', language: 'ur' });
    expect(await Binge.handleMoreButton(Binge.MORE_YES, PHONE)).toBe(true);
    expect(redisService.delete).toHaveBeenCalledWith(MORE_KEY);
    expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    const [to, flowData] = WhatsAppService.sendFlow.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(flowData.flowId).toBe('flow-123');
    const parsed = ChildFlowToken.parse(flowData.flowToken);
    expect(parsed).toMatchObject({ shareCodeId: 'sc-1', studentId: 'st-1', language: 'ur' });
  });

  it('on YES: fails gracefully (no throw) when STUDENT_VIDEOS_FLOW_ID is not configured', async () => {
    jest.resetModules();
    jest.doMock('../../shared/utils/constants', () => ({ STUDENT_VIDEOS_FLOW_ID: '' }));
    jest.doMock('../../shared/services/cache/railway-redis.service', () => ({
      get: jest.fn().mockResolvedValue({ studentId: 'st-1', shareCodeId: 'sc-1', language: 'en' }),
      set: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn().mockResolvedValue(true),
      sendInteractiveButtons: jest.fn().mockResolvedValue(true),
      sendFlow: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const BingeNoFlow = require('../../shared/services/quiz/video-quiz-binge.service');
    const WA = require('../../shared/services/whatsapp.service');
    const result = await BingeNoFlow.handleMoreButton(BingeNoFlow.MORE_YES, PHONE);
    expect(result).toBe(true);
    expect(WA.sendFlow).not.toHaveBeenCalled();
    expect(WA.sendMessage).toHaveBeenCalled();
  });
});
