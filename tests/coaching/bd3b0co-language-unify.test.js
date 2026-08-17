/**
 * bd-3b0co (NIETE DC) — coaching report/reflection language leak.
 *
 * The written report resolved its language with a RAW chain
 * `session.users.preferred_language || session.transcript_language || 'en'`, falling
 * to the AUDIO-detected transcript language, while the voice debrief used
 * `determineOutputLanguage` (preferred_language, floor 'en'). Same session → two
 * languages (English voice + Urdu report, or vice versa) — R50/R51/R52.
 *
 * Fix: the report resolves the teacher-facing language ONCE via the SAME
 * `determineOutputLanguage` resolver the voice uses, and no teacher-facing site falls
 * back to `transcript_language` (a recording never sets her language — only her
 * stored preference does).
 */

const fs = require('fs');
const path = require('path');
// strip block + line comments so assertions match CODE, not the explanatory comments
const raw = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/services/coaching/report-generator.service.js'),
  'utf8'
);
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('bd-3b0co — report language is unified on determineOutputLanguage, no transcript leak', () => {
  it('generateReport resolves output language via determineOutputLanguage', () => {
    expect(code).toMatch(/determineOutputLanguage\(\s*session\.user_id/);
  });
  it('no teacher-facing site falls back to transcript_language (the leak is gone)', () => {
    // the only permitted transcript_language use would be as determineOutputLanguage's
    // (unreachable) fallback arg — the raw "preferred || transcript || 'en'" chains are gone
    expect(code).not.toMatch(/preferred_language\s*\|\|\s*session\??\.?transcript_language/);
    expect(code).not.toMatch(/enhancedAnalysis\.language\s*\|\|\s*session\.transcript_language/);
  });
  it('the hero/card report sites use the single resolved outputLanguage', () => {
    expect(code).toMatch(/heroLanguage\s*=\s*outputLanguage/);
    expect(code).toMatch(/cardLanguage\s*=\s*outputLanguage/);
  });
});
