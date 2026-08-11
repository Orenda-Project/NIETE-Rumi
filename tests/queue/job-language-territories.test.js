/**
 * Two territories, and the line between them must not blur.
 *
 * The model this workstream adopted splits language in two:
 *
 *   CONTENT  — destined for the classroom (a lesson plan, a worksheet, a pupil
 *              quiz). Resolved when the job is CREATED and frozen into its
 *              payload, so an artifact finishes in the language it was requested
 *              in even if the teacher switches while it renders.
 *
 *   TEACHER  — addressed to her (a notification, a delivery caption, a feedback
 *              prompt). Read FRESH at send time, because if she switched to Urdu
 *              five minutes ago the message she is about to receive should be Urdu.
 *
 * Getting this backwards is wrong in both directions, and both are plausible
 * "cleanups":
 *   - freeze a notification → she is told, in the language she just left, that
 *     her setting changed
 *   - re-resolve an artifact → a lesson plan half-rendered in one language
 *     finishes in another
 *
 * WHY THIS TEST EXISTS AT ALL: the audit recorded this as a defect ("one worker
 * re-resolves language mid-render"). Reading the code, it is not — the workers
 * already draw the line correctly, and pic-lp-kieai even documents the reasoning
 * inline. So there was nothing to fix and everything to protect: a correct,
 * subtle, UNGUARDED design is one confident refactor away from being wrong.
 *
 * Source-level, following tests/coaching/audio-never-writes-language.test.js.
 * Driving these workers end to end would mock the entire queue and prove nothing
 * about which territory a given read belongs to.
 */

const fs = require('fs');
const path = require('path');

const read = (p) =>
  fs
    .readFileSync(path.join(__dirname, '../..', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('CONTENT language is frozen into the job payload', () => {
  it('the pic-to-LP worker takes the artifact language from the job, not the database', () => {
    const src = read('bot/workers/pic-lp-kieai.worker.js');
    // formData is the frozen job payload. A fresh users lookup here would mean the
    // LP's own language could change mid-render.
    expect(src).toMatch(/const language = formData\.language/);
  });

  it('the lesson-plan generation worker declares language as job input', () => {
    const raw = fs.readFileSync(
      path.join(__dirname, '../..', 'bot/workers/lesson-plan-generation.worker.js'),
      'utf8'
    );
    expect(raw).toMatch(/jobData\.language/);
  });
});

describe('TEACHER-addressed messages read the CURRENT preference', () => {
  it('the not-a-lesson-plan notification reads preferred_language at send time', () => {
    // This is a chat message to her, not an artifact. Freezing it would tell her
    // in her old language that something happened.
    const src = read('bot/workers/lesson-plan-extraction.worker.js');
    expect(src).toMatch(/preferred_language/);
  });

  it('the homework delivery caption reads preferred_language at send time', () => {
    const src = read('bot/workers/homework-bundle.worker.js');
    expect(src).toMatch(/select\('preferred_language'\)/);
  });

  it('the pic-to-LP feedback prompt reads preferred_language, NOT the job language', () => {
    // The sharpest case in the codebase: this worker deliberately uses BOTH, one
    // per territory, in the same function. That is the distinction working.
    const src = read('bot/workers/pic-lp-kieai.worker.js');
    expect(src).toMatch(/userPreferredLang/);
    expect(src).toMatch(/select\('preferred_language'\)/);
  });
});

describe('the distinction stays explained, not just implemented', () => {
  it('pic-to-LP keeps the comment that names both territories', () => {
    // Deliberately asserted on the RAW source, comments included. This one comment
    // is the only place the two-territory rule is stated at the point of use; the
    // next person to "simplify" these two lookups into one will read it or not.
    const raw = fs.readFileSync(
      path.join(__dirname, '../..', 'bot/workers/pic-lp-kieai.worker.js'),
      'utf8'
    );
    expect(raw).toMatch(/preferred_language[\s\S]{0,120}not[\s\S]{0,60}formData\.language/i);
  });
});
