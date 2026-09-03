/**
 * The flags and constants for runtime 6-12 lesson plans.
 *
 * Two flags, deliberately not one.
 *
 *   LP_612_ENABLED            gates the feature. Merged code is INERT until this
 *                             flips, which is the condition this lane shipped
 *                             under: the menu does not grow a row, the endpoint
 *                             keeps routing 6-10 to Oxbridge exactly as it does
 *                             today, and no authoring job can be enqueued.
 *
 *   LP_612_RELIGIOUS_ENABLED  gates Islamiat books and seerah content, and is
 *                             SEPARATE on the operator's instruction: that hold
 *                             is pending a native-speaker review and turning the
 *                             feature on for the other books must not lift it.
 *                             There is deliberately no `||` between these two
 *                             anywhere in the codebase.
 *
 * Both use the repo's explicit-boolean convention (`=== 'true'`), not the
 * presence convention, for the reason `bot/shared/calls/calls-config.js` gives:
 * a rolled-back env that still holds `LP_612_ENABLED=false` must stay OFF, and a
 * presence gate would read that as on.
 */

const LP612_MIN_GRADE = 6;
const LP612_MAX_GRADE = 12;

/** The template the renderer is on. Part of the R2 cache key, so bumping it
 *  misses every cached render rather than serving stale layouts — and rolling
 *  back re-serves the old ones instantly, because nothing was deleted. */
const DEFAULT_TEMPLATE_VERSION = 'v9.1';

/** The operator has not locked the serving model. The flip must be an env
 *  change with no deploy, so nothing anywhere may hardcode a model id. */
const DEFAULT_AUTHOR_MODEL = 'anthropic/claude-sonnet-5';

/** Revision rounds on the author ladder before we serve what we have. */
const DEFAULT_AUTHOR_ROUNDS = 3;

/** How long a first hit may run before the worker gives up and apologises.
 *  The measured worst case with a full ladder is ~10 min; this is the hard
 *  stop, not the expectation. */
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;

/** When a first hit passes this, she gets a second message rather than
 *  silence. Set below the 2-3 min typical so it only fires on the slow tail. */
const DEFAULT_FOLLOWUP_MS = 3 * 60 * 1000;

const isTrue = (v) => String(v).trim() === 'true';
const num = (v, fallback) => {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function isLp612Enabled() {
  return isTrue(process.env.LP_612_ENABLED);
}

/** The 6-12 language step — «اردو / English» as the final tap before serving.
 *
 *  A flag and not a versioned step name, because the items and payloads are
 *  server data — an OLD published Flow happily renders new rows and echoes new
 *  step names. The only thing that breaks in the deploy-before-republish window
 *  is returning a SCREEN ID the published asset does not define, so this flag
 *  is the "served" switch: deploy with it off (inert) → republish Flow v3.1
 *  (SELECT_LANGUAGE valid-but-unreturned, harmless) → verify published on the
 *  WABA → flip. Rollback is the flag, with no deploy and no republish.
 *
 *  Never consulted on its own — every path through it already sits behind
 *  isLp612Enabled() via lp612Guard; this only ever narrows. */
function isLp612LangMenuEnabled() {
  return isTrue(process.env.LP_612_LANG_MENU);
}

/** Islamiat + seerah. Never consulted on its own — the caller must already have
 *  passed isLp612Enabled(); this only ever narrows. */
function isReligiousEnabled() {
  return isTrue(process.env.LP_612_RELIGIOUS_ENABLED);
}

function templateVersion() {
  const v = (process.env.LP_612_TEMPLATE_VERSION || '').trim();
  return v || DEFAULT_TEMPLATE_VERSION;
}

/**
 * The author model, optionally per subject family (bd-u6za9).
 *
 * THE PILOT. The 2026-09-03 bake-off found `deepseek/deepseek-v4-flash` authoring
 * a Grade 9 physics lesson LINT-CLEAN on the first pass — no revision ladder — in
 * 59.9 s for $0.0036, while `claude-sonnet-5` produced no clean cell in the round
 * and had the worst mean defect rate. dsflash is ~50x cheaper. But one clean cell
 * is an existence proof, not a rate (dsflash is 1/5 clean overall, with volatile
 * latency), so the operator's decision is a PILOT on the family where it already
 * wins — maths and physics — with everything else staying on sonnet.
 *
 * REVERT IS AN ENV CHANGE, NOT A DEPLOY. Unset LP_AUTHOR_MODEL_MATHS_PHYSICS and
 * every family falls back to LP_AUTHOR_MODEL. Nothing anywhere hardcodes a pilot
 * model, and an absent or unknown family never silently selects one.
 *
 * @param {'maths'|'sci'|'prose'} [family]
 */
function resolveAuthorModel(family) {
  if (family === 'maths') {
    const pilot = (process.env.LP_AUTHOR_MODEL_MATHS_PHYSICS || '').trim();
    if (pilot) return pilot;
  }
  const m = (process.env.LP_AUTHOR_MODEL || '').trim();
  return m || DEFAULT_AUTHOR_MODEL;
}

/** The two author harnesses. `standard` is the v3 brief with no repair pass. */
const AUTHOR_TIERS = Object.freeze(['standard', 'flash']);

/**
 * Which brief harness a model runs on.
 *
 * The tier follows the MODEL, not the family. The flash-tier harness — the
 * stronger family preamble plus the mechanical repairs — was built and measured
 * for the flash models; putting sonnet through it would change the production
 * path that is currently serving teachers, which this pilot must not do.
 *
 * `LP612_AUTHOR_TIER` pins the tier for an A/B. An unknown value RAISES rather
 * than falling back to standard: a typo'd tier that silently authored on the
 * other harness would be scored as this one, which is the mislabelling that made
 * the first bake-off run unreadable.
 */
function authorTierFor(model) {
  const pinned = (process.env.LP612_AUTHOR_TIER || '').trim();
  if (pinned) {
    if (!AUTHOR_TIERS.includes(pinned)) {
      throw new Error(
        `LP612_AUTHOR_TIER must be one of ${AUTHOR_TIERS.join(', ')} (got "${pinned}")`
      );
    }
    return pinned;
  }
  return /flash/i.test(String(model || '')) ? 'flash' : 'standard';
}

function authorRounds() {
  return num(process.env.LP612_AUTHOR_ROUNDS, DEFAULT_AUTHOR_ROUNDS);
}

function authorTimeoutMs() {
  return num(process.env.LP612_AUTHOR_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

function followupAfterMs() {
  return num(process.env.LP612_FOLLOWUP_MS, DEFAULT_FOLLOWUP_MS);
}

function isLp612Grade(g) {
  const n = parseInt(String(g), 10);
  return Number.isFinite(n) && n >= LP612_MIN_GRADE && n <= LP612_MAX_GRADE;
}

module.exports = {
  isLp612Enabled,
  isLp612LangMenuEnabled,
  isReligiousEnabled,
  templateVersion,
  resolveAuthorModel,
  authorTierFor,
  AUTHOR_TIERS,
  authorRounds,
  authorTimeoutMs,
  followupAfterMs,
  isLp612Grade,
  LP612_MIN_GRADE,
  LP612_MAX_GRADE,
  DEFAULT_TEMPLATE_VERSION,
  DEFAULT_AUTHOR_MODEL,
};
