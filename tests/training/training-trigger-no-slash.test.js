/**
 * Whole-word, case-insensitive "training" / "trainings" trigger.
 *
 * Teachers naturally type "training" (no slash) when they want to open the
 * Teacher Training module cascade. Prior to this change the intercept only
 * fired on the exact strings `/training` and `/trainings`; any bare word
 * fell through to the AI router (fuzzy). This test asserts the extended
 * condition matches EXACTLY the six intended forms (case-insensitive) and
 * does NOT false-trigger on messages that merely contain the substring.
 *
 * The test targets the trigger predicate directly rather than booting the
 * whole handler — the handler drags in ~40 services (Supabase, WhatsApp,
 * Redis, R2, LLM, …). The predicate is the ONE line that changes; keeping
 * the test surface tight makes the invariant crisp.
 */

const fs = require('fs');
const path = require('path');

const HANDLER_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'bot',
  'shared',
  'handlers',
  'text-message.handler.js'
);

// Extract the training-trigger predicate from the handler source and rebuild
// it as a callable function. This locks the test to the ACTUAL condition
// used in production (not a paraphrase).
function loadTrainingTrigger() {
  const source = fs.readFileSync(HANDLER_PATH, 'utf8');

  // Match the `if (...)` guarding the /training intercept. The block is
  // introduced by the "TRAINING COMMAND:" comment.
  const anchor = source.indexOf('TRAINING COMMAND:');
  if (anchor < 0) {
    throw new Error(
      'Could not find TRAINING COMMAND anchor in text-message.handler.js — ' +
      'the handler may have been restructured. Re-verify the trigger location ' +
      'before editing this test.'
    );
  }
  // From the anchor forward, find the first `if (` and pull until its matching `)`.
  const ifStart = source.indexOf('if (', anchor);
  if (ifStart < 0) throw new Error('No if(...) found after TRAINING COMMAND anchor');

  let depth = 0;
  let i = ifStart + 3; // position of '('
  let end = -1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('Unbalanced parentheses on training-trigger if');

  const condSource = source.slice(ifStart + 4, end); // between '(' and ')'

  // Build a callable that evaluates the condition against a synthetic
  // trimmedMessage. We also expose `lowerTrimmed` because the extended
  // condition uses it.
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'trimmedMessage',
    `const lowerTrimmed = trimmedMessage.toLowerCase(); return (${condSource});`
  );
  return fn;
}

describe('/training trigger — whole-word case-insensitive extension (OPS-108)', () => {
  let fires;
  beforeAll(() => { fires = loadTrainingTrigger(); });

  // Positive cases — teacher-typed variants that MUST open the Flow.
  test.each([
    ['training'],
    ['trainings'],
    ['Training'],
    ['Trainings'],
    ['TRAINING'],
    ['TRAININGS'],
    ['/training'],   // regression: existing slash form still works
    ['/trainings'],  // regression: existing plural slash form still works
    // Phrase-match extension — whole-message exact phrases teachers naturally type.
    ['show me training'],
    ['Show Me Trainings'],
    ['open training'],
    ['OPEN TRAININGS'],
  ])('fires on %p', (input) => {
    expect(fires(input)).toBe(true);
  });

  // Negative cases — must NOT false-trigger.
  test.each([
    ['I completed my training yesterday'],
    ['show me training modules'],
    ['train'],
    ['trainer'],
    ['training modules please'],
    ['/train'],
    ['some/training'],
    [''],
    ['hi'],
    // Substring-safety for the new phrases — must still fall through.
    ['I want to show me training later'],
    ["let's open the training modules"],
  ])('does NOT fire on %p', (input) => {
    expect(fires(input)).toBe(false);
  });
});
