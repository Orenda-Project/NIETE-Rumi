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
const DEFAULT_TEMPLATE_VERSION = 'v9.2';

/**
 * THE VERSIONS WHOSE STORED DOCUMENTS TODAY'S RENDERER IS KNOWN TO ACCEPT — newest first.
 *
 * This is the ONLY such list. A version bump misses every cached render (the version leads the R2
 * key), and a miss used to mean the LLM writes the lesson again — minutes and dollars for a
 * document we already have, because the worker stores the exact `lp_doc` that made each PDF as
 * `lp612/{tv}/{lang}/{segment}.lp.json` beside it. `previousTemplateVersions` walks this list so a
 * bump becomes a RE-RENDER.
 *
 * SO: A SCHEMA-BREAKING TEMPLATE CHANGE MUST DROP THE OLDER ENTRIES IN THE SAME COMMIT.
 * Leaving a version here whose stored documents this renderer can no longer read does not fall
 * back to authoring — it re-renders a document that no longer validates into a BROKEN lesson, and
 * delivers it. That is strictly worse than the spend this list exists to avoid.
 */
const TEMPLATE_VERSION_LINEAGE = Object.freeze(['v9.2', 'v9.1']);

/**
 * Which older template versions' stored documents may be re-rendered for `tv`, newest first.
 *
 * `LP_612_TEMPLATE_FALLBACK` overrides the lineage EXACTLY — a comma list, trimmed, empties
 * dropped, with `tv` itself removed so a typo cannot make a version its own ancestor. Setting it
 * EMPTY (`LP_612_TEMPLATE_FALLBACK=`) is therefore the explicit OFF switch: reuse stops with one
 * Railway variable and no deploy, which is what a template change that turns out to break older
 * documents needs on a path a teacher is waiting on.
 *
 * An unknown `tv` with no override claims no ancestry rather than guessing one.
 */
function previousTemplateVersions(tv) {
  const cur = String(tv == null ? '' : tv).trim();
  const override = process.env.LP_612_TEMPLATE_FALLBACK;
  if (override !== undefined) {
    return String(override)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== cur);
  }
  const i = TEMPLATE_VERSION_LINEAGE.indexOf(cur);
  return i < 0 ? [] : TEMPLATE_VERSION_LINEAGE.slice(i + 1);
}

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

/**
 * The teacher edit lane. A THIRD flag, and separate for the same reason the religious hold is
 * separate: turning 6-12 lessons on must not silently turn on a path that spends ~$0.36 and
 * rewrites a document every time a teacher replies to one.
 *
 * It only ever NARROWS isLp612Enabled() — a caller must already have passed that gate. With this
 * unset the router still recognises an edit request and says so honestly (lp612EditNotYet); what
 * it does not do is author anything.
 */
function isLp612EditEnabled() {
  return isTrue(process.env.LP_612_EDIT_ENABLED);
}

/**
 * TARGETED REVISION — bd-ga7xz. Ask a revision round for only the changed sections instead of
 * the whole ~7,900-token lp_doc every time (BREAKDOWN.md §4 lever 2: 65-104s/lesson).
 *
 * Default FALSE, same convention as the flags above. It only ever narrows the AUTHORING ladder
 * (`authorLessonPlan`'s revision rounds) — the teacher-EDIT lane (`reviseLessonPlan`) stays on
 * the full-rewrite path regardless of this flag; it is a different product surface with a
 * different round budget and was deliberately left out of this lane's first cut.
 *
 * `authorLessonPlan({ targetedRevision })` can override this per call (for the A/B harness);
 * the env var is the default source when that option is omitted.
 */
function isLp612TargetedRevisionEnabled() {
  return isTrue(process.env.LP612_TARGETED_REVISION);
}

/**
 * bd-w65g9 — Anthropic prompt caching on the author ladder.
 *
 * Caching is a PREFIX MATCH (tools -> system -> messages): the bytes ahead of a
 * `cache_control` breakpoint must repeat exactly for the next call to read the entry.
 * Measured on prod telemetry 2026-09-06 (12 lessons / 68 calls): 5.7 calls per lesson,
 * ~48,668 prompt tokens each, `cached_tokens: 0` on every one — nothing was ever sent to
 * make the prefix cacheable. The system brief alone is 37,536 tokens (77% of the average
 * prompt) and is byte-identical on every call of a lesson.
 *
 * Two breakpoints ride this one flag, and they carry different risk:
 *   BP1  the system message — transport wrapping only, the prompt bytes do not move.
 *   BP2  `originalUser` hoisted to the FRONT of the revision turn so it can sit ahead of a
 *        breakpoint — the only change that moves a prompt byte.
 *
 * Default FALSE, same convention as the flags above: OFF must be today, byte for byte.
 */
function isLp612PromptCacheEnabled() {
  return isTrue(process.env.LP612_PROMPT_CACHE);
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

/**
 * THE URDU OVERLAY PASS'S OWN CLOCK — bd-zle0u.
 *
 * Deliberately NOT `authorTimeoutMs()`. The pass runs after the author timeout has already been
 * raced and won, on a document that is finished and rendered; giving it the author's clock would
 * hand it whatever seconds happened to be left, which is the exact failure this bead removes.
 *
 * Sized from the measured parts, not guessed: ONE ~7k-token call at the measured 142 tok/s is
 * ~50s, `callWithRetry` may spend a second attempt, and the overlaid render is ~30-40s. So the
 * expectation is ~100-150s and this is the HARD STOP well above it. Blowing it is not a lost
 * lesson — the worker already holds the rendered English PDF and delivers that.
 */
const DEFAULT_OVERLAY_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * THE OVERLAY PASS'S KILL SWITCH — bd-zle0u. Opt-OUT, never opt-in.
 *
 * `LP612_OVERLAY_PASS_OFF=true` skips the pass, and an Urdu request against an English-medium
 * book falls back to exactly the behaviour of step 1: the English lesson, `overlay_dropped` on
 * the row, the honest caption, and `lp612.overlay.deferred` rather than `.dropped` — because
 * skipping deliberately is not the same event as trying and failing (rule 24(b)).
 *
 * It is OPT-OUT because the default has to be the fix. A presence-gated opt-in would leave the
 * P0 unfixed on any service where nobody remembered to set the variable, which is the shape of
 * half the "defined != live" failures in this programme.
 *
 * It exists because this lane has now shipped two fixes in one week that each replaced a
 * wrong-language lesson with NO lesson. If the pass misbehaves on real traffic, this returns
 * every teacher to a delivered English lesson with ONE Railway variable and no deploy — which is
 * minutes instead of the ~15 a revert-and-redeploy costs, on a path a teacher is waiting on.
 */
function overlayPassOff() {
  return isTrue(process.env.LP612_OVERLAY_PASS_OFF);
}

function overlayTimeoutMs() {
  return num(process.env.LP612_OVERLAY_TIMEOUT_MS, DEFAULT_OVERLAY_TIMEOUT_MS);
}

function followupAfterMs() {
  return num(process.env.LP612_FOLLOWUP_MS, DEFAULT_FOLLOWUP_MS);
}

/**
 * How long the SQS visibility heartbeat keeps a running job's message invisible.
 *
 * ONE DEFINITION, ON PURPOSE (bd-w36m5). `workers/sqs-worker.js` computed `authorTimeoutMs() * 2`
 * inline for the heartbeat's `ceilingMs`, and `lp612-serving.service.js`'s reaper carried a
 * completely unrelated number for "how long before we call this row a corpse". Those two describe
 * the SAME envelope from opposite ends and they disagreed by a factor of four: the reaper condemned
 * rows at ~17 minutes while the heartbeat was still actively re-extending visibility for a worker
 * that was demonstrably alive, so the row went `failed` and then back to `ready` when the job
 * finished. A corpse detector whose window is shorter than the window in which the owner is
 * provably alive is not detecting corpses.
 *
 * Both callers now read this. Changing the multiplier changes both, which is the point.
 */
function heartbeatCeilingMs() {
  return authorTimeoutMs() * 2;
}

/**
 * HOW LONG A DRAINING WORKER WAITS FOR AN IN-FLIGHT AUTHORING RUN — bd-oak77.11.
 *
 * The operator's requirement is that a deploy never kills a lesson that is being written. The
 * worker's general graceful-shutdown budget (`GRACEFUL_SHUTDOWN_TIMEOUT`, 30s) is sized for
 * coaching, where a job either finished inside the window or is cheap to redo. An lp612 authoring
 * run is neither: 2.5-7 minutes and ~$0.30-0.60 of tokens, and releasing its SQS message mid-run
 * does not help anybody — the row is still `authoring`, so the next replica re-authors the whole
 * lesson from round 0 at full price and the teacher's clock starts again.
 *
 * DERIVED, not chosen. `LP612_AUTHOR_TIMEOUT_MS` (420000 on prod) bounds authoring + the final
 * render. Everything after it is unbounded by that clock: the Urdu overlay pass (its own
 * `overlayTimeoutMs`, 240000 default), the PDF read, two R2 uploads, the terminal DB writes and the
 * per-waiter WhatsApp send. 04_sub5 measured p90 315s and a max of 407s end to end. Ten minutes
 * covers that with margin and still bounds a pathological job, which is why the drain releases the
 * message when this expires rather than waiting forever.
 *
 * It is NOT `authorTimeoutMs()`-derived on purpose: the two answer different questions ("how long
 * may one authoring attempt run" vs "how long will a dying process hold the door open"), and the
 * Railway draining window has to be set from THIS one.
 */
const DEFAULT_DRAIN_TIMEOUT_MS = 10 * 60 * 1000;

function lp612DrainTimeoutMs() {
  return num(process.env.LP612_DRAIN_TIMEOUT_MS, DEFAULT_DRAIN_TIMEOUT_MS);
}

/**
 * THE CHECKPOINT KILL SWITCH — bd-oak77.11. Opt-OUT, never opt-in, for the same reason
 * `overlayPassOff` is: the default has to be the fix, or the P0 stays unfixed on whichever service
 * nobody remembered to configure.
 *
 * `LP612_CHECKPOINT_OFF=true` stops the worker persisting the ladder's best-so-far document on the
 * render row and stops it resuming from one. Behaviour returns EXACTLY to today's: a process that
 * dies mid-run costs the whole lesson, and the next pickup starts at round 0. One Railway variable,
 * no deploy.
 */
function checkpointOff() {
  return isTrue(process.env.LP612_CHECKPOINT_OFF);
}

/**
 * The visibility window one `extendJobTimeout` call buys.
 *
 * Matches `receiveJobs`'s `VisibilityTimeout: 900` and the `extendSeconds: 900` the lp612 heartbeat
 * passes. It matters to the reaper because the heartbeat's LAST extension is still in force after
 * the ceiling stops it: the earliest SQS itself could hand the job to another worker is
 * ceiling + this.
 */
const SQS_VISIBILITY_WINDOW_MS = 900 * 1000;

/**
 * When a row that NO WORKER EVER PICKED UP is finally written off (bd-dr216).
 *
 * This is not the authoring clock and must never share its threshold. A row with no `picked_up_at`
 * is waiting in the queue, and waiting is not failing — under the current one-replica capacity
 * fault the measured p90 enqueue->done is 1023s, so a threshold anywhere near the authoring one
 * condemns healthy lessons purely for being queued (2 of 16 coach taps on 2026-09-04).
 *
 * Six hours is deliberately far outside any plausible queue wait — ~21x the worst measured one —
 * because this is a BACKSTOP, not a detector. The orphan it exists for (the row was inserted and
 * the enqueue then threw, so no message exists and no worker is ever coming) is now caught at its
 * source by the serving path, which writes ENQUEUE_FAILED on the row. What is left for this sweep
 * is only the case where the process died between those two writes.
 */
const DEFAULT_QUEUE_ABANDON_MS = 6 * 60 * 60 * 1000;

function queueAbandonMs() {
  return num(process.env.LP612_QUEUE_ABANDON_MS, DEFAULT_QUEUE_ABANDON_MS);
}

/**
 * THE CUTOVER SWITCH — bd-oak77.4.
 *
 * The operator, 2026-09-06: "turn off the free flow lesson plan generation via gamma on prod, and
 * route all lesson plan requests to this menu."
 *
 * Most of that ask is already true on `develop`: the Gamma strip retired generation and the
 * one-door change funnelled every entry — the bare "lp" command, the lesson_plan intent in text
 * and voice, the /menu
 * tap — into one `openLpBrowseFlow()`. What survived is the OLD 6-12 Oxbridge picker, which is
 * reached UPSTREAM of that door by `tryCurriculumLessonPlanServe`, and the endpoint's own
 * lp612 -> Oxbridge fallback. This flag closes both, for grades 6-12 only.
 *
 * A THIRD flag rather than folding into isLp612Enabled(), for the reason the religious hold is
 * separate: turning the 6-12 corpus ON must not, in the same instant and with no way back, take the
 * 70 curated Oxbridge lessons away from every teacher whose books the segmentation fleet finished
 * last. Rollback is one Railway variable and no deploy.
 *
 * It only ever NARROWS isLp612Enabled(). With ENABLED off this is inert, and the caller must
 * already have passed that gate.
 */
function isLp612RouteAll() {
  return isTrue(process.env.LP_612_ROUTE_ALL);
}

/**
 * WHETHER "ALL LESSON PLAN REQUESTS" INCLUDES K-5 — bd-oak77.4. Ships FALSE, deliberately.
 *
 * The 6-12 menu covers 62 books for grades 6-12 and CANNOT serve a K-5 teacher; grades 1-5 are the
 * K-5 v8 corpus, reached through the same Flow and the same grade picker at
 * `pakistan-lp-endpoint.selectGrade`. So a K-5 teacher who taps the menu is already ON the menu —
 * nothing has to route her anywhere, and the default is to leave her exactly where she is.
 *
 * This exists so the operator's answer is a flag and not a rebuild. Flipping it true sends K-5
 * requests to the 6-12 catalogue, where she will be told there are no lessons for her class. Do not
 * flip it without the product owner's word.
 */
function isLp612RouteK5() {
  return isTrue(process.env.LP_612_ROUTE_K5);
}

/**
 * Which grades the 6-12 menu claims under the current flag set — the ONE definition, so the router
 * and the Flow endpoint cannot drift apart (the bd-w36m5 lesson: two places describing the same
 * envelope from opposite ends disagreed by a factor of four).
 *
 * An unknown/unparseable grade is NOT claimed here: it is the caller's job to send the menu, whose
 * first screen is the grade picker. Claiming it would have this function assert a grade it does not
 * know.
 */
function lp612ServesGrade(g) {
  if (!isLp612Enabled()) return false;
  if (isLp612Grade(g)) return true;
  return isLp612RouteK5() && isV8ish(g);
}

/** Grades 1-5. Local, because `isV8Grade` lives in the endpoint and this module must not import it
 *  (the endpoint imports this one — a cycle). Kept beside lp612ServesGrade so the two read together. */
function isV8ish(g) {
  const n = parseInt(String(g), 10);
  return Number.isFinite(n) && n >= 1 && n <= 5;
}

function isLp612Grade(g) {
  const n = parseInt(String(g), 10);
  return Number.isFinite(n) && n >= LP612_MIN_GRADE && n <= LP612_MAX_GRADE;
}

module.exports = {
  isLp612Enabled,
  isLp612RouteAll,
  isLp612RouteK5,
  lp612ServesGrade,
  isLp612EditEnabled,
  isLp612LangMenuEnabled,
  isLp612TargetedRevisionEnabled,
  isLp612PromptCacheEnabled,
  isReligiousEnabled,
  templateVersion,
  previousTemplateVersions,
  TEMPLATE_VERSION_LINEAGE,
  resolveAuthorModel,
  authorTierFor,
  AUTHOR_TIERS,
  authorRounds,
  authorTimeoutMs,
  overlayTimeoutMs,
  overlayPassOff,
  followupAfterMs,
  heartbeatCeilingMs,
  lp612DrainTimeoutMs,
  checkpointOff,
  DEFAULT_DRAIN_TIMEOUT_MS,
  queueAbandonMs,
  SQS_VISIBILITY_WINDOW_MS,
  DEFAULT_QUEUE_ABANDON_MS,
  isLp612Grade,
  LP612_MIN_GRADE,
  LP612_MAX_GRADE,
  DEFAULT_TEMPLATE_VERSION,
  DEFAULT_AUTHOR_MODEL,
};
