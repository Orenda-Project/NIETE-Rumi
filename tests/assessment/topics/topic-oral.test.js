/**
 * bd-6clakk.11 — the oral part of an English or Urdu topic paper, to FDE's own criteria:
 * G1-2 reuse the early pattern's oral; G3-5 carry the FDE model papers' oral tasks.
 */
const { oralFor, writeTopicOral } = require('../../../bot/shared/services/assessment/topics/topic-oral');
const { makeOral } = require('../../../bot/shared/services/assessment/patterns/early/chrome');
const G1 = require('../../../bot/shared/services/assessment/patterns/fde-g1-2026');
const G2 = require('../../../bot/shared/services/assessment/patterns/fde-g2-2026');

const shape = (o) => o.tasks.map((t) => [t.id, t.marks]);

describe('oralFor', () => {
  test.each([[1, 'english', G1], [1, 'urdu', G1], [2, 'english', G2], [2, 'Urdu', G2]])(
    'G%i %s is the early pattern oral', (grade, subject, P) => {
      expect(oralFor({ grade, subject })).toEqual(P.subjects[subject.toLowerCase()].oral);
    },
  );

  test('G3 English is FDE listening 5, speaking 5, read aloud 10', () => {
    const o = oralFor({ grade: 3, subject: 'english' });
    expect(shape(o)).toEqual([['listening', 5], ['speaking', 5], ['read_aloud', 10]]);
    expect(o.marks).toBe(20);
  });

  test.each([3, 4, 5])('G%i English and Urdu both have an oral part with a scoring per task', (grade) => {
    for (const subject of ['english', 'urdu']) {
      const o = oralFor({ grade, subject: String(grade) === '4' ? subject.toUpperCase() : subject });
      expect(o.tasks.length).toBeGreaterThan(0);
      expect(o.tasks.every((t) => ['each', 'criteria', 'bands'].includes(t.scoring))).toBe(true);
      expect(o.marks).toBe(o.tasks.reduce((n, t) => n + t.marks, 0));
    }
  });

  test('grade as a string still resolves', () => {
    expect(oralFor({ grade: '3', subject: 'english' })).toEqual(oralFor({ grade: 3, subject: 'english' }));
  });

  test.each([
    [1, 'maths'], [3, 'maths'], [5, 'general_knowledge'], [6, 'english'], [0, 'urdu'], [null, 'english'], [3, ''],
  ])('G%s %s has no oral part', (grade, subject) => {
    expect(oralFor({ grade, subject })).toBeNull();
  });

  test('no G3-5 task carries a project (FDE marks projects as their own component)', () => {
    for (const grade of [3, 4, 5]) {
      for (const subject of ['english', 'urdu']) {
        expect(oralFor({ grade, subject }).tasks.some((t) => /project/i.test(t.id))).toBe(false);
      }
    }
  });
});

describe('scoring a one-row rubric', () => {
  const task = (marks, rowMarks) => ({ id: 't', marks, rubric: [{ marks: rowMarks, en: 'x', ur: 'x' }] });

  test('a single row worth the whole task is criteria, not "5 marks each"', () => {
    expect(makeOral({ tasks: [task(5, 5)] }).tasks[0].scoring).toBe('criteria');
  });

  test('a single row worth part of the task is still each', () => {
    expect(makeOral({ tasks: [task(5, 1)] }).tasks[0].scoring).toBe('each');
  });

  test('G1-2 scorings are unchanged: every one-row rubric there is still each', () => {
    const tasks = [G1, G2].flatMap((P) => Object.values(P.subjects)).filter((s) => s.oral).flatMap((s) => s.oral.tasks);
    const oneRow = tasks.filter((t) => t.rubric.length === 1);
    expect(oneRow.length).toBeGreaterThan(5);
    expect(oneRow.every((t) => t.scoring === 'each')).toBe(true);
  });
});

describe('writeTopicOral', () => {
  const ORAL = oralFor({ grade: 3, subject: 'english' });
  const full = () => ({ oral: [
    { id: 'listening', script: 'A story.', items: [1, 2, 3, 4, 5].map((i) => ({ ask: `q${i}`, answer: `a${i}` })) },
    { id: 'speaking', script: '', items: [{ ask: 'Tell me about your food.' }, { ask: 'Why?' }, { ask: 'Who cooks?' }] },
    { id: 'read_aloud', script: 'Little pines grow tall.', items: [{ ask: 'Little pines grow tall.' }] },
  ] });
  const deps = (replies) => {
    const calls = [];
    return {
      calls,
      family: 'eng',
      patternModel: () => ({ model: 'm', job: 'assessment.generate' }),
      resolveModelForJob: () => ({ model: 'own' }),
      sectionMessages: ({ system, user }) => [{ role: 'system', content: system }, { role: 'user', content: user }],
      writeSection: jest.fn(async ({ messages }) => { calls.push(messages[1].content); return { tree: replies.shift(), usages: [{ cost: 1 }] }; }),
      logToFile: jest.fn(),
    };
  };

  test('returns the oral with its generated content, written from the ticked pages', async () => {
    const d = deps([full()]);
    const got = await writeTopicOral({ grade: 3, subject: 'english', pageContent: 'PAGE TEXT', requestId: 'r' }, d);
    expect(got.tasks).toEqual(ORAL.tasks);
    expect(got.content.map((c) => c.id)).toEqual(['listening', 'speaking', 'read_aloud']);
    expect(d.calls[0]).toContain('PAGE TEXT');
    expect(d.calls[0]).toContain('Grade 3 English');
  });

  test('re-asks once for the missing tasks and keeps what the first reply filled', async () => {
    const first = full();
    first.oral = first.oral.filter((t) => t.id !== 'read_aloud');
    const d = deps([first, full()]);
    const got = await writeTopicOral({ grade: 3, subject: 'english', pageContent: 'P' }, d);
    expect(d.writeSection).toHaveBeenCalledTimes(2);
    expect(d.calls[1]).toContain('read_aloud');
    expect(got.content.map((c) => c.id)).toEqual(['listening', 'speaking', 'read_aloud']);
  });

  test('still short after the re-ask: no oral part, and it is logged', async () => {
    const d = deps([{ oral: [] }, { oral: [] }]);
    const got = await writeTopicOral({ grade: 3, subject: 'english', pageContent: 'P' }, d);
    expect(got).toBeNull();
    expect(d.logToFile).toHaveBeenCalledWith('[assessment] topic oral dropped', expect.objectContaining({ missing: ['listening', 'speaking', 'read_aloud'] }));
  });

  test('a writer error drops the oral part, logged, rather than failing the paper', async () => {
    const d = deps([]);
    d.writeSection.mockRejectedValueOnce(new Error('boom'));
    const got = await writeTopicOral({ grade: 3, subject: 'english', pageContent: 'P' }, d);
    expect(got).toBeNull();
    expect(d.logToFile).toHaveBeenCalledWith('[assessment] topic oral dropped', expect.objectContaining({ error: 'boom' }));
  });

  test('a subject with no oral part writes nothing', async () => {
    const d = deps([]);
    expect(await writeTopicOral({ grade: 3, subject: 'maths', pageContent: 'P' }, d)).toBeNull();
    expect(d.writeSection).not.toHaveBeenCalled();
  });

  test('Urdu is asked in Urdu', async () => {
    const d = deps([{ oral: [] }, { oral: [] }]);
    await writeTopicOral({ grade: 2, subject: 'urdu', pageContent: 'P' }, d);
    expect(d.calls[0]).toContain('Write everything in Urdu');
  });
});
