/**
 * bd-5jmnfj.4.58.9.1, v37r4 panel: pagination rules the renderer's print CSS must carry.
 *   - A word box is never split across a page (G1 English Q7: «rabbit» alone at the top of page 6).
 *   - The slot-fit estimate (fde-slot-fit) matches what Chromium measures, so a short picture slot
 *     that can fit one page is fitted and does not split (G1 Urdu Q3, Q6, Q7, Q10; see
 *     fde-v29-slot-fit.test.js for the numbers).
 * Pure: HTML strings, no browser.
 */
const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const P = Patterns.get('fde_g5_2027').subjects;
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'science.json'), 'utf8'));
const exam = normaliseScheme(applyLayout(raw, P.science, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson).examJson;
const html = R.renderPaper({ examJson: exam, grade: 5, subject: 'science', answerLines: true, allowShort: true });
const rule = (sel) => (html.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 'g')) || []).join(' ');

describe('a word box never splits across a page', () => {
  test('the plain word box is break-inside: avoid', () => {
    expect(rule('.word-box')).toMatch(/break-inside:\s*avoid/);
  });
  test('the word bank (flex-wrapped words) is break-inside: avoid and stays with its first line', () => {
    expect(rule('.word-box.bank')).toMatch(/break-inside:\s*avoid/);
    expect(rule('.word-box.bank')).toMatch(/break-after:\s*avoid/);
  });
});
