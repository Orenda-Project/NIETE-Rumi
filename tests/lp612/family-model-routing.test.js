/**
 * bd-u6za9 — per-family author-model routing + the flash-tier harness.
 *
 * WHAT THE BAKE-OFF ACTUALLY FOUND (BAKEOFF_ROUND3.md, 2026-09-03)
 *
 * `deepseek/deepseek-v4-flash` authored a Grade 9 physics lesson LINT-CLEAN on
 * the first pass, no revision ladder, in 59.9 s for $0.0036. Across rounds 1-2c
 * (51 documents) nothing had ever reached clean, and in round 3 `claude-sonnet-5`
 * produced no clean cell and the WORST mean defect rate (11.6/doc vs dsflash 5.4).
 * dsflash is ~50x cheaper.
 *
 * But one clean cell is an existence proof, not a rate: dsflash is 1/5 clean
 * overall and its latency is volatile. So the operator's decision is a PILOT, not
 * a flip — maths/physics author on dsflash, everything else stays on sonnet.
 *
 * WHY THE SPLIT IS BY SUBJECT FAMILY
 *
 * Round 2c ran the natural experiment: ONE global maths preamble cut maths
 * defects 31% and made Urdu prose 73% WORSE. The census over 51 documents shows
 * why — MATH_LEAK is 107 occurrences in maths, 1 in science, 0 in prose, while
 * RELIGIOUS_MARKS and DISTRACTOR_VISIBLE occur ONLY in prose. A single global
 * rule set spends its attention on rules that are irrelevant to two families out
 * of three. Conditioning the brief on the family moved maths from 11.8 to 5.6
 * blocking defects per document.
 *
 * The mapping is PORTED from the upstream harness (`author_lp.py`
 * `_FAMILY_KEYS` / `family_for_book()`), not invented here, so the serving lane
 * and the bake-off classify a book the same way. If they diverged, every future
 * bake-off number would describe a harness we do not actually run.
 *
 * `sci` IS THE FALLBACK ON PURPOSE. It is the widest variant — common core plus
 * light diagram/equation guidance — so an unrecognised book gets the shared
 * rules and no subject block that could mislead it. Falling back to `maths`
 * would reintroduce exactly the round-2c harm on any book we failed to classify.
 *
 * REVERTIBILITY IS A REQUIREMENT, NOT A NICETY. The pilot must be undoable
 * without a deploy: unset LP_AUTHOR_MODEL_MATHS_PHYSICS and every family goes
 * back to LP_AUTHOR_MODEL. That is asserted below.
 */

const path = require('path');

const FAMILIES_PATH = path.resolve(__dirname, '../../bot/shared/config/lp612-families.js');
const FLAGS_PATH = path.resolve(__dirname, '../../bot/shared/config/lp612-flags.js');

function loadFlags(env = {}) {
  jest.resetModules();
  for (const k of [
    'LP_AUTHOR_MODEL',
    'LP_AUTHOR_MODEL_MATHS_PHYSICS',
    'LP612_AUTHOR_TIER',
  ]) delete process.env[k];
  Object.assign(process.env, env);
  // eslint-disable-next-line global-require
  return require(FLAGS_PATH);
}

describe('bd-u6za9 — subject-family classification (ported from the bake-off harness)', () => {
  // eslint-disable-next-line global-require
  const { familyForBook, FAMILIES } = require(FAMILIES_PATH);

  test('the three families are exactly the upstream set', () => {
    expect([...FAMILIES].sort()).toEqual(['maths', 'prose', 'sci']);
  });

  // These cases mirror upstream's own test (test_lp_author.py:1286-1297) so a
  // divergence between the harness and the serving lane fails here, loudly.
  test('maths family = mathematics AND physics — this is the dsflash pilot cohort', () => {
    expect(familyForBook('grade_10_mathematics')).toBe('maths');
    expect(familyForBook('grade_9_physics')).toBe('maths');
    expect(familyForBook('grade_8_math')).toBe('maths');
  });

  test('sci family = biology, chemistry, general science, computer science', () => {
    expect(familyForBook('grade_9_biology')).toBe('sci');
    expect(familyForBook('grade_11_chemistry')).toBe('sci');
    expect(familyForBook('grade_7_general_science')).toBe('sci');
    expect(familyForBook('grade_11_computer_science')).toBe('sci');
  });

  test('prose family = urdu, english, islamiat, pakistan studies', () => {
    expect(familyForBook('grade_10_urdu')).toBe('prose');
    expect(familyForBook('grade_8_english')).toBe('prose');
    expect(familyForBook('grade_9_islamiat')).toBe('prose');
    expect(familyForBook('grade_10_pak_studies_urdu')).toBe('prose');
  });

  test('an unclassified book falls back to sci, NEVER to maths', () => {
    // Falling back to maths would put the maths preamble in front of a prose
    // book, which round 2c measured as a 73% defect increase.
    expect(familyForBook('grade_5_unknown_subject')).toBe('sci');
    expect(familyForBook('')).toBe('sci');
    expect(familyForBook(null)).toBe('sci');
    expect(familyForBook(undefined)).toBe('sci');
  });

  test('classification is case-insensitive and matches on a substring of the book stem', () => {
    expect(familyForBook('GRADE_9_PHYSICS')).toBe('maths');
    expect(familyForBook('grade_9_10_chemistry_experiment')).toBe('sci');
  });

  test('prose wins over sci when a stem could match both — the order is load-bearing', () => {
    // 'pakistan_studies' contains neither a sci nor a maths key, but a book like
    // 'computer_studies_urdu' must not be pulled into sci by 'computer' when the
    // upstream order puts prose first. Locking the precedence prevents a silent
    // reclassification if someone reorders the table.
    expect(familyForBook('grade_9_computer_studies_urdu')).toBe('prose');
  });
});

describe('bd-u6za9 — per-family model resolution', () => {
  const SONNET = 'anthropic/claude-sonnet-5';
  const DSFLASH = 'deepseek/deepseek-v4-flash';

  test('with the pilot var set, ONLY the maths family gets dsflash', () => {
    const flags = loadFlags({
      LP_AUTHOR_MODEL: SONNET,
      LP_AUTHOR_MODEL_MATHS_PHYSICS: DSFLASH,
    });

    expect(flags.resolveAuthorModel('maths')).toBe(DSFLASH);
    expect(flags.resolveAuthorModel('sci')).toBe(SONNET);
    expect(flags.resolveAuthorModel('prose')).toBe(SONNET);
  });

  test('UNSETTING the pilot var reverts every family to the default — the no-deploy rollback', () => {
    const flags = loadFlags({ LP_AUTHOR_MODEL: SONNET });

    expect(flags.resolveAuthorModel('maths')).toBe(SONNET);
    expect(flags.resolveAuthorModel('sci')).toBe(SONNET);
    expect(flags.resolveAuthorModel('prose')).toBe(SONNET);
  });

  test('resolveAuthorModel() with no family is unchanged — existing callers keep working', () => {
    const flags = loadFlags({
      LP_AUTHOR_MODEL: SONNET,
      LP_AUTHOR_MODEL_MATHS_PHYSICS: DSFLASH,
    });

    // Back-compat: an unknown/absent family must never silently pick the pilot model.
    expect(flags.resolveAuthorModel()).toBe(SONNET);
    expect(flags.resolveAuthorModel('nonsense')).toBe(SONNET);
  });

  test('with nothing set at all the default is still sonnet — no hardcoded pilot model anywhere', () => {
    const flags = loadFlags({});
    expect(flags.resolveAuthorModel('maths')).toBe('anthropic/claude-sonnet-5');
  });

  test('a blank pilot var is treated as unset, not as an empty model id', () => {
    const flags = loadFlags({
      LP_AUTHOR_MODEL: SONNET,
      LP_AUTHOR_MODEL_MATHS_PHYSICS: '   ',
    });
    expect(flags.resolveAuthorModel('maths')).toBe(SONNET);
  });
});

describe('bd-u6za9 — brief tier follows the MODEL, not the family', () => {
  const SONNET = 'anthropic/claude-sonnet-5';
  const DSFLASH = 'deepseek/deepseek-v4-flash';

  test('a flash model gets the flash tier; sonnet gets the standard tier', () => {
    const flags = loadFlags({});
    // The flash-tier harness (stronger preamble + mechanical repairs) was built
    // and measured FOR the flash models. Sending sonnet through it would change
    // the production path that is currently serving, which this pilot must not do.
    expect(flags.authorTierFor(DSFLASH)).toBe('flash');
    expect(flags.authorTierFor(SONNET)).toBe('standard');
  });

  test('the tier can be pinned by env for an A/B, and an unknown value does not silently become standard', () => {
    expect(loadFlags({ LP612_AUTHOR_TIER: 'flash' }).authorTierFor(SONNET)).toBe('flash');
    expect(loadFlags({ LP612_AUTHOR_TIER: 'standard' }).authorTierFor(DSFLASH)).toBe('standard');
    // A typo'd tier must raise rather than quietly author on the wrong harness and
    // be scored as the other one — the mislabelling that made bake-off run 1 unreadable.
    expect(() => loadFlags({ LP612_AUTHOR_TIER: 'flsh' }).authorTierFor(DSFLASH)).toThrow(/tier/i);
  });
});

describe('bd-u6za9 — the vendored flash briefs exist and carry the v3 canon', () => {
  const fs = require('fs');
  const VENDOR = path.resolve(__dirname, '../../bot/vendor/lp-v9');

  test.each(['maths', 'sci', 'prose'])(
    'brief_author_v3_flash_%s.md is vendored and non-trivial',
    (family) => {
      const p = path.join(VENDOR, `brief_author_v3_flash_${family}.md`);
      expect(fs.existsSync(p)).toBe(true);
      // Each family brief carries the whole v3 brief verbatim plus its own
      // preamble, so it is necessarily larger than v3 itself.
      const flash = fs.statSync(p).size;
      const v3 = fs.statSync(path.join(VENDOR, 'brief_author_v3.md')).size;
      expect(flash).toBeGreaterThan(v3);
    }
  );

  test('every family in FAMILIES has a vendored brief — a new family cannot ship without one', () => {
    // eslint-disable-next-line global-require
    const { FAMILIES } = require(FAMILIES_PATH);
    for (const f of FAMILIES) {
      expect(fs.existsSync(path.join(VENDOR, `brief_author_v3_flash_${f}.md`))).toBe(true);
    }
  });
});
