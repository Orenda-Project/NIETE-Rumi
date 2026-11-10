/**
 * bd-rlxkkt.8 — a wrong student answer is treated as wrong (TDD, red-first; sandbox).
 *
 * In the ICT HITL owner's real 4 Nov exchange a student answered "Hazrat Umar" to "who went with the Prophet to
 * Ta'if?" (wrong: it was Hazrat Zaid bin Haritha). The teacher said «شاباش» and moved on, and the notes built the step
 * on the answer ("name one correct point") instead of correcting it. The notes already said a wrong answer is
 * corrected kindly; the model did not apply it because nothing made it judge the answer.
 *
 * Now the model judges the answer at the moment ("right", "partly right" or "wrong") against the subject facts, not
 * against the teacher's reaction; the code keeps only those three values; and the coach reads a plain label on the
 * moment ("a wrong answer"), on WhatsApp and on the portal's Debrief step.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const G = require('../../shared/services/observe/observe-debrief-guide');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const notes = (answer) => ({
  intro: 'Notes.',
  went_well: ['Clear aim: the aim was stated.'],
  work_on_first: { title: 'Feedback on answers', seen: 'the answer got praise and the lesson moved on.', next_step: 'thank, correct kindly, ask again.' },
  moment: { time: '14:06', text: 'Asked who went with the Prophet to Ta\'if; a student said "Hazrat Umar"; the teacher said "شاباش".', answer },
  conversation: ['a', 'b', 'c', 'd', 'e', 'f'],
  outro: 'o',
});

describe('the model is made to judge the answer at the moment', () => {
  for (const lang of ['ur', 'en']) {
    const p = G.buildGuidePrompt({ focus_area: {} }, { language: lang });
    it(`${lang}: the moment carries "answer": right, partly right or wrong`, () => {
      expect(p).toMatch(/"answer"/);
      expect(p).toMatch(/"right"/);
      expect(p).toMatch(/"partly right"/);
      expect(p).toMatch(/"wrong"/);
    });
    it(`${lang}: judged against the subject facts, not the teacher's reaction`, () => {
      expect(p).toMatch(/subject facts/i);
      expect(p).toMatch(/praise does not make (it|an answer) right/i);
    });
    it(`${lang}: a wrong answer is named as wrong, and the step corrects it kindly`, () => {
      expect(p).toMatch(/wrong.{0,120}say so plainly/i);
      expect(p).toMatch(/wrong.{0,160}correct it kindly/i);
    });
  }
});

describe('the code keeps only the three judgements', () => {
  it('normalises the model\'s word', () => {
    expect(G.normaliseMomentAnswer(notes('Wrong')).moment.answer).toBe('wrong');
    expect(G.normaliseMomentAnswer(notes('partly_right')).moment.answer).toBe('partly right');
    expect(G.normaliseMomentAnswer(notes(' right ')).moment.answer).toBe('right');
    expect(G.normaliseMomentAnswer(notes('unclear')).moment.answer).toBeNull();
    expect(G.normaliseMomentAnswer(notes(undefined)).moment.answer).toBeNull();
  });
  it('leaves notes without a moment, and other shapes, as they came', () => {
    const none = { ...notes('wrong'), moment: null };
    expect(G.normaliseMomentAnswer(none)).toBe(none);
    const old = { sections: {} };
    expect(G.normaliseMomentAnswer(old)).toBe(old);
  });
});

describe('the coach reads it on the moment', () => {
  for (const lang of ['ur', 'en']) {
    const S = observeStrings(lang);
    it(`${lang}: a wrong answer is labelled on the moment's heading`, () => {
      const out = G.renderGuideMessage(G.normaliseMomentAnswer(notes('wrong')), S);
      const heading = out.split('\n').find((l) => l.includes(S.guide_moment_label));
      expect(heading).toContain(S.guide_moment_wrong_label);
      expect(heading).toContain('14:06');
    });
    it(`${lang}: a partly right answer has its own label; a right or unjudged one has none`, () => {
      const part = G.renderGuideMessage(G.normaliseMomentAnswer(notes('partly right')), S);
      expect(part).toContain(S.guide_moment_partly_label);
      for (const a of ['right', null]) {
        const out = G.renderGuideMessage(G.normaliseMomentAnswer(notes(a)), S);
        expect(out).not.toContain(S.guide_moment_wrong_label);
        expect(out).not.toContain(S.guide_moment_partly_label);
      }
    });
  }
});
