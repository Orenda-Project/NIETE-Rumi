/**
 * bd-snkn32.17 — the book pages of a grades 1–5 Make my own, end to end through the bot: the source names the day's
 * pages from the catalogue, the request checks her range against them and stores it in her answers (JSONB, no new
 * column), the rewrite is told to teach those pages, and her printed plan names them.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createK5Source } = require('../../bot/shared/services/lp-k5-own-source');
const { createOwnService } = require('../../bot/shared/services/lp612-own.service');
const { k5Messages } = require('../../bot/shared/services/lp-k5-own');
const { renderK5Own } = require('../../bot/shared/services/lp-k5-own-render');

const LESSON = 'grade_1_english_ch1_seg2';
const ANSWERS = { size: 'over70', resources: ['board'], level: 'behind', way: 'tarl', note: '' };
const SCRIPT = { goal: 'g', meta: { day: 2, topic: 'Meet Pinky' }, hook: { a: 'h' }, iDo: { steps: [{ say: 's' }] }, weDo: { action: 'w' }, youDo: { action: 'y' }, wrap: { homework: ['x'] } };

describe('the source names the day\'s own pages', () => {
  const book = { grade: 1, subject_key: 'english', subject: 'English', language: 'en' };
  const deps = (lesson) => ({
    lessonById: () => ({ lesson: { lesson_id: LESSON, lp_type: 'content', ...lesson }, book }),
    currentAsset: async () => ({ version_stamp: 'v', content_hash: 'h' }),
    resolveSlideScript: async () => ({ slideScript: SCRIPT }),
  });

  it('from the catalogue row', async () => {
    const s = createK5Source(deps({ pages: [3, 4] }));
    expect((await s.k5Lesson(LESSON)).pages).toEqual({ start: 3, end: 4 });
    expect((await s.loadK5(LESSON)).pages).toEqual({ start: 3, end: 4 });
  });

  it('and leaves them out when the row has none', async () => {
    expect(await createK5Source(deps({})).k5Lesson(LESSON)).not.toHaveProperty('pages');
  });
});

function service(lesson = { lessonId: LESSON, lang: 'en', grade: 1, subject: 'english', pages: { start: 3, end: 4 } }) {
  const inserts = [];
  const svc = createOwnService({
    templateVersion: () => 'v9.1',
    segmentExists: jest.fn(),
    readStoredDoc: jest.fn(),
    requestParent: jest.fn(),
    k5Lesson: jest.fn(async () => lesson),
    insertOwn: jest.fn(async (row) => { inserts.push(row); return { id: 'own-1' }; }),
    patchOwn: jest.fn(),
    queueJob: jest.fn(async () => {}),
    selectOwn: jest.fn(),
    log: jest.fn(),
  });
  return { svc, inserts };
}

describe('the request keeps her checked range in her answers', () => {
  it('extended to the next day: stored as whole numbers', async () => {
    const { svc, inserts } = service();
    const out = await svc.requestOwn({ userId: 'u1', lessonId: LESSON, answers: { ...ANSWERS, pages: { start: '3', end: '6' } } });
    expect(out.outcome).toBe('queued');
    expect(inserts[0].answers.pages).toEqual({ start: 3, end: 6 });
  });

  it('no range, or the day\'s own: nothing extra stored', async () => {
    const { svc, inserts } = service();
    await svc.requestOwn({ userId: 'u1', lessonId: LESSON, answers: ANSWERS });
    await svc.requestOwn({ userId: 'u1', lessonId: LESSON, answers: { ...ANSWERS, pages: { start: 3, end: 4 } } });
    expect(inserts[0].answers).not.toHaveProperty('pages');
    expect(inserts[1].answers).not.toHaveProperty('pages');
  });

  it('a bad range is a bad request, with no row', async () => {
    const { svc, inserts } = service();
    const out = await svc.requestOwn({ userId: 'u1', lessonId: LESSON, answers: { ...ANSWERS, pages: { start: 9, end: 4 } } });
    expect(out.outcome).toBe('bad_request');
    expect(out.error).toMatch(/pages/);
    expect((await svc.requestOwn({ userId: 'u1', lessonId: LESSON, answers: { ...ANSWERS, pages: { start: 3, end: 40 } } })).outcome).toBe('bad_request');
    expect(inserts).toHaveLength(0);
  });
});

describe('the rewrite teaches her pages; the plan names them', () => {
  it('k5Messages carries the page line only when she changed the pages', () => {
    const withPages = k5Messages({ script: SCRIPT, answers: { ...ANSWERS, resources: ['textbook'], pages: { start: 3, end: 6 } }, lang: 'en', grade: 1, subject: 'english', dayPages: { start: 3, end: 4 } });
    expect(withPages[1].content).toContain('pages 3-6');
    const without = k5Messages({ script: SCRIPT, answers: { ...ANSWERS, resources: ['textbook'] }, lang: 'en', grade: 1, subject: 'english' });
    expect(without[1].content).not.toMatch(/Book pages/);
  });

  it('her printed plan shows her pages (Urdu digits in an Urdu book)', () => {
    expect(renderK5Own(SCRIPT, { lang: 'en', grade: 1, subject: 'english', pages: { start: 3, end: 6 } })).toContain('p.3-6');
    expect(renderK5Own(SCRIPT, { lang: 'en', grade: 1, subject: 'english', pages: { start: 3, end: 3 } })).toContain('p.3<');
    expect(renderK5Own(SCRIPT, { lang: 'ur', grade: 1, subject: 'urdu', pages: { start: 3, end: 6 } })).toContain('ص ۳-۶');
    expect(renderK5Own(SCRIPT, { lang: 'en', grade: 1, subject: 'english' })).not.toContain('class="pg"');
  });
});

describe('the job passes the pages on', () => {
  const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
  const run = async (answers) => {
    const deps = {
      claimOwn: jest.fn(async () => ({ id: 'own-1', user_id: 'u1', lesson_id: LESSON, lang: 'en', template_version: 'k5_own_v1', status: 'authoring', answers })),
      loadSegment: jest.fn(), readStoredDoc: jest.fn(), revise: jest.fn(), render: jest.fn(), readFile: jest.fn(),
      loadK5: jest.fn(async () => ({ script: SCRIPT, lang: 'en', grade: 1, subject: 'english', subjectName: 'English', pages: { start: 3, end: 4 } })),
      rewriteK5: jest.fn(async () => ({ script: SCRIPT, model: 'm' })),
      renderK5: jest.fn(async () => Buffer.from('%PDF')),
      upload: jest.fn(async () => {}), patchOwn: jest.fn(async () => {}), sleep: jest.fn(), now: () => 0, log: jest.fn(),
    };
    await createOwnWorker(deps).process({ ownId: 'own-1' });
    return deps;
  };

  it('her pages to the rewrite (with the day\'s) and to the print', async () => {
    const d = await run({ ...ANSWERS, pages: { start: 3, end: 6 } });
    expect(d.rewriteK5).toHaveBeenCalledWith(expect.objectContaining({ dayPages: { start: 3, end: 4 } }));
    expect(d.renderK5).toHaveBeenCalledWith(expect.objectContaining({ pages: { start: 3, end: 6 } }));
  });

  it('the day\'s own pages to the print when she kept them', async () => {
    const d = await run(ANSWERS);
    expect(d.renderK5).toHaveBeenCalledWith(expect.objectContaining({ pages: { start: 3, end: 4 } }));
  });
});
