/**
 * bd-e5n2jf — every answer key tells the teacher to check the answers before she uses it
 * (Amena, 20 Nov: "sometimes answers can be incorrect"). One catalog string, used by every
 * answer-key send: the first paper (orchestrator), the edited paper and each new version.
 */
const fs = require('fs');
const path = require('path');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = (f) => strip(fs.readFileSync(
  path.join(__dirname, '../../bot/shared/services/assessment', f), 'utf8'));

describe('answer-key caption carries the accuracy note', () => {
  test('English', () => {
    const s = resolveUx('assessmentKeyCaption', { language: 'en', params: { title: 'Grade 4 Science' } });
    expect(s).toMatch(/^Answer key · Grade 4 Science/);
    expect(s).toMatch(/check (each|the) answers?/i);
  });
  test('Urdu', () => {
    const s = resolveUx('assessmentKeyCaption', { language: 'ur', params: { title: 'جماعت ۴' } });
    expect(s).toMatch(/جوابی کلید/);
    expect(s).toMatch(/جواب.*چیک/);
    expect([...s].length).toBeLessThanOrEqual(1024);
  });
  test('no answer-key send builds its own caption by hand', () => {
    for (const f of ['assessment-orchestrator.service.js', 'assessment-revision.service.js']) {
      expect(src(f)).not.toMatch(/`Answer key · \$\{/);
    }
    expect(src('assessment-orchestrator.service.js')).toMatch(/resolveUx\('assessmentKeyCaption'/);
  });
});
