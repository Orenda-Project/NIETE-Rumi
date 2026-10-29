/**
 * bd-5jmnfj.33.4 D3 — G3 GK Q2 match had no answer mechanism (v32 review p.2): no column heads,
 * no letters on Column B, nothing to write in, and each A row beside an unrelated B phrase.
 * G3/G4 now print «کالم الف | | کالم ب», lettered Column B, a «(    )» box on each A row, and the key
 * says "letter) text". G1/G2 match prints are unchanged (fde-match.test.js).
 */

const { midMatchTable, midMatchKey, midMatchStripKeys, isMidMatch } = require('../../bot/shared/services/assessment/fde-mid-match');
const { matchOrder, matchAnswer, matchTable } = require('../../bot/shared/services/assessment/fde-match-block');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const gk = require('./fixtures/mid/g3-general_knowledge-ch3-exam.json');

const PAIRS = [
  ['پسند ناپسند', 'لڑائی کی وجہ'], ['جماعت', 'بیٹھنے کی جگہ'], ['غلطی ماننا', 'مسئلے کا حل'],
  ['آہستہ بولنا', 'ناراضی کم کرنا'], ['خود حل نہ ہو سکے', 'والدین کو بتانا'],
];
const live = PAIRS.map(([a, b]) => ({ column_a: [a], column_b: [b], answer: `${a}: ${b}` }));
const column = matchOrder(live.map(matchAnswer));
const stems = PAIRS.map(([a]) => a);
const LETTERS = ['الف', 'ب', 'ج', 'د', 'ہ'];

describe('midMatchTable', () => {
  const html = midMatchTable(stems, column, 'ur');
  const rows = html.split('<tr').slice(1);

  test('heads the columns «کالم الف» and «کالم ب»', () => {
    expect(rows[0]).toContain('کالم الف');
    expect(rows[0]).toContain('کالم ب');
    expect(rows).toHaveLength(PAIRS.length + 1);
  });
  test('letters Column B in order, five letters', () => {
    const bs = [...html.matchAll(/class="m-b"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    expect(bs).toHaveLength(5);
    bs.forEach((b, i) => {
      expect(b).toContain(`${LETTERS[i]})`);
      expect(b).toContain(column[i]);
    });
  });
  test('every A row ends with one blank box', () => {
    const as = [...html.matchAll(/class="m-a"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    expect(as).toHaveLength(5);
    as.forEach((a, i) => {
      expect(a).toContain(stems[i]);
      expect(a).toMatch(/class="m-box"/);
    });
    expect((html.match(/class="m-box"/g) || []).length).toBe(5);
  });
  test('no B entry sits on the row of its own A', () => {
    PAIRS.forEach(([, b], i) => expect(column[i]).not.toBe(b));
  });
  test('English heads and lower-case letters', () => {
    const en = midMatchTable(['x'], ['y'], 'en');
    expect(en).toContain('Column A');
    expect(en).toContain('Column B');
    expect(en).toContain('a)');
  });
});

describe('the key', () => {
  test('each A item keys the letter of its own B', () => {
    const keys = midMatchKey(live, column, 'ur');
    PAIRS.forEach(([, b], i) => {
      const at = column.indexOf(b);
      expect(keys[i]).toBe(`${LETTERS[at]}) ${b}`);
    });
  });
  test('isMidMatch is G3/G4 match slots only', () => {
    expect(isMidMatch({ slot: 'g3.general_knowledge.A.match', shape: 'match' })).toBe(true);
    expect(isMidMatch({ slot: 'g4.urdu.A.match', shape: 'match' })).toBe(true);
    expect(isMidMatch({ slot: 'g1.general_knowledge.A.Q4', shape: 'match' })).toBe(false);
    expect(isMidMatch({ slot: 'g3.urdu.A.mcq', shape: 'mcq' })).toBe(false);
  });
  test('strip keys are null outside G3/G4', () => {
    expect(midMatchStripKeys({ slot: 'g2.gk.A.Q4', shape: 'match' }, live, 'ur')).toBeNull();
    expect(midMatchStripKeys({ slot: 'g3.general_knowledge.A.match', shape: 'match' }, live, 'ur')).toHaveLength(5);
  });
});

describe('G1/G2 table is untouched', () => {
  test('matchTable still has no head row', () => {
    expect(matchTable(['a'], ['b'])).not.toContain('m-head');
  });
});

describe('the real G3 GK paper', () => {
  const slotOf = (html) => html.split('<div class="slot').find((s) => s.includes('data-slot="g3.general_knowledge.A.match"'));
  const paper = slotOf(R.renderPaper({ examJson: gk, grade: 3, subject: 'general_knowledge' }));
  const key = R.renderMarkingScheme({ examJson: gk, grade: 3, subject: 'general_knowledge', allowShort: true });
  const strip = key.split('<div class="strip"').find((s) => s.startsWith(' data-row="g3.general_knowledge.A.match"'));

  test('Q2 prints heads, letters and boxes', () => {
    expect(paper).toContain('کالم الف');
    expect((paper.match(/class="m-box"/g) || []).length).toBe(5);
    LETTERS.forEach((l) => expect(paper).toContain(`${l})`));
  });
  test('the key strip gives each number its letter and text', () => {
    expect(strip).toBeDefined();
    PAIRS.forEach(([, b]) => expect(strip).toContain(b));
    expect(strip).toMatch(/[الفبجدہ]\) /);
  });
  test('the instruction asks for the letter in the blank', () => {
    const slots = Patterns.get('fde_g3_2026').subjects.general_knowledge.sections.flatMap((s) => s.slots);
    expect(slots.find((s) => s.shape === 'match').instruction_ur).toBe('کالم الف کو کالم ب سے ملائیں۔ درست حرف خالی جگہ میں لکھیں۔');
  });
});
