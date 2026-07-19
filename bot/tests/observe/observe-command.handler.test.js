/**
 * FEAT-053 bd-12 + bd-14(stub) — /observe command handler orchestration.
 * Gates → onboarding (once, per A/B arm) → capture prompt + Redis state.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn().mockResolvedValue(true),
  getState: jest.fn().mockResolvedValue(null),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/region', () => ({
  detectRegion: jest.fn().mockReturnValue('TZ'),
}));
// bd-21: the capture path first checks for pending debriefs
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: jest.fn().mockResolvedValue([]),
  listUnsentReports: jest.fn().mockResolvedValue([]),
  buildPendingListPayload: jest.fn(() => ({
    body: 'list-body', action: { button: 'Chagua', sections: [{ rows: [] }] },
  })),
}));

const mockEq = jest.fn().mockResolvedValue({ data: null, error: null });
const mockUpdate = jest.fn(() => ({ eq: mockEq }));
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => ({ update: mockUpdate })),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const { detectRegion } = require('../../shared/utils/region');
const ObserveDebrief = require('../../shared/services/observe/observe-debrief.service');
const { handleObserveCommand } = require('../../shared/handlers/observe-command.handler');

const FO = (over = {}) => ({
  id: 'fo-uuid-1',
  phone_number: '255785150099',
  role: 'school_leader',
  preferred_language: 'sw',
  preferences: { observe_onboarding_arm: 'why_coaching' },
  ...over,
});
const FROM = '255785150099';

process.env.OBSERVE_MEWAKA_FLOW_ID = 'test-flow-id';   // FEAT-093 bd-48: configured service

beforeEach(() => jest.clearAllMocks());

describe('handleObserveCommand', () => {
  test('FEAT-093: an UNCONFIGURED service returns false, sends nothing (market off = silent)', async () => {
    const saved = process.env.OBSERVE_MEWAKA_FLOW_ID;
    delete process.env.OBSERVE_MEWAKA_FLOW_ID;
    detectRegion.mockReturnValueOnce('TZ');
    const handled = await handleObserveCommand(FO(), FROM, '/observe');
    process.env.OBSERVE_MEWAKA_FLOW_ID = saved;
    expect(handled).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(ObserveState.setState).not.toHaveBeenCalled();
  });

  test('teacher role on TZ → polite decline, no state', async () => {
    const handled = await handleObserveCommand(FO({ role: 'teacher' }), FROM, '/observe');
    expect(handled).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(ObserveState.setState).not.toHaveBeenCalled();
  });

  test('first trigger (not onboarded) → onboarding for the arm + capture prompt + state + flag persisted', async () => {
    const handled = await handleObserveCommand(FO(), FROM, '/observe');
    expect(handled).toBe(true);
    // preferences flag persisted (users.update called with merged preferences)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.preferences.observe_onboarded).toBe(true);
    expect(mockEq).toHaveBeenCalledWith('id', 'fo-uuid-1');
    // at least: onboarding message + capture prompt
    expect(WhatsAppService.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    // capture state armed
    expect(ObserveState.setState).toHaveBeenCalledWith('fo-uuid-1', 'awaiting_audio',
      expect.objectContaining({ arm: 'why_coaching' }));
  });

  test('why_coaching arm gets the why content; functional arm does not', async () => {
    await handleObserveCommand(FO(), FROM, '/observe');
    const whyText = WhatsAppService.sendMessage.mock.calls.map(c => c[1]).join('\n');
    jest.clearAllMocks();
    await handleObserveCommand(
      FO({ preferences: { observe_onboarding_arm: 'functional' } }), FROM, '/observe');
    const funText = WhatsAppService.sendMessage.mock.calls.map(c => c[1]).join('\n');
    expect(whyText).not.toEqual(funText);
    expect(whyText.length).toBeGreaterThan(funText.length);
  });

  test('already onboarded → straight to capture prompt (1 message) + state', async () => {
    const user = FO({ preferences: { observe_onboarded: true, observe_onboarding_arm: 'functional' } });
    const handled = await handleObserveCommand(user, FROM, '/observe');
    expect(handled).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();          // no re-onboarding
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(ObserveState.setState).toHaveBeenCalledWith('fo-uuid-1', 'awaiting_audio', expect.any(Object));
  });

  test('swahili strings used for sw-preference user', async () => {
    const user = FO({ preferences: { observe_onboarded: true } });
    await handleObserveCommand(user, FROM, '/observe');
    const msg = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(msg).toMatch(/rekodi|somo|darasa/i);   // Swahili capture prompt
  });

  test('no user → account-not-found message', async () => {
    const handled = await handleObserveCommand(null, FROM, '/observe');
    expect(handled).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(ObserveState.setState).not.toHaveBeenCalled();
  });

  // ── bd-21: pending-debrief list on re-trigger ─────────────────────────
  describe('pending debriefs (bd-21)', () => {
    const onboarded = () => FO({ preferences: { observe_onboarded: true, observe_onboarding_arm: 'functional' } });

    test('onboarded + pendings → interactive list, NOT the capture prompt, no capture state', async () => {
      ObserveDebrief.listPendingDebriefs.mockResolvedValueOnce([
        { id: 'sess-1', created_at: '2026-07-11T06:40:00Z', analysis_data: {} },
      ]);
      const handled = await handleObserveCommand(onboarded(), FROM, '/observe');
      expect(handled).toBe(true);
      expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
      expect(ObserveState.setState).not.toHaveBeenCalled();   // list tap decides next step
    });

    test('onboarded + no pendings → capture prompt exactly as before', async () => {
      const handled = await handleObserveCommand(onboarded(), FROM, '/observe');
      expect(handled).toBe(true);
      expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
      expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
      expect(ObserveState.setState).toHaveBeenCalledWith('fo-uuid-1', 'awaiting_audio', expect.any(Object));
    });

    test('first trigger (onboarding) NEVER shows the list — onboarding owns the first contact', async () => {
      ObserveDebrief.listPendingDebriefs.mockResolvedValue([
        { id: 'sess-1', created_at: '2026-07-11T06:40:00Z', analysis_data: {} },
      ]);
      await handleObserveCommand(FO(), FROM, '/observe');
      expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
    });

    test('pending lookup failure → degrade to capture prompt (never dead-end the FO)', async () => {
      ObserveDebrief.listPendingDebriefs.mockRejectedValueOnce(new Error('db down'));
      const handled = await handleObserveCommand(onboarded(), FROM, '/observe');
      expect(handled).toBe(true);
      expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
      expect(ObserveState.setState).toHaveBeenCalled();
    });
  });
});
