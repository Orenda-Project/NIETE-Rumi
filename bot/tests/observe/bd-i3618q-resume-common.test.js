/**
 * bd-i3618q — the helpers shared by resume and retry (observe-resume-common.js):
 * _loadOwn only hands back the coach's own observation; _sendButtons caps at three buttons.
 */
const mockRow = { current: null };
jest.mock('../../shared/config/supabase', () => {
  const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: mockRow.current, error: null }) };
  return { from: () => b };
});
const mockWa = { sendMessage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true) };
jest.mock('../../shared/services/whatsapp.service', () => mockWa);
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { _loadOwn, _sendButtons, _refuseTerminal } = require('../../shared/services/observe/observe-resume-common');

beforeEach(() => { jest.clearAllMocks(); mockRow.current = null; });

describe('bd-i3618q — observe-resume-common', () => {
  test("_loadOwn returns the coach's own row", async () => {
    mockRow.current = { id: 's1', observer_user_id: 'coach-1' };
    expect(await _loadOwn('s1', { id: 'coach-1' })).toEqual(mockRow.current);
  });
  test("_loadOwn refuses another coach's row", async () => {
    mockRow.current = { id: 's1', observer_user_id: 'coach-2' };
    expect(await _loadOwn('s1', { id: 'coach-1' })).toBeNull();
  });
  test('_loadOwn returns null for a missing row', async () => {
    expect(await _loadOwn('s1', { id: 'coach-1' })).toBeNull();
  });
  test('_sendButtons sends at most three buttons', async () => {
    const four = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` }));
    await _sendButtons('92-X', 'body', four);
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledWith('92-X', { body: 'body', buttons: four.slice(0, 3) });
  });
  test('_refuseTerminal tells the coach the observation is over', async () => {
    await _refuseTerminal({ id: 's1', status: 'cancelled' }, '92-X', { preferred_language: 'en' }, 'retry');
    expect(mockWa.sendMessage).toHaveBeenCalledTimes(1);
    expect(typeof mockWa.sendMessage.mock.calls[0][1]).toBe('string');
  });
});
