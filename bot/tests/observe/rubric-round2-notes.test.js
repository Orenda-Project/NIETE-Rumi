/**
 * bd-rlxkkt.7 — the round-2 debrief-notes changes, for staging and production (the notes half of the sandbox suite
 * rubric-round2-sandbox-test.test.js; the report half stays on sandbox, the coach's report is moving to the portal).
 *
 *  2. No code names reach the coach: the data the model reads has plain-word keys, the prompt forbids codes, and
 *     key-shaped words left in the model's notes are made plain before the coach sees them.
 *  3. Line 4 names only the AREA; the teacher names the step in line 5 (the step stays above, for the coach).
 *  4. The moment to bring up: the question asked, the answer and what the teacher did, with its time when the data
 *     has one; the step must fit it (a wrong answer is corrected kindly).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const G = require('../../shared/services/observe/observe-debrief-guide');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const V2 = {
  framework: 'fico',
  strengths: [{ title: 'Clear objectives and coherent sequence', evidence: 'the aim was stated (03:34)' }],
  focus_area: { title: 'Feedback on answers', try_this_tomorrow: 'thank, correct kindly, ask for a reason', lever_question: 'What were you hoping for?' },
  domains: { student_engagement: { indicators: [{ id: 'D1', name: 'Diversity of expression', evidence: 'a student said "Hazrat Umar" [12:05]' }] } },
};

describe('2. no code names reach the coach', () => {
  for (const lang of ['ur', 'en']) {
    it(`${lang}: the data the model reads has plain-word keys, and the prompt forbids codes`, () => {
      const p = G.buildGuidePrompt(V2, { language: lang });
      const data = p.slice(p.indexOf('OBSERVATION DATA'));
      expect(data).not.toMatch(/\b[a-z]+_[a-z_]+\b/);          // no student_engagement, focus_area, try_this_tomorrow…
      expect(data).toContain('Clear objectives and coherent sequence');
      expect(p).toMatch(/never a code|no codes?|underscore/i);
    });
  }
  it('key-shaped words left in the model\'s notes become plain words', () => {
    const g = {
      intro: 'Notes.',
      went_well: ['clear_objective: the teacher stated the aim', 'story_connection: linked the story to daily life'],
      work_on_first: { title: 'feedback_on_answers', seen: 'one word answers', next_step: 'thank, correct, ask why' },
      moment: { time: null, text: 'the student said "Hazrat Umar"' },
      conversation: ['a', 'b', 'c', 'If we work on one thing: feedback_on_answers.', 'e', 'f'],
      outro: 'o',
    };
    const out = G.plainCodeNames(g);
    expect(out.went_well).toEqual(['Clear objective: the teacher stated the aim', 'Story connection: linked the story to daily life']);
    expect(out.work_on_first.title).toBe('Feedback on answers');
    expect(out.conversation[3]).toBe('If we work on one thing: feedback on answers.');
    // What the coach reads (the values, not our JSON contract's own keys).
    const read = [out.intro, out.outro, ...out.went_well, ...Object.values(out.work_on_first), out.moment.text, ...out.conversation].join('\n');
    expect(read).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  });
  it('other guide shapes pass through untouched', () => {
    const old = { sections: { strengths: { title: 'a_b', say_this: 'x' } } };
    expect(G.plainCodeNames(old)).toBe(old);
  });
});

describe('3–4. line 4 names the area; the moment has its context', () => {
  for (const lang of ['ur', 'en']) {
    const p = G.buildGuidePrompt(V2, { language: lang });
    it(`${lang}: line 4 names only the area, never the step; the teacher names it in line 5`, () => {
      expect(p).toMatch(/only the AREA/);
      expect(p).toMatch(/never the step/i);
    });
    it(`${lang}: the moment gives the question asked, the answer and what the teacher did, and the step fits it`, () => {
      expect(p).toMatch(/question asked/i);
      expect(p).toMatch(/answer/i);
      expect(p).toMatch(/what the teacher did/i);
      expect(p).toMatch(/wrong.*correct it kindly/i);
    });
    it(`${lang}: the next step is labelled for the coach, not to say`, () => {
      expect(observeStrings(lang).guide_next_label).toMatch(lang === 'en' ? /not to say/ : /کہنے کے لیے نہیں/);
    });
    it(`${lang}: the no-model fallback's line 4 names the area, not the step`, () => {
      const g = G.buildFallbackGuide(V2, { language: lang });
      expect(g.conversation[3]).toContain('Feedback on answers');
      expect(g.conversation[3]).not.toContain('correct kindly');
    });
  }
});
