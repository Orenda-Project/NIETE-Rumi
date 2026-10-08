'use strict';
/**
 * Where the server time of the calls a child waits on goes (getQuiz, startSession, finishSession): one log line per
 * call with each step's duration and the total. Ids and numbers only.
 *
 * The DB round-trip count per request is the route-level web_quiz.timing line (M4's), so it is not
 * counted again here. Sandbox, 6 Oct: getQuiz ~3.1 s and startSession ~3.0 s of server time with
 * sub-ms SQL; these lines say which step it is in.
 */
const { logEvent } = require('../../utils/structured-logger');

/**
 * Run fn(mark) and log `web_quiz.<name>_timing` once, whether it answers or throws.
 * mark(step, props?) closes the step since the previous mark; props (ids only) go on the line.
 */
async function run(name, base, fn) {
  const t0 = Date.now();
  let last = t0;
  const steps = {};
  const props = { ...base };
  const mark = (step, extra) => {
    const now = Date.now();
    steps[step] = (steps[step] || 0) + (now - last);
    last = now;
    if (extra) Object.assign(props, extra);
  };
  const done = (ok, status) => {
    mark('rest');
    logEvent(`web_quiz.${name}_timing`, { ...props, ok, ...(status ? { status } : {}), steps_ms: steps, total_ms: Date.now() - t0 });
  };
  try {
    const out = await fn(mark);
    done(true);
    return out;
  } catch (e) {
    done(false, (e && e.status) || 500);
    throw e;
  }
}

module.exports = { run };
