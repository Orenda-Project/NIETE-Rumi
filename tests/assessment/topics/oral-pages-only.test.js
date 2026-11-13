/**
 * bd-pw1ccr.38 — a G1-2 topic paper's oral keeps only the tasks the ticked pages can feed:
 * reading words, a passage or a dialogue always; the poem or story listening task only when the
 * pages print one; never the fixed speaking themes (likes, mother, holidays, family, friend, project).
 */
const { pagesOnly, hasPoemOrStory } = require('../../../bot/shared/services/assessment/topics/oral-pages-only');
const { oralFor, writeTopicOral } = require('../../../bot/shared/services/assessment/topics/topic-oral');

const ids = (o) => o.tasks.map((t) => t.id);
const sum = (o) => o.tasks.reduce((n, t) => n + t.marks, 0);

describe('hasPoemOrStory', () => {
  test.each([
    ['نظم: پیارے بچو', true], ['کہانی — ایک لومڑی', true], ['A poem about rain', true], ['Story time: The fox', true],
    ['Rhyme: Twinkle', true], ['ا ب پ ت — حروف', false], ['Count the apples: 1 2 3', false], ['', false], [null, false],
  ])('%s → %s', (text, want) => {
    expect(hasPoemOrStory(text)).toBe(want);
  });
});

describe('pagesOnly', () => {
  test('G1 Urdu without a poem: read words only, marks 10', () => {
    const o = pagesOnly(oralFor({ grade: 1, subject: 'urdu' }), 'ا ب پ ت');
    expect(ids(o)).toEqual(['read_words']);
    expect(o.marks).toBe(10);
  });

  test('G1 Urdu with a poem on the pages keeps the poem task, still no speaking', () => {
    const o = pagesOnly(oralFor({ grade: 1, subject: 'urdu' }), 'نظم ہمارا گھر');
    expect(ids(o)).toEqual(['read_words', 'poem']);
    expect(o.marks).toBe(sum(o));
    expect(o.marks).toBe(15);
  });

  test.each([[1, 'english'], [2, 'english'], [1, 'urdu'], [2, 'urdu']])('G%i %s never keeps a speaking task', (grade, subject) => {
    for (const pages of ['plain words', 'a poem and a story']) {
      const o = pagesOnly(oralFor({ grade, subject }), pages);
      expect(o.tasks.some((t) => t.kind === 'speaking')).toBe(false);
      expect(o.marks).toBe(sum(o));
    }
  });

  test('G2 Urdu without a poem keeps the dialogue only', () => {
    expect(ids(pagesOnly(oralFor({ grade: 2, subject: 'urdu' }), 'سبق'))).toEqual(['dialogue']);
  });

  test('a kept listening task is told to use the pages\' own poem or story, never a new one', () => {
    const o = pagesOnly(oralFor({ grade: 1, subject: 'english' }), 'Story: The red hen');
    const listening = o.tasks.find((t) => t.kind === 'listening');
    expect(listening.ask).toMatch(/printed on these pages/i);
    expect(listening.ask).toMatch(/never write a new one/i);
  });

  test('the early pattern itself is untouched', () => {
    const before = JSON.stringify(oralFor({ grade: 1, subject: 'urdu' }));
    pagesOnly(oralFor({ grade: 1, subject: 'urdu' }), 'نظم');
    expect(JSON.stringify(oralFor({ grade: 1, subject: 'urdu' }))).toBe(before);
  });

  test('nothing left → null', () => {
    expect(pagesOnly({ tasks: [{ id: 's', kind: 'speaking', marks: 5, rubric: [] }] }, 'x')).toBeNull();
    expect(pagesOnly(null, 'x')).toBeNull();
  });
});

describe('writeTopicOral on G1-2 uses the pages-only oral', () => {
  const deps = () => {
    const calls = [];
    return {
      calls,
      family: 'eng',
      patternModel: () => ({ model: 'm', job: 'assessment.generate' }),
      resolveModelForJob: () => ({ model: 'own' }),
      sectionMessages: ({ user }) => [{ role: 'system', content: '' }, { role: 'user', content: user }],
      writeSection: jest.fn(async ({ messages }) => {
        calls.push(messages[1].content);
        return { tree: { oral: [{ id: 'read_words', script: '', items: Array.from({ length: 10 }, (_, i) => ({ ask: `لفظ${i}` })) }] } };
      }),
      logToFile: jest.fn(),
    };
  };

  test('G1 Urdu pp 11-12 style pages: one read-words task, 10 marks, no likes/mother/project in the prompt', async () => {
    const d = deps();
    const got = await writeTopicOral({ grade: 1, subject: 'urdu', pageContent: 'ا ب پ ت ٹ' }, d);
    expect(ids(got)).toEqual(['read_words']);
    expect(got.marks).toBe(10);
    expect(d.calls[0]).not.toMatch(/likes|mother|project/);
  });

  test('G3 is unchanged: speaking stays', async () => {
    const o = oralFor({ grade: 3, subject: 'english' });
    expect(o.tasks.some((t) => t.kind === 'speaking')).toBe(true);
  });
});
