/**
 * FEAT-053 bd-12 — /observe trigger gate (pure decision helper)
 *
 * Mirrors the evaluateHomeworkTrigger pattern: side-effect-free, unit-testable
 * without the full text-message handler.
 */

// FEAT-093 bd-48: the gate is capability-driven — a configured service (env
// var present) matches in ANY region. These tests run "configured".
process.env.OBSERVE_MEWAKA_FLOW_ID = 'test-flow-id';

const {
  OBSERVE_TRIGGER_RX,
  evaluateObserveTrigger,
  getObserveArm,
  isSchoolLeader,
} = require('../../shared/services/observe/observe-gate');

const FO = (over = {}) => ({
  id: 'fo-uuid-1',
  phone_number: '255785150099',
  role: 'school_leader',
  preferred_language: 'sw',
  preferences: {},
  ...over,
});

describe('OBSERVE_TRIGGER_RX', () => {
  test.each(['/observe', '/OBSERVE', '/Observe', '  /observe  ', '/observe now'])(
    'matches %p', (msg) => {
      expect(OBSERVE_TRIGGER_RX.test(msg.trim())).toBe(true);
    });

  test.each(['observe', '/observer', 'please /observe', '/obser ve', '/quiz'])(
    'does not match %p', (msg) => {
      expect(OBSERVE_TRIGGER_RX.test(msg.trim())).toBe(false);
    });
});

describe('evaluateObserveTrigger', () => {
  test('non-matching message → match:false', () => {
    expect(evaluateObserveTrigger({ messageBody: 'hello', user: FO(), region: 'TZ' }))
      .toEqual({ match: false });
  });

  test('FEAT-093: a CONFIGURED service matches in PK too — capability, not geography', () => {
    expect(evaluateObserveTrigger({ messageBody: '/observe', user: FO(), region: 'PK' }).match)
      .toBe(true);
  });

  test('FEAT-093: an UNCONFIGURED service never matches, even in TZ', () => {
    const saved = process.env.OBSERVE_MEWAKA_FLOW_ID;
    delete process.env.OBSERVE_MEWAKA_FLOW_ID;
    expect(evaluateObserveTrigger({ messageBody: '/observe', user: FO(), region: 'TZ' }))
      .toEqual({ match: false });
    process.env.OBSERVE_MEWAKA_FLOW_ID = saved;
  });

  test('TZ + no user → deny_no_user', () => {
    expect(evaluateObserveTrigger({ messageBody: '/observe', user: null, region: 'TZ' }))
      .toEqual({ match: true, action: 'deny_no_user' });
  });

  test('TZ + teacher role → deny_role', () => {
    expect(evaluateObserveTrigger({ messageBody: '/observe', user: FO({ role: 'teacher' }), region: 'TZ' }))
      .toEqual({ match: true, action: 'deny_role' });
  });

  test('TZ + missing role → deny_role (default teacher)', () => {
    expect(evaluateObserveTrigger({ messageBody: '/observe', user: FO({ role: undefined }), region: 'TZ' }))
      .toEqual({ match: true, action: 'deny_role' });
  });

  test('TZ + school_leader + not onboarded → onboard with arm', () => {
    const user = FO({ preferences: { observe_onboarding_arm: 'why_coaching' } });
    expect(evaluateObserveTrigger({ messageBody: '/observe', user, region: 'TZ' }))
      .toEqual({ match: true, action: 'onboard', arm: 'why_coaching' });
  });

  test('TZ + school_leader + onboarded → capture', () => {
    const user = FO({ preferences: { observe_onboarded: true, observe_onboarding_arm: 'functional' } });
    expect(evaluateObserveTrigger({ messageBody: '/observe', user, region: 'TZ' }))
      .toEqual({ match: true, action: 'capture' });
  });

  test('null preferences tolerated → onboard, functional default', () => {
    const user = FO({ preferences: null });
    expect(evaluateObserveTrigger({ messageBody: '/observe', user, region: 'TZ' }))
      .toEqual({ match: true, action: 'onboard', arm: 'functional' });
  });
});

describe('getObserveArm', () => {
  test('why_coaching arm read from preferences', () => {
    expect(getObserveArm(FO({ preferences: { observe_onboarding_arm: 'why_coaching' } }))).toBe('why_coaching');
  });
  test('defaults to functional (missing/unknown values)', () => {
    expect(getObserveArm(FO())).toBe('functional');
    expect(getObserveArm(FO({ preferences: { observe_onboarding_arm: 'weird' } }))).toBe('functional');
    expect(getObserveArm(FO({ preferences: null }))).toBe('functional');
  });
});

describe('isSchoolLeader', () => {
  test('true only for role=school_leader', () => {
    expect(isSchoolLeader(FO())).toBe(true);
    expect(isSchoolLeader(FO({ role: 'teacher' }))).toBe(false);
    expect(isSchoolLeader(null)).toBe(false);
    expect(isSchoolLeader({})).toBe(false);
  });
});

describe('pickObservationFramework (FEAT-053 framework pin)', () => {
  const { pickObservationFramework } = require('../../shared/services/observe/observe-gate');
  const fakeSelect = jest.fn().mockResolvedValue({ name: 'oecd' });
  const fakeGet = jest.fn((k) => ({ name: k }));

  test('leader observation → pinned to mewaka, selector NEVER consulted', async () => {
    const fw = await pickObservationFramework(
      { observation_type: 'leader_observation', user_id: 'u1' },
      { selectFramework: fakeSelect, getFramework: fakeGet });
    expect(fw.name).toBe('mewaka');
    expect(fakeSelect).not.toHaveBeenCalled();
  });

  test('teacher self-recording → normal selector path', async () => {
    const fw = await pickObservationFramework(
      { observation_type: null, user_id: 'u1' },
      { selectFramework: fakeSelect, getFramework: fakeGet });
    expect(fw.name).toBe('oecd');
    expect(fakeSelect).toHaveBeenCalledWith('u1');
  });
});
