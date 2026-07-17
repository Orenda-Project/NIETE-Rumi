/**
 * coach-role-label — region-scoped display label for the observer identity
 * surfaced to the teacher (coaching card footer, LP selection list footer,
 * observation report observerName).
 *
 * Contract:
 *   1. Unknown / empty region + no env → "Rumi Digital Coach" (safe default).
 *   2. DEFAULT_COACH_ROLE_LABEL env overrides the deployment-wide default.
 *   3. REGION_COACH_ROLE_LABEL_MAP JSON env overrides per region (lowercased key).
 *   4. Malformed JSON in REGION_COACH_ROLE_LABEL_MAP → fall through to default.
 *   5. Downstream consumers (coaching-card copy) surface the label without
 *      mutating the seed COACHING_CARD_COPY (byte-safe fallback preserved).
 */

const ENV_KEYS = ['DEFAULT_COACH_ROLE_LABEL', 'REGION_COACH_ROLE_LABEL_MAP'];

function withEnv(envPatch, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(envPatch || {})) process.env[k] = v;
  jest.resetModules();
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.resetModules();
  }
}

describe('coachRoleLabelForRegion (region-config)', () => {
  test('safe default when nothing is configured and region is empty', () => {
    withEnv({}, () => {
      const { coachRoleLabelForRegion } = require('../../bot/shared/config/region-config');
      expect(coachRoleLabelForRegion()).toBe('Rumi Digital Coach');
      expect(coachRoleLabelForRegion('')).toBe('Rumi Digital Coach');
      expect(coachRoleLabelForRegion(undefined)).toBe('Rumi Digital Coach');
    });
  });

  test('DEFAULT_COACH_ROLE_LABEL is used for any region without a map entry', () => {
    withEnv({ DEFAULT_COACH_ROLE_LABEL: 'Human Coach' }, () => {
      const { coachRoleLabelForRegion } = require('../../bot/shared/config/region-config');
      expect(coachRoleLabelForRegion('niete')).toBe('Human Coach');
      expect(coachRoleLabelForRegion('anywhere-else')).toBe('Human Coach');
    });
  });

  test('REGION_COACH_ROLE_LABEL_MAP overrides per region (case-insensitive)', () => {
    withEnv({
      DEFAULT_COACH_ROLE_LABEL: 'Rumi Digital Coach',
      REGION_COACH_ROLE_LABEL_MAP: '{"niete":"Human Coach","tanzania":"Rumi"}',
    }, () => {
      const { coachRoleLabelForRegion } = require('../../bot/shared/config/region-config');
      expect(coachRoleLabelForRegion('niete')).toBe('Human Coach');
      expect(coachRoleLabelForRegion('NIETE')).toBe('Human Coach');
      expect(coachRoleLabelForRegion('tanzania')).toBe('Rumi');
      expect(coachRoleLabelForRegion('other-region')).toBe('Rumi Digital Coach');
    });
  });

  test('malformed REGION_COACH_ROLE_LABEL_MAP JSON falls through to default', () => {
    withEnv({
      DEFAULT_COACH_ROLE_LABEL: 'Human Coach',
      REGION_COACH_ROLE_LABEL_MAP: '{not-valid-json',
    }, () => {
      const { coachRoleLabelForRegion } = require('../../bot/shared/config/region-config');
      expect(coachRoleLabelForRegion('niete')).toBe('Human Coach');
    });
  });

  test('empty-string label in map is ignored (falls through to default)', () => {
    withEnv({
      DEFAULT_COACH_ROLE_LABEL: 'Rumi Digital Coach',
      REGION_COACH_ROLE_LABEL_MAP: '{"niete":"   "}',
    }, () => {
      const { coachRoleLabelForRegion } = require('../../bot/shared/config/region-config');
      expect(coachRoleLabelForRegion('niete')).toBe('Rumi Digital Coach');
    });
  });
});

describe('getCoachingCardCopy (region-scoped cardFooter)', () => {
  test('cardFooter defaults to "Rumi Digital Coach" when no region and no env', () => {
    withEnv({}, () => {
      const { getCoachingCardCopy, COACHING_CARD_COPY } = require('../../bot/shared/config/coaching-card.config');
      const copy = getCoachingCardCopy('en');
      expect(copy.cardFooter).toBe('Rumi Digital Coach');
      // Seed copy is not mutated — the returned copy is a shallow clone.
      expect(COACHING_CARD_COPY.en.cardFooter).toBe('Rumi Digital Coach');
    });
  });

  test('cardFooter becomes "Human Coach" when DEFAULT_COACH_ROLE_LABEL is set', () => {
    withEnv({ DEFAULT_COACH_ROLE_LABEL: 'Human Coach' }, () => {
      const { getCoachingCardCopy, COACHING_CARD_COPY } = require('../../bot/shared/config/coaching-card.config');
      expect(getCoachingCardCopy('en').cardFooter).toBe('Human Coach');
      expect(getCoachingCardCopy('ur').cardFooter).toBe('Human Coach');
      // Seed unchanged.
      expect(COACHING_CARD_COPY.en.cardFooter).toBe('Rumi Digital Coach');
    });
  });

  test('cardFooter follows REGION_COACH_ROLE_LABEL_MAP per region', () => {
    withEnv({
      REGION_COACH_ROLE_LABEL_MAP: '{"niete":"Human Coach"}',
    }, () => {
      const { getCoachingCardCopy } = require('../../bot/shared/config/coaching-card.config');
      expect(getCoachingCardCopy('en', 'niete').cardFooter).toBe('Human Coach');
      expect(getCoachingCardCopy('en', 'tanzania').cardFooter).toBe('Rumi Digital Coach');
    });
  });

  test('non-footer copy stays byte-identical to the seed', () => {
    withEnv({ DEFAULT_COACH_ROLE_LABEL: 'Human Coach' }, () => {
      const { getCoachingCardCopy, COACHING_CARD_COPY } = require('../../bot/shared/config/coaching-card.config');
      const copy = getCoachingCardCopy('en');
      expect(copy.cardHeader).toBe(COACHING_CARD_COPY.en.cardHeader);
      expect(copy.commitPrompt).toBe(COACHING_CARD_COPY.en.commitPrompt);
      expect(copy.commitButtons).toEqual(COACHING_CARD_COPY.en.commitButtons);
    });
  });
});
