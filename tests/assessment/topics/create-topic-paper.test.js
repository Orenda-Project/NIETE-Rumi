/**
 * Task 6 — POST /api/internal/assessment/create with `topicIds` (plain path).
 * All of the chapter's topics ticked = the whole chapter, exactly today's request (Amena's ruling).
 * A subset = pages are the resolved ranges, no chapter number, paper_kind 'topic', scope saved on the job.
 */
const KEY = 'topic-create-key';
let router;
let created;
let listChapterTopics;

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

const topic = (n, pages, code) => ({
  topicId: `3-english-4-t${n}`, grade: 3, subject: 'english', chapterNumber: 4, chapterTitle: 'Ch',
  name: `Topic ${n}`, heading: 'Vocabulary & grammar', headingOrder: 1, sortOrder: n, pages,
  sloCodes: [code], sloDescriptions: [`Skill ${n}`], days: [n], isCurrent: true,
});
const TOPICS = [topic(1, [58, 59], 'E-1'), topic(2, [60, 61], 'E-2'), topic(3, [90, 91], 'E-3')];
const BASE = { userId: 'teacher-1', grade: 3, subject: 'english', chapterNumbers: [4], questionCount: 6 };

beforeEach(() => {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = KEY;
  created = null;
  listChapterTopics = jest.fn(async () => TOPICS);
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
  jest.doMock('../../../bot/shared/services/assessment/assessment-browse.service', () => ({
    bookFor: jest.fn(async () => ({ id: 'book-1', total_pages: 120 })),
    listChapters: jest.fn(async () => [{ chapter_number: 4, chapter_title: 'Ch', page_start: 58, page_end: 95 }]),
  }));
  jest.doMock('../../../bot/shared/services/assessment/assessment-request.service', () => ({
    createAndQueue: jest.fn(async (args) => { created = args; return { requestId: 'req-1' }; }),
  }));
  jest.doMock('../../../bot/shared/services/assessment/topics/topics.repo', () => ({
    ...jest.requireActual('../../../bot/shared/services/assessment/topics/topics.repo'),
    listChapterTopics,
  }));
  router = require('../../../bot/shared/routes/internal-api.routes');
});

afterEach(() => {
  delete process.env.INTERNAL_API_KEY;
  jest.resetModules();
});

describe('create with topicIds', () => {
  test('every topic of the chapter ticked: the stored request is the one without topicIds', async () => {
    const plain = await invoke('/assessment/create', BASE);
    const plainArgs = created;
    created = null;
    const all = await invoke('/assessment/create', { ...BASE, topicIds: TOPICS.map((t) => t.topicId) });
    expect(plain.statusCode).toBe(202);
    expect(all.statusCode).toBe(202);
    expect(created).toEqual(plainArgs);
    expect(created.chapterNumber).toBe(4);
    expect(created.pageRanges).toBe('58-95');
    expect(created.paperKind ?? 'chapter').toBe('chapter');
    expect(created.scope).toBeUndefined();
  });

  test('a subset: no chapter number, the resolved ranges, kind topic, scope saved', async () => {
    const { statusCode } = await invoke('/assessment/create', { ...BASE, topicIds: [TOPICS[0].topicId, TOPICS[2].topicId] });
    expect(statusCode).toBe(202);
    expect(created.chapterNumber).toBeNull();
    expect(created.pageRanges).toBe('58-59, 90-91');
    expect(created.paperKind).toBe('topic');
    expect(created.scope).toEqual({
      kind: 'topics',
      topicIds: [TOPICS[0].topicId, TOPICS[2].topicId],
      topics: [
        { topicId: TOPICS[0].topicId, name: TOPICS[0].name },
        { topicId: TOPICS[2].topicId, name: TOPICS[2].name },
      ],
      slos: [
        { code: 'E-1', description: 'Skill 1', topicId: TOPICS[0].topicId, topicName: 'Topic 1' },
        { code: 'E-3', description: 'Skill 3', topicId: TOPICS[2].topicId, topicName: 'Topic 3' },
      ],
    });
  });

  test('topicIds with two chapters: 400, nothing queued', async () => {
    const r = await invoke('/assessment/create', { ...BASE, chapterNumbers: [4, 5], topicIds: [TOPICS[0].topicId] });
    expect(r.statusCode).toBe(400);
    expect(r.payload.error).toBe('Topics belong to one chapter. Pick one chapter.');
    expect(created).toBeNull();
  });

  test('an unknown id: 400, nothing queued', async () => {
    const r = await invoke('/assessment/create', { ...BASE, topicIds: [TOPICS[0].topicId, 'nope'] });
    expect(r.statusCode).toBe(400);
    expect(r.payload.error).toBe('One of those topics is not in this chapter.');
    expect(created).toBeNull();
  });

  test('a subset with no pages: 400, nothing queued', async () => {
    listChapterTopics.mockResolvedValue([{ ...TOPICS[0], pages: [] }, TOPICS[1]]);
    const r = await invoke('/assessment/create', { ...BASE, topicIds: [TOPICS[0].topicId] });
    expect(r.statusCode).toBe(400);
    expect(r.payload.error).toBe('We do not have the pages for those topics yet.');
    expect(created).toBeNull();
  });

  test('an empty list is no topic scope', async () => {
    const r = await invoke('/assessment/create', { ...BASE, topicIds: [] });
    expect(r.statusCode).toBe(202);
    expect(created.chapterNumber).toBe(4);
    expect(created.scope).toBeUndefined();
  });
});

describe('createAndQueue with a topic scope', () => {
  test('the job carries scope and the row carries paper_kind topic; a chapter job gains neither', async () => {
    jest.resetModules();
    const insert = jest.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) }));
    const queueJob = jest.fn(async () => true);
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => ({ insert })) }));
    jest.doMock('../../../bot/shared/services/queue', () => ({ queueJob }));
    const Svc = jest.requireActual('../../../bot/shared/services/assessment/assessment-request.service');
    const spec = { userId: 'u', surface: 'portal', grade: 3, subject: 'english', textbookId: 'b', questionCount: 6 };
    const scope = { kind: 'topics', topicIds: ['a'], slos: [] };

    await Svc.createAndQueue({ ...spec, chapterNumber: null, pageRanges: '58-59', paperKind: 'topic', scope });
    expect(insert.mock.calls[0][0].paper_kind).toBe('topic');
    expect(queueJob.mock.calls[0][2].scope).toEqual(scope);

    await Svc.createAndQueue({ ...spec, chapterNumber: 4, pageRanges: '58-95' });
    expect(insert.mock.calls[1][0]).not.toHaveProperty('paper_kind');
    expect(queueJob.mock.calls[1][2]).not.toHaveProperty('scope');
  });
});
