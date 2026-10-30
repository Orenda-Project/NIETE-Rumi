/**
 * v27 findings the patterns' own rules answer (bd-5jmnfj.4.58.3). Each line below is a v27 row:
 *   G1/G2 Maths word problems asked "Solve." while the key paid M marks for working; G1 English Q12 printed
 *   "This is a ____." over an egg; Q5/Q11 keyed the whole word for a missing-letter blank; Q8 iii's "jumping"
 *   child had no ground line and read as kneeling; Q12 i's egg outline was unreadable; G5 Maths asked the mean
 *   four times, Q8 named the pair it asked the child to name and Q4 ii asked a child to draw one supplementary
 *   angle; G5 Science Q2 (a) paid for arrows; G5 English Q1 (a) 5 had no true opposite and Q2 ii (b) accepted
 *   another tense; G5 Urdu Q3 keyed اپاہج, Q4 left ارکان unexplained and Q7 paid for a title; G2 Urdu Q1 printed
 *   a misspelt poet twice, Q6 accepted a non-antonym and the oral poem's "sentence" answers were single words.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');

const slotOf = (pid, subject, slot) => {
  const found = Patterns.subjectOf(pid, subject).sections.flatMap((s) => s.slots).find((s) => s.slot === slot);
  if (!found) throw new Error(`${pid} ${subject} has no slot ${slot}`);
  return found;
};
const g5 = (subject, slot) => slotOf('fde_g5_2027', subject, slot);

describe('early maths word problems ask for the working the key pays for', () => {
  test.each([
    ['fde_g1_2026', 'g1.maths.B.Q5', 'Listen to the story and solve. Show your working.'],
    ['fde_g1_2026', 'g1.maths.B.Q6', 'Listen to the story and solve. Show your working.'],
    ['fde_g2_2026', 'g2.maths.B.Q7', 'Solve. Show your working.'],
    ['fde_g2_2026', 'g2.maths.B.Q9', 'Solve. Show your working.'],
    ['fde_g2_2026', 'g2.maths.B.Q11', 'Solve. Show your working.'],
  ])('%s %s', (pid, slot, instruction) => {
    expect(slotOf(pid, 'maths', slot).instruction_en).toBe(instruction);
  });
});

describe('G1 English pictures and keys', () => {
  test('Q12 "This is a" takes only consonant-initial objects no other question uses', () => {
    const rule = slotOf('fde_g1_2026', 'english', 'g1.english.C.Q12').prompt_rule;
    expect(rule).toMatch(/begins with a consonant sound/);
    expect(rule).toMatch(/never egg, apple, umbrella, orange, ant/);
    expect(rule).toMatch(/No object that any other question/);
  });

  test.each(['g1.english.A.Q5', 'g1.english.C.Q11'])('%s keys the missing letters and accepts the word', (slot) => {
    const rule = slotOf('fde_g1_2026', 'english', slot).prompt_rule;
    expect(rule).toMatch(/Answer: the missing letters? only/);
    expect(rule).toMatch(/`accept` the full word/);
  });

  test('every picture slot of the early patterns carries the shared picture rule; a text slot does not', () => {
    const rule = /outline alone is unreadable \(egg, ball, plate, cup, watch, bench, box\)/;
    const front = /drawn large and in front/;
    let pictured = 0;
    for (const pid of ['fde_g1_2026', 'fde_g2_2026']) {
      for (const subject of Object.values(Patterns.get(pid).subjects)) {
        for (const slot of subject.sections.flatMap((s) => s.slots)) {
          if (slot.picture) {
            pictured += 1;
            expect([slot.slot, slot.prompt_rule]).toEqual([slot.slot, expect.stringMatching(rule)]);
            expect([slot.slot, slot.prompt_rule]).toEqual([slot.slot, expect.stringMatching(front)]);
          } else {
            expect([slot.slot, slot.prompt_rule || '']).not.toEqual([slot.slot, expect.stringMatching(rule)]);
          }
        }
      }
    }
    expect(pictured).toBeGreaterThan(10);
  });

  test('an action scene stands its figure on a ground line', () => {
    const p = Kie.promptFor({ kind: 'scene', describe: 'a child jumping in a park', show: { action: 'jumping' } });
    expect(p).toMatch(/plainly jumping/);
    expect(p).toMatch(/ground line/);
    expect(Kie.promptFor({ kind: 'scene', describe: 'a cat on a mat' })).not.toMatch(/ground line/);
  });
});

describe('G5 Maths', () => {
  // Q4's three angles are FDE's own wording (bd-5jmnfj.4.51.11) and stay; Q8 no longer tests the same pair
  // as Q4 ii, and its stem never names the relation it asks the child to name (v27 G5 Maths Q4 ii, Q8).
  test('Q4 keeps FDE\'s three angles; Q8 asks a pair Q4 does not name and never names the relation it asks for', () => {
    const rule = g5('maths', 'maths.C.Q4-8').prompt_rule;
    expect(rule).toMatch(/never a straight angle/);
    expect(rule).toMatch(/pair Q4 does not name/);
    expect(rule).not.toMatch(/Two angles are supplementary/);
    expect(rule).toMatch(/never names the relation/);
  });

  test('Q1 asks the mean at most once on the paper and no option states a method', () => {
    const rule = g5('maths', 'maths.A.Q1a').prompt_rule;
    expect(rule).toMatch(/mean[^.]*at most one item/);
    expect(rule).toMatch(/No option states a method/);
  });
});

describe('G5 Science', () => {
  test('Q2 (a) food chain: four living things, no arrows anywhere, the key lists what it asks', () => {
    const rule = g5('science', 'science.B.Q2a').prompt_rule;
    expect(rule).toMatch(/exactly four living things/);
    expect(rule).toMatch(/never the word "arrows"/);
    expect(rule).toMatch(/lists exactly/);
  });

  test('Q1 (a) never hands over a Section C marking point', () => {
    expect(g5('science', 'science.A.Q1a').prompt_rule).toMatch(/never states a marking point of a Section C answer/);
  });
});

describe('G5 English', () => {
  test('Q1 (a) antonym items carry one exact opposite', () => {
    expect(g5('english', 'english.A.Q1a').prompt_rule).toMatch(/antonym item[^.]*exact opposite/);
  });

  test('Q2 a tense rewrite accepts no other tense', () => {
    expect(g5('english', 'english.B.Q2').prompt_rule).toMatch(/tense[^.]*`accept`[^.]*never[^.]*another tense/);
  });
});

describe('G5 Urdu', () => {
  test('Q3 meanings are respectful: never اپاہج or لنگڑا', () => {
    expect(g5('urdu', 'urdu.C.Q3').prompt_rule).toMatch(/اپاہج/);
    expect(g5('urdu', 'urdu.C.Q3').prompt_rule).toMatch(/لنگڑا/);
  });

  test('Q4 explains ارکان in a child\'s words', () => {
    expect(g5('urdu', 'urdu.C.Q4').prompt_rule).toMatch(/ارکان الگ کریں \(لفظ/);
  });

  test('Q7 pays for no title and its model answer names only what the picture holds', () => {
    const rule = g5('urdu', 'urdu.C.Q7').prompt_rule;
    expect(rule).toMatch(/never a title \(عنوان\)/);
    expect(rule).toMatch(/model answer states only what `describe_en` lists/);
  });
});

describe('G2 Urdu', () => {
  test('Q1 asks no poet or recall items (v34 replaced v28 "one poet item only": the review asked for none)', () => {
    const rule = slotOf('fde_g2_2026', 'urdu', 'g2.urdu.A.Q1').prompt_rule;
    expect(rule).toMatch(/No item asks a poet's name, who said what or what happened/);
    expect(rule).toMatch(/poets never appear in this section/);
    expect(rule).not.toMatch(/\(meanings, who said what/);
  });

  test('Q6 accepts only true opposites', () => {
    expect(slotOf('fde_g2_2026', 'urdu', 'g2.urdu.A.Q6').prompt_rule).toMatch(/`accept`[^.]*true opposite/);
  });

  test('the oral poem answers are full sentences when its rubric pays for sentences', () => {
    const poem = Patterns.subjectOf('fde_g2_2026', 'urdu').oral.tasks.find((t) => /poem|نظم/.test(`${t.id} ${t.label_ur || ''}`));
    expect(poem).toBeTruthy();
    expect(poem.ask).toMatch(/full sentence/);
  });
});
