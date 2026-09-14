/**
 * A session scored on a vocabulary the framework does not list must still show
 * its real domains.
 *
 * The FICO adapter iterates the FRAMEWORK's four canonical keys
 * (lesson_plan_fidelity, high_leverage_practices, student_engagement,
 * teacher_subject_knowledge) and reads each out of the session. That is right
 * for the report image, which is a fixed four-row scorecard.
 *
 * But 17 of 172 completed sessions on the sandbox corpus (10%) were scored on
 * a FIVE-domain vocabulary — classroom_climate, lesson_structure,
 * instructional_quality, assessment_feedback, student_engagement. For those,
 * the adapter matches one key and reports the other three canonical ones as
 * 0/0, while the session's own three real domains vanish entirely.
 *
 * Same shape as the OECD defect this whole change exists to fix: a reader
 * asking for keys the data does not have, and rendering zeros rather than
 * saying so. Caught by seeding a teacher's account with a deliberately mixed
 * set and reading the detail page back.
 *
 * Fixed HERE rather than in the adapter, because the adapter is shared with
 * the WhatsApp report renderer, whose fixed four-row layout is correct for it.
 */

const { buildBreakdown } = require('../../bot/shared/services/coaching/coaching-breakdown.service');

/** The five-domain shape, as it appears on production rows. */
const FIVE_DOMAIN = {
  framework: 'fico',
  scores: { overall_marks: 73, overall_max_marks: 84, overall_percentage: 86.9 },
  domains: {
    lesson_structure:      { domain_score: 16, domain_max: 18, indicators: [{ id: 'L1', name: 'Opening', score: 3, evidence: 'Clear objective stated.' }] },
    classroom_climate:     { domain_score: 17, domain_max: 18, indicators: [{ id: 'K1', name: 'Respect', score: 4, evidence: 'Warm tone throughout.' }] },
    student_engagement:    { domain_score: 13, domain_max: 16, indicators: [{ id: 'D1', name: 'Participation', score: 3, evidence: 'Most students answer.' }] },
    assessment_feedback:   { domain_score: 14, domain_max: 16, indicators: [{ id: 'A1', name: 'Checks', score: 3, evidence: 'Circulates and checks.' }] },
    instructional_quality: { domain_score: 13, domain_max: 16, indicators: [{ id: 'I1', name: 'Explanation', score: 3, evidence: 'Worked example given.' }] },
  },
};

/** The canonical four, which must keep behaving exactly as before. */
const FOUR_DOMAIN = {
  framework: 'fico',
  scores: { overall_marks: 106, overall_max_marks: 148, overall_percentage: 71.6 },
  domains: {
    student_engagement:        { domain_score: 20, domain_max: 28, indicators: [{ id: 'D1', name: 'Participation', score: 3, evidence: 'Quote.' }] },
    lesson_plan_fidelity:      { domain_score: 29, domain_max: 40, indicators: [] },
    high_leverage_practices:   { domain_score: 37, domain_max: 56, indicators: [] },
    teacher_subject_knowledge: { domain_score: 20, domain_max: 24, indicators: [] },
  },
};

describe('a five-domain session shows its five domains', () => {
  const b = buildBreakdown(FIVE_DOMAIN, 'en');

  test('every domain the session was scored on is present', () => {
    expect(b.groups.map((g) => g.domainKey).sort()).toEqual(
      Object.keys(FIVE_DOMAIN.domains).sort(),
    );
  });

  test('no domain is reported as 0 out of 0', () => {
    b.groups.forEach((g) => {
      expect(g.max).toBeGreaterThan(0);
    });
  });

  test('the domain maxima add up to the session max', () => {
    expect(b.groups.reduce((t, g) => t + g.max, 0)).toBe(84);
    expect(b.groups.reduce((t, g) => t + g.score, 0)).toBe(73);
  });

  test('an unlisted domain still gets a readable name', () => {
    const lc = b.groups.find((g) => g.domainKey === 'classroom_climate');
    expect(lc.name).toBe('Classroom Climate');
  });

  test('its indicators and evidence come through', () => {
    const lc = b.groups.find((g) => g.domainKey === 'classroom_climate');
    expect(lc.indicators).toHaveLength(1);
    expect(lc.indicators[0].evidence).toBe('Warm tone throughout.');
  });
});

describe('the headline agrees with the domains actually shown', () => {
  // The adapter derives `overall` from ITS OWN groups when the session carries
  // no overall_percentage — and for a five-domain session those groups are the
  // four canonical ones (13/58 here), not the five real ones (73/84). So the
  // headline read 22% above bars averaging 87%.
  //
  // buildBreakdown replaces the groups, so it must recompute the headline from
  // the groups it is actually returning.
  const noPct = {
    ...FIVE_DOMAIN,
    scores: { overall_marks: 73, overall_max_marks: 84 },   // no percentage
  };

  test('overall is derived from the domains being rendered', () => {
    const b = buildBreakdown(noPct, 'en');
    const sum = b.groups.reduce((t, g) => t + g.score, 0);
    const max = b.groups.reduce((t, g) => t + g.max, 0);
    expect(b.overall).toBe(Math.round((sum / max) * 100));   // 87, not 22
  });

  test('a stored percentage still wins over any derivation', () => {
    // The flat field is the bot's own recorded figure and stays the source of
    // truth when it is present.
    expect(buildBreakdown(FIVE_DOMAIN, 'en').overall).toBe(87);
  });
});

describe('the canonical four are unchanged', () => {
  const b = buildBreakdown(FOUR_DOMAIN, 'en');

  test('all four are present, strongest first', () => {
    expect(b.groups).toHaveLength(4);
    const pcts = b.groups.map((g) => g.pct);
    expect([...pcts].sort((x, y) => y - x)).toEqual(pcts);
  });

  test('the framework section letters are kept', () => {
    // Trainers cross-reference the printed rubric by letter; an unlisted
    // domain has no letter, but a listed one must not lose its own.
    expect(b.groups.map((g) => g.key).sort()).toEqual(['B', 'C', 'D', 'F']);
  });
});
