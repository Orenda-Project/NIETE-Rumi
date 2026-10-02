/**
 * Child test gate — CHILD_TEST_ENABLED + coach role + ICT region, inert otherwise.
 * Pure module, no mocks.
 */
const { evaluateChildTestTrigger, isChildTestAvailable } = require('../../../bot/shared/services/child-test/conversation/gate');

const COACH = { id: 'c1', role: 'coach', region: 'niete' };
const TEACHER = { id: 't1', role: 'teacher', region: 'niete' };
const SAVED = { ...process.env };

beforeEach(() => {
  process.env.CHILD_TEST_ENABLED = 'true';
  delete process.env.CHILD_TEST_REGIONS;
  delete process.env.DEFAULT_REGION;
});
afterAll(() => { process.env = SAVED; });

describe('flag off → inert', () => {
  test.each(['/egra', '/childtest', 'بچوں کا ٹیسٹ'])('%s does not match when CHILD_TEST_ENABLED is unset', (cmd) => {
    delete process.env.CHILD_TEST_ENABLED;
    expect(evaluateChildTestTrigger({ messageBody: cmd, user: COACH })).toEqual({ match: false });
    expect(isChildTestAvailable(COACH)).toBe(false);
  });
  test('CHILD_TEST_ENABLED=false is off too', () => {
    process.env.CHILD_TEST_ENABLED = 'false';
    expect(evaluateChildTestTrigger({ messageBody: '/egra', user: COACH })).toEqual({ match: false });
  });
});

describe('flag on', () => {
  test.each(['/egra', '/EGRA', '/childtest', 'بچوں کا ٹیسٹ'])('%s starts for a coach in ICT', (cmd) => {
    expect(evaluateChildTestTrigger({ messageBody: cmd, user: COACH })).toEqual({ match: true, action: 'start', arg: null });
  });
  test('/egra <emis> carries the argument', () => {
    expect(evaluateChildTestTrigger({ messageBody: '/egra 12345', user: COACH })).toEqual({ match: true, action: 'start', arg: '12345' });
  });
  test('a teacher is refused, not silently ignored', () => {
    expect(evaluateChildTestTrigger({ messageBody: '/egra', user: TEACHER })).toMatchObject({ match: true, action: 'deny_role' });
    expect(isChildTestAvailable(TEACHER)).toBe(false);
  });
  test('no user → deny_no_user', () => {
    expect(evaluateChildTestTrigger({ messageBody: '/egra', user: null })).toMatchObject({ match: true, action: 'deny_no_user' });
  });
  test('outside ICT → inert', () => {
    expect(evaluateChildTestTrigger({ messageBody: '/egra', user: { ...COACH, region: 'tanzania' } })).toEqual({ match: false });
  });
  test('the deployment region niete-sandbox counts as ICT when users.region is empty', () => {
    process.env.DEFAULT_REGION = 'niete-sandbox';
    expect(isChildTestAvailable({ id: 'c2', role: 'principal' })).toBe(true);
  });
  test('words that merely start with the command do not match', () => {
    expect(evaluateChildTestTrigger({ messageBody: '/egrateful', user: COACH })).toEqual({ match: false });
    expect(evaluateChildTestTrigger({ messageBody: 'egra', user: COACH })).toEqual({ match: false });
  });
});

describe('pilot allow-list (CHILD_TEST_COACH_IDS)', () => {
  afterEach(() => { delete process.env.CHILD_TEST_COACH_IDS; });
  test('unset → every ICT coach passes, as before', () => {
    delete process.env.CHILD_TEST_COACH_IDS;
    expect(isChildTestAvailable(COACH)).toBe(true);
  });
  test('set → a coach on the list starts', () => {
    process.env.CHILD_TEST_COACH_IDS = 'x9, c1 ,y8';
    expect(evaluateChildTestTrigger({ messageBody: '/egra', user: COACH })).toEqual({ match: true, action: 'start', arg: null });
    expect(isChildTestAvailable(COACH)).toBe(true);
  });
  test('set → a coach not on the list sees nothing: inert, exactly as if the feature were off', () => {
    process.env.CHILD_TEST_COACH_IDS = 'x9,y8';
    expect(evaluateChildTestTrigger({ messageBody: '/egra', user: COACH })).toEqual({ match: false });
    expect(isChildTestAvailable(COACH)).toBe(false);
  });
});
