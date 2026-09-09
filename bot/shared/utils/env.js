/**
 * Reading env-derived config the way a deployment actually delivers it.
 *
 * `process.env.X` is not the value an operator thinks they set. A `.env` FILE is
 * parsed by dotenv, which strips wrapping quotes — so `AWS_REGION="us-east-1"` in
 * a file arrives as `us-east-1`. A PLATFORM env var (Railway, Fly, Heroku, a
 * Kubernetes secret) is delivered verbatim: paste `"us-east-1"` into the
 * dashboard and the quotes are part of the value.
 *
 * That asymmetry cost NIETE 30 coaching sessions on 2026-08-17/18.
 * `AWS_REGION_TEXTRACT` was set to the 16-character `"ap-southeast-1"` — region
 * plus two quote characters — and `AWS_TEXTRACT_ACCESS_KEY_ID` (22 chars for a
 * 20-char key) and `AWS_TEXTRACT_SECRET_ACCESS_KEY` (42 for 40) the same way, on
 * both the `bot` and `sqs-worker` services. `@smithy` rejected the region
 * (`Region not accepted: region=""ap-southeast-1"" is not a valid hostname
 * component`), Textract threw, and because it is invoked as the lesson-plan OCR
 * fallback the throw propagated out and terminated the session. 23 teachers
 * never received a report. Nothing detected it for a day: the analysis itself had
 * already succeeded, so latency and throughput metrics all read healthy.
 *
 * Note what made it expensive rather than merely wrong. The value was malformed
 * from the moment it was configured, so this path had NEVER worked — but it only
 * runs for lesson plans whose text layer is too thin to parse, so the breakage
 * stayed latent until traffic grew enough to hit that case regularly.
 *
 * `envStr()` normalises AND warns. Silent repair would hide the operator error
 * forever; throwing would turn a paste mistake into a boot crash. Warning once
 * per variable names the culprit in the logs while the service keeps running.
 */

const { logWarn } = require('./logger');

// One warning per variable name, not per read: these helpers are called on every
// lazy client construction, and an unthrottled warning would bury the signal.
const warned = new Set();

/**
 * Reads an env var, trimming whitespace and removing ONE layer of wrapping
 * quotes. Returns `undefined` for unset/empty so `envStr(a) || envStr(b)`
 * fall-through keeps working exactly like `process.env.A || process.env.B`.
 *
 * @param {string} name Env var name.
 * @returns {string|undefined} The cleaned value, or undefined when absent/empty.
 */
function envStr(name) {
  const raw = process.env[name];
  if (raw == null) return undefined;

  let value = String(raw).trim();

  // Balanced pairs only. An unbalanced quote (`"us-east-1`) is left alone: we
  // cannot know whether the quote is a typo or part of the value, and inventing
  // one would be worse than letting the consumer fail loudly. `[\s\S]` rather
  // than `.` so multi-line values match too.
  const wrapped = /^"([\s\S]*)"$/.exec(value) || /^'([\s\S]*)'$/.exec(value);
  if (wrapped) value = wrapped[1].trim();

  if (value !== String(raw) && !warned.has(name)) {
    warned.add(name);
    logWarn(
      `Env var ${name} had surrounding quotes or whitespace and was normalised — `
      + 'fix it at the source. A platform env var is delivered verbatim, so '
      + 'quotes pasted into the dashboard become part of the value.',
      { variable: name, rawLength: String(raw).length, cleanedLength: value.length }
    );
  }

  return value === '' ? undefined : value;
}

/** Test seam: forget which vars have already warned. */
function __resetEnvWarnings() {
  warned.clear();
}

module.exports = { envStr, __resetEnvWarnings };
