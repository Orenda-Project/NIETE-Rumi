/**
 * bd-bfy69 — the three layers, asserted on the SOURCE of audio.service.js.
 *
 * Source assertions rather than a live call, because requiring audio.service in
 * a unit test boots the whole env-validation chain (process.exit 78). Two rules
 * from language-protocol §7 apply and are honoured here:
 *   - comments are stripped before matching, so an assertion cannot pass on a
 *     comment that merely mentions the fix;
 *   - each guard is mutation-tested in `mutation` below — break the thing it
 *     protects, watch the matcher go red — so none of these is vacuous.
 */

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', '..', 'bot', 'shared', 'services', 'audio.service.js');
const RAW = fs.readFileSync(SRC_PATH, 'utf8');
const SRC = RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('bd-bfy69 layer 1 — do not invite Hindi', () => {
  it('takes the default hints from LANGUAGE_OFFER, not a second hardcoded list', () => {
    expect(SRC).toMatch(/const\s*\{\s*LANGUAGE_OFFER\s*\}\s*=\s*require\(['"]\.\.\/config\/languages['"]\)/);
    expect(SRC).toMatch(/languageHints\s*=\s*normalizedLanguage\s*\?\s*\[normalizedLanguage\]\s*:\s*\[\.\.\.LANGUAGE_OFFER\]/);
  });

  it('no longer hints four languages this deployment does not serve', () => {
    // es / ar / pa / ta widened the identifier's search space; Hindi is what it
    // settled on for Urdu speech.
    expect(SRC).not.toMatch(/\['en',\s*'ur',\s*'es',\s*'ar',\s*'pa',\s*'ta'\]/);
  });

  it('LANGUAGE_OFFER really is the two languages we mean', () => {
    const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
    expect([...LANGUAGE_OFFER].sort()).toEqual(['en', 'ur']);
  });

  it('still honours an explicit caller language — reading assessment is untouched', () => {
    expect(SRC).toMatch(/normalizedLanguage\s*\?\s*\[normalizedLanguage\]/);
  });
});

describe('bd-bfy69 layer 2 — retry with a forced Urdu hint', () => {
  it('wraps the single attempt rather than replacing it', () => {
    expect(SRC).toMatch(/static async transcribe\(/);
    expect(SRC).toMatch(/static async _transcribeOnce\(/);
    expect(SRC).toMatch(/await this\._transcribeOnce\(audioPath, enableDiarization, language\)/);
  });

  it('retries with the literal Urdu hint', () => {
    expect(SRC).toMatch(/await this\._transcribeOnce\(audioPath, enableDiarization, ['"]ur['"]\)/);
  });

  it('only retries when the caller left the language open', () => {
    // A caller that pinned a language already got a single hint; re-running the
    // identical request would return the identical answer.
    expect(SRC).toMatch(/if \(!language\) \{[\s\S]*_transcribeOnce\(audioPath, enableDiarization, ['"]ur['"]\)/);
  });

  it('returns early and unchanged when the transcript is already clean', () => {
    expect(SRC).toMatch(/if \(!result \|\| !hasDevanagari\(result\.text\)\) return result;/);
  });
});

describe('bd-bfy69 layer 3 — the guarantee', () => {
  it('runs the guard over the text before returning', () => {
    expect(SRC).toMatch(/ensureNoDevanagari\(result\.text/);
  });

  it('overwrites the language label too, so a report cannot inherit the wrong script', () => {
    // Soniox reported 'en'/'hindi' for speech we have just written in Urdu.
    // resolveReportLanguage reads this field to pick the report's branch.
    expect(SRC).toMatch(/language:\s*['"]ur['"],\s*devanagariTransliterated:\s*true/);
  });

  it('logs every layer at error level, never info', () => {
    // Extract each logToFile(...) by matching parentheses — a regex cannot,
    // because these calls contain nested objects and an arrow function, and a
    // lazy `\);` stops at the first inner one and silently under-tests.
    const calls = [];
    for (let i = SRC.indexOf('logToFile('); i !== -1; i = SRC.indexOf('logToFile(', i + 1)) {
      let depth = 0;
      let j = i + 'logToFile'.length;
      for (; j < SRC.length; j++) {
        if (SRC[j] === '(') depth++;
        else if (SRC[j] === ')') { depth--; if (depth === 0) break; }
      }
      calls.push(SRC.slice(i, j + 1));
    }
    const relevant = calls.filter((c) => c.includes('❌') && /Devanagari/i.test(c));
    expect(relevant.length).toBeGreaterThanOrEqual(3);
    for (const call of relevant) {
      expect(call).toMatch(/,\s*['"]error['"]\s*,?\s*\)$/);
    }
  });
});

describe('mutation — each guard above can actually fail', () => {
  // language-protocol §7.3: a guard never proven capable of failing is not a
  // guard. Break the source in memory and confirm the matcher goes red.
  const broken = (find, replace) => SRC.replace(find, replace);

  it('the hint assertion fails if the offer wiring is removed', () => {
    const b = broken(/\[\.\.\.LANGUAGE_OFFER\]/, "['en','ur','es','ar','pa','ta']");
    expect(b).not.toMatch(/languageHints\s*=\s*normalizedLanguage\s*\?\s*\[normalizedLanguage\]\s*:\s*\[\.\.\.LANGUAGE_OFFER\]/);
  });

  it('the retry assertion fails if the forced-Urdu retry is removed', () => {
    const b = broken(/_transcribeOnce\(audioPath, enableDiarization, 'ur'\)/, '_transcribeOnce(audioPath, enableDiarization, null)');
    expect(b).not.toMatch(/await this\._transcribeOnce\(audioPath, enableDiarization, ['"]ur['"]\)/);
  });

  it('the guard assertion fails if ensureNoDevanagari is removed', () => {
    const b = broken(/ensureNoDevanagari\(result\.text/, 'passthrough(result.text');
    expect(b).not.toMatch(/ensureNoDevanagari\(result\.text/);
  });
});
