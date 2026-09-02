/**
 * The two flags, and the one that must not be reachable from the other.
 *
 * LP_612_ENABLED gates the feature. LP_612_RELIGIOUS_ENABLED gates Islamiat and
 * seerah content, and it is a SEPARATE flag on the operator's instruction: the
 * hold on religious content is pending a native-speaker review, and turning the
 * feature on for the other 55 books must not lift it. The test that matters
 * here is the one that proves the second flag stays off when only the first is
 * on -- an accidental `||` between them is exactly the bug this catches.
 */

const FLAG = 'LP_612_ENABLED';
const RELIGIOUS = 'LP_612_RELIGIOUS_ENABLED';

let saved;
beforeEach(() => {
  saved = { ...process.env };
  jest.resetModules();
});
afterEach(() => {
  process.env = saved;
});

function load() {
  return require('../../bot/shared/config/lp612-flags');
}

describe('LP 6-12 feature flags', () => {
  test('the feature is OFF when the flag is unset — merged code is inert', () => {
    delete process.env[FLAG];
    expect(load().isLp612Enabled()).toBe(false);
  });

  test.each(['false', 'FALSE', '0', '', 'yes', 'True'])(
    'the feature stays OFF for %p — only the exact string "true" enables it',
    (value) => {
      process.env[FLAG] = value;
      expect(load().isLp612Enabled()).toBe(false);
    },
  );

  test('the feature is ON only for the exact string "true"', () => {
    process.env[FLAG] = 'true';
    expect(load().isLp612Enabled()).toBe(true);
  });

  test('religious content is held even when the feature flag is on', () => {
    process.env[FLAG] = 'true';
    delete process.env[RELIGIOUS];
    const flags = load();
    expect(flags.isLp612Enabled()).toBe(true);
    expect(flags.isReligiousEnabled()).toBe(false);
  });

  test('religious content is released only by its own flag', () => {
    process.env[FLAG] = 'true';
    process.env[RELIGIOUS] = 'true';
    expect(load().isReligiousEnabled()).toBe(true);
  });

  test('the religious flag alone does not enable the feature', () => {
    delete process.env[FLAG];
    process.env[RELIGIOUS] = 'true';
    expect(load().isLp612Enabled()).toBe(false);
  });
});

describe('serving constants', () => {
  test('template version defaults to v9.1 and is env-overridable', () => {
    delete process.env.LP_612_TEMPLATE_VERSION;
    expect(load().templateVersion()).toBe('v9.1');
    jest.resetModules();
    process.env.LP_612_TEMPLATE_VERSION = 'v9.2';
    expect(load().templateVersion()).toBe('v9.2');
  });

  test('the author model defaults to sonnet-5 and flips by env alone', () => {
    delete process.env.LP_AUTHOR_MODEL;
    expect(load().resolveAuthorModel()).toBe('anthropic/claude-sonnet-5');
    jest.resetModules();
    process.env.LP_AUTHOR_MODEL = 'deepseek/deepseek-v4-flash';
    expect(load().resolveAuthorModel()).toBe('deepseek/deepseek-v4-flash');
  });

  test('grade range is 6-12', () => {
    const { LP612_MIN_GRADE, LP612_MAX_GRADE, isLp612Grade } = load();
    expect([LP612_MIN_GRADE, LP612_MAX_GRADE]).toEqual([6, 12]);
    expect(isLp612Grade(5)).toBe(false);
    expect(isLp612Grade(6)).toBe(true);
    expect(isLp612Grade(12)).toBe(true);
    expect(isLp612Grade(13)).toBe(false);
    expect(isLp612Grade('9')).toBe(true);
  });
});
