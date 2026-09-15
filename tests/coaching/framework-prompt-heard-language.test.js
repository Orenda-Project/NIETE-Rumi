/**
 * A framework prompt has TWO language needs and they are not the same value:
 *
 *   metadata.language           — the language to WRITE the teacher-facing
 *                                 strings in (her stored preference)
 *   metadata.transcriptLanguage — the language the lesson was SPOKEN in
 *
 * Before this change the prompt had one field doing both jobs, fed from the
 * transcriber's label, so a lesson labelled English steered the Urdu teacher's
 * focus-area copy into English.
 *
 * Executes each framework's real buildAnalysisPrompt().
 */

jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const FRAMEWORKS = ['fico', 'hots', 'teach', 'oecd'];

const META = {
  duration: 1800,
  language: 'ur',            // output language
  transcriptLanguage: 'en',  // what was heard
  teacherFirstName: 'Ayesha',
};

describe('framework prompts separate the output language from the heard language', () => {
  for (const key of FRAMEWORKS) {
    describe(key, () => {
      const framework = require(`../../bot/shared/services/coaching/frameworks/${key}-framework`);

      test('names the spoken language of the lesson as English', () => {
        const prompt = framework.buildAnalysisPrompt('some transcript', META, null, null);
        expect(prompt).toMatch(/Language spoken in the lesson:\s*English/);
      });

      test('does not label the heard language as the primary language of the output', () => {
        const prompt = framework.buildAnalysisPrompt('some transcript', META, null, null);
        expect(prompt).not.toMatch(/Primary Language:\s*en\b/);
      });
    });
  }

  test('fico still steers the teacher-facing focus area into Urdu', () => {
    const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
    const prompt = fico.buildAnalysisPrompt('some transcript', META, null, null);
    expect(prompt).toMatch(/FOCUS-AREA LANGUAGE[\s\S]{0,120}URDU/);
  });

  test('with no heard language at all the line is simply absent', () => {
    const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
    const prompt = fico.buildAnalysisPrompt('t', { language: 'ur' }, null, null);
    expect(prompt).not.toMatch(/Language spoken in the lesson/);
  });
});
