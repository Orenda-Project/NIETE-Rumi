/**
 * Registration flow gating — sendNameQuestion opens the WhatsApp registration
 * Flow when REGISTRATION_FLOW_ID is set, and falls back to the conversational
 * name question (OSS default) when it is unset. Presence-gated.
 */

describe('registration flow gating (FeatureRegistrationService.sendNameQuestion)', () => {
  const ORIG = process.env.REGISTRATION_FLOW_ID;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.REGISTRATION_FLOW_ID;
    else process.env.REGISTRATION_FLOW_ID = ORIG;
  });

  function load() {
    jest.resetModules();
    jest.doMock('uuid', () => ({ v4: () => 'test-uuid' }), { virtual: true });
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    const sendFlow = jest.fn().mockResolvedValue(true);
    const sendMessage = jest.fn().mockResolvedValue(true);
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendFlow, sendMessage, sendAudio: jest.fn().mockResolvedValue(true),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }));
    jest.doMock('../../bot/shared/services/audio.service', () => ({
      generateSpeechForLanguage: jest.fn().mockResolvedValue(Buffer.from('')),
    }));
    jest.doMock('../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp' }));
    const Svc = require('../../bot/shared/services/feature-registration.service');
    return { Svc, sendFlow, sendMessage };
  }

  it('opens the registration Flow when REGISTRATION_FLOW_ID is set', async () => {
    process.env.REGISTRATION_FLOW_ID = 'flow_reg_test';
    const { Svc, sendFlow, sendMessage } = load();
    await Svc.sendNameQuestion('u1', '+100', 'en', 'text');
    expect(sendFlow).toHaveBeenCalledTimes(1);
    expect(sendFlow.mock.calls[0][1].flowId).toBe('flow_reg_test');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to the conversational name question when REGISTRATION_FLOW_ID is unset', async () => {
    delete process.env.REGISTRATION_FLOW_ID;
    const { Svc, sendFlow, sendMessage } = load();
    await Svc.sendNameQuestion('u1', '+100', 'en', 'text');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendFlow).not.toHaveBeenCalled();
  });
});
