/**
 * The Flow's cancel screen names the actual state.
 *
 * `cancelObservationCore` now distinguishes a cancel that landed from one that
 * lost the race to the pipeline. The Flow branch that renders the outcome knew
 * only 'cancelled' / 'already' / 'too_late', so a raced cancel fell to the
 * generic "that didn't work" copy. One fallback message shared across distinct
 * states misdirects every field report and every engineer who reads them, so
 * 'raced' reads as "too late" — which is what actually happened.
 *
 * Drives the real handler through its real data_exchange entry so the changed
 * line executes; only the resume service and the debrief lists are mocked.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

const { observeStrings } = require('../../shared/services/observe/observe-strings');

describe('obs_cancel outcome copy', () => {
  let H;
  const mockCore = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    process.env.OBSERVE_OBS_ACTION = 'true';
    process.env.OBSERVE_STAGE_SCREENS = 'true';
    jest.doMock('../../shared/services/observe/observe-resume.service', () => ({
      cancelObservationCore: mockCore,
    }), { virtual: true });
    mockCore.mockReset();
    H = require('../../shared/handlers/observe-visit-flow.handler');
  });
  afterEach(() => {
    jest.dontMock('../../shared/services/observe/observe-resume.service');
    delete process.env.OBSERVE_OBS_ACTION;
  });

  const cancel = async () => H.handle('coach-1', 'data_exchange', 'MENU',
    { step: 'obs_cancel', session_id: 'sess-1' }, 'coach-1', null);

  it('RED: a raced cancel reads as too late, not as the generic action-failed copy', async () => {
    mockCore.mockResolvedValue({ outcome: 'raced' });
    const out = await cancel();
    const body = JSON.stringify(out.data);
    const S = observeStrings('en');
    expect(body).toContain(S.cancel_too_late);
    expect(body).not.toContain(S.flow_action_failed_body);
  });

  it('a cancel that landed still renders the cancelled screen', async () => {
    mockCore.mockResolvedValue({ outcome: 'cancelled' });
    const out = await cancel();
    expect(JSON.stringify(out.data)).toContain(observeStrings('en').obs_cancelled_body);
  });

  it('a genuinely failed cancel still renders the action-failed copy', async () => {
    mockCore.mockResolvedValue({ outcome: 'not_yours' });
    const out = await cancel();
    expect(JSON.stringify(out.data)).toContain(observeStrings('en').flow_action_failed_body);
  });
});
