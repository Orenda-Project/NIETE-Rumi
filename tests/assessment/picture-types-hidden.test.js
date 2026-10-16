/**
 * The two question types that only work with a picture printed on the paper are no longer offered.
 *
 * The paper carries no pictures: the user prompt tells the model so, and the renderer has nothing
 * to draw one with. "Label the Diagram" and "Picture Description" were still offered anyway, so a
 * teacher who ticked them got "look at the picture and…" printed under an empty space, on a paper
 * already photocopied for a class of forty.
 *
 * Only these two go. Mind Map, Flow Chart and Graphs & Geometric Problems stay, because the child
 * draws those on the answer sheet from text the question gives (the prompt says so, see
 * draw-it-prompt.test.js).
 *
 * Nothing stored changes: the catalogue still knows both types, so a paper made before this
 * prints, re-renders and revises exactly as it did.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const QuestionTypes = require('../../bot/shared/services/assessment/question-types');

const idsFor = (subject, grade) => QuestionTypes.forSubject(subject, grade).map((t) => t.id);

describe('forSubject', () => {
  test.each([4, 5])('hides Label the Diagram for science G%i', (grade) => {
    expect(idsFor('science', grade)).not.toContain('Label the Diagram');
  });

  test.each([
    ['english', 3], ['english', 4], ['english', 5],
    ['urdu', 3], ['urdu', 4], ['urdu', 5],
  ])('hides Picture Description for %s G%i', (subject, grade) => {
    expect(idsFor(subject, grade)).not.toContain('Picture Description');
  });

  test('keeps the types the child draws from text: Mind Map, Flow Chart, Graphs & Geometric Problems', () => {
    expect(idsFor('science', 5)).toEqual(expect.arrayContaining(['Mind Map', 'Flow Chart']));
    expect(idsFor('maths', 5)).toContain('Graphs & Geometric Problems');
    expect(idsFor('social_studies', 5)).toEqual(expect.arrayContaining(['Mind Map', 'Flow Chart']));
  });

  test('removes nothing else: every other catalogue type is still offered', () => {
    const { CATALOGUE } = QuestionTypes;
    const science = [...CATALOGUE.science.objective, ...CATALOGUE.science.subjective]
      .filter((id) => id !== 'Label the Diagram');
    expect(idsFor('science', 5)).toEqual(science);
    const english35 = [...CATALOGUE.english.objective, ...CATALOGUE.english.subjectiveByGrade['3-5']]
      .filter((id) => id !== 'Picture Description');
    expect(idsFor('english', 5)).toEqual(english35);
  });

  test('a paper that already holds one of them still knows its category', () => {
    expect(QuestionTypes.categoryOf('Label the Diagram', 'science', 5)).toBe('subjective');
    expect(QuestionTypes.categoryOf('Picture Description', 'urdu', 5)).toBe('subjective');
  });
});

describe('POST /api/internal/assessment/create', () => {
  const KEY = 'picture-types-internal-key';
  let router;
  let created;

  function findRoute(r, method, p) {
    for (const layer of r.stack) {
      if (layer.route && (layer.route.methods || {})[method] && layer.route.path === p) {
        return layer.route.stack.map((s) => s.handle);
      }
    }
    return null;
  }

  async function invoke(p, body) {
    const stack = findRoute(router, 'post', p);
    const req = { headers: { 'x-api-key': KEY }, body, ip: '127.0.0.1', method: 'POST', path: p };
    let statusCode = 200;
    let payload = null;
    const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
    let advanced = true;
    for (const handler of stack) {
      if (!advanced) break;
      advanced = false;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const maybe = handler(req, res, () => { advanced = true; resolve(); });
        if (maybe && typeof maybe.then === 'function') maybe.then(() => resolve(), () => resolve());
        else if (!advanced) resolve();
      });
    }
    return { statusCode, payload };
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = KEY;
    created = null;
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../bot/shared/services/assessment/assessment-browse.service', () => ({
      bookFor: jest.fn(async () => ({ id: 'book-1', total_pages: 60 })),
      listChapters: jest.fn(async () => [{ chapter_number: 1, chapter_title: 'One', page_start: 2, page_end: 10 }]),
    }));
    jest.doMock('../../bot/shared/services/assessment/assessment-request.service', () => ({
      createAndQueue: jest.fn(async (args) => { created = args; return { requestId: 'req-1' }; }),
    }));
    router = require('../../bot/shared/routes/internal-api.routes');
  });

  afterEach(() => {
    delete process.env.INTERNAL_API_KEY;
    jest.resetModules();
  });

  const BASE = { userId: 'teacher-1', grade: 5, subject: 'science', chapterNumbers: [1], questionCount: 6 };

  test('400s Label the Diagram, a form loaded before the change still posting it', async () => {
    const { statusCode, payload } = await invoke('/assessment/create', {
      ...BASE,
      questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }, { id: 'Label the Diagram', count: 2, category: 'subjective' }],
    });
    expect(statusCode).toBe(400);
    expect(payload.error).toBe('Label the Diagram is not a question type for this subject.');
    expect(created).toBeNull();
  });

  test('still accepts a paper of the types that remain', async () => {
    const { statusCode } = await invoke('/assessment/create', {
      ...BASE,
      questionTypes: [{ id: 'MCQs', count: 4, category: 'objective' }, { id: 'Flow Chart', count: 2, category: 'subjective' }],
    });
    expect(statusCode).toBe(202);
    expect(created.questionTypes.map((t) => t.id)).toEqual(['MCQs', 'Flow Chart']);
  });
});

describe('papers made before the change', () => {
  const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
  const exam = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden', 'exam.science.json'), 'utf8'));

  test('renderPaper still prints a stored Label the Diagram question', () => {
    const html = Renderer.renderPaper({ examJson: exam, grade: 5, subject: 'science', answerLines: true });
    expect(html).toContain('<h3 class="type">Label the Diagram</h3>');
    expect(html).toContain('Label the parts of the flower shown: petal, sepal, stem.');
  });

  test('renderAnswerKey still prints its answer', () => {
    const html = Renderer.renderAnswerKey({ examJson: exam, grade: 5, subject: 'science' });
    expect(html).toContain('Petal, sepal, stem.');
  });
});
