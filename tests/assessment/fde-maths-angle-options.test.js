/**
 * bd-5jmnfj.11: Maths Q4 prints its three angles as i) ii) iii) under the stem, the
 * way FDE's paper does (CAE 2026 p.11: three options, attempt any two), so the teacher
 * can mark the two the child chose. Through the real chain: applyLayout → normaliseScheme
 * → renderPaper / renderMarkingScheme. Fictional fixtures only.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects;
const SLOT = P.maths.sections.flatMap((s) => s.slots).find((s) => s.slot === 'maths.C.Q4-8');
const ANGLES = ['Obtuse angle', 'Supplementary angle', 'Straight angle'];

function raw() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8'));
}

// The fixture's draw item, rewritten the way the prompt now asks for it.
function withOptions(exam, questions) {
  let done = false;
  const walk = (o) => {
    if (done || !o || typeof o !== 'object') return;
    if (o.slot === 'maths.C.Q4-8' && /draw/i.test(o.question || '')) {
      o.question = 'Draw and identify any two of the following angles.';
      o.questions = questions;
      done = true;
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(exam);
  if (!done) throw new Error('fixture has no draw item');
  return exam;
}

function laid(exam) {
  return normaliseScheme(applyLayout(exam, P.maths, { kind: 'fde' }, { now: NOW }).examJson).examJson;
}

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
}

const paperOf = (exam) => visible(R.renderPaper({ examJson: exam, grade: 5, subject: 'maths', answerLines: true, allowShort: true }));
const schemeOf = (exam) => visible(R.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'maths', allowShort: true }));

describe('Maths Q4 angle options print i) ii) iii) (bd-5jmnfj.11)', () => {
  it('prints the three angles under the stem as i) ii) iii)', () => {
    const text = paperOf(laid(withOptions(raw(), ANGLES)));
    expect(text).toContain('Draw and identify any two of the following angles. i) Obtuse angle ii) Supplementary angle iii) Straight angle');
    expect(text).not.toMatch(/\(a\) Obtuse angle/);
  });

  it('prints them the same when the model writes each option as an object', () => {
    const text = paperOf(laid(withOptions(raw(), ANGLES.map((question) => ({ question })))));
    expect(text).toContain('i) Obtuse angle ii) Supplementary angle iii) Straight angle');
  });

  it('keeps Q4 at 5 marks in the scheme and the paper total at the old value', () => {
    const before = schemeOf(laid(raw()));
    const after = schemeOf(laid(withOptions(raw(), ANGLES)));
    const total = (t) => (t.match(/Total[^0-9]*(\d+)/) || [])[1];
    expect(total(after)).toBe(total(before));
  });

  it('asks the model for exactly the three FDE angles as the item\'s questions, attempt any two', () => {
    expect(SLOT.sub_numbering).toBe('roman');
    expect(SLOT.prompt_rule).toMatch(/`questions` = exactly three/);
    expect(SLOT.prompt_rule).toMatch(/never a straight angle/);
    expect(SLOT.prompt_rule).toMatch(/any two/);
  });
});
