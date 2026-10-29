/**
 * bd-5jmnfj.33.4 D2 — the legend named L «نام» (label) on G3/G4 papers where L pays for other things.
 *  G4 Urdu Q6/Q7 «L1 زبان درست ہو» pays for language/spelling; G3 GK Q5 «L1 قدموں کی درست ترتیب»
 *  pays for order. Mid papers name L by what it pays; G1/G2 and G5 keep «نام».
 */

const { midKeyNames } = require('../../bot/shared/services/assessment/fde-mid-legend');
const g3Urdu = require('../../bot/shared/services/assessment/patterns/mid/g3-urdu');
const g4Urdu = require('../../bot/shared/services/assessment/patterns/mid/g4-urdu');
const g3Gk = require('../../bot/shared/services/assessment/patterns/mid/g3-general-knowledge');
const g3Maths = require('../../bot/shared/services/assessment/patterns/mid/g3-maths');
const g1Urdu = require('../../bot/shared/services/assessment/patterns/early/g1-urdu');
const G5 = require('../../bot/shared/services/assessment/patterns/fde-g5-2027');

describe('midKeyNames', () => {
  test('Urdu and English papers name L by language', () => {
    expect(midKeyNames('urdu').key_names_ur.L).toBe('زبان');
    expect(midKeyNames('urdu').key_names_en.L).toBe('language');
    expect(midKeyNames('english').key_names_ur.L).toBe('زبان');
  });
  test('General Knowledge names L by order', () => {
    expect(midKeyNames('general_knowledge').key_names_ur.L).toBe('ترتیب');
    expect(midKeyNames('general_knowledge').key_names_en.L).toBe('order');
  });
  test('other letters keep their names; unlisted subjects change nothing', () => {
    expect(midKeyNames('urdu').key_names_ur.K).toBe('اہم نکتہ');
    expect(midKeyNames('maths')).toEqual({});
  });
});

describe('the built patterns', () => {
  test('G3 Urdu, G4 Urdu and G3 GK carry the new L', () => {
    expect(g3Urdu.legend.key_names_ur.L).toBe('زبان');
    expect(g4Urdu.legend.key_names_ur.L).toBe('زبان');
    expect(g3Gk.legend.key_names_ur.L).toBe('ترتیب');
    expect(g3Gk.legend.key_names_en.L).toBe('order');
    expect(g3Urdu.legend.key_names_ur.M).toBe('طریقہ');
  });
  test('G3 Maths, G1 and G5 keep «نام»', () => {
    expect(g3Maths.legend.key_names_ur.L).toBe('نام');
    expect(g1Urdu.legend.key_names_ur.L).toBe('نام');
    expect(G5.subjects.urdu.legend.key_names_ur.L).toBe('نام');
  });
});
