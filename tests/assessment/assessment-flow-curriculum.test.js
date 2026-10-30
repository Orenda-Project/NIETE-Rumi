/**
 * The WhatsApp assessment Flow and the job it queues take the teacher's curriculum (bd-97daxo.4).
 *
 * The Flow learns her curriculum once, at INIT, from users.region through the region registry,
 * and writes it into the session ONLY when it is not ICT — so an ICT session, the request row it
 * writes and the job it queues are byte-for-byte what they were. A GB session carries
 * `curriculum: 'nbf_snc'` to every screen, to the request row's textbook, and to the worker's job.
 */

const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });

jest.mock('../../bot/shared/config/supabase', () => {
  const { createMemorySupabase } = require('../fixtures/memory-supabase');
  return createMemorySupabase({});
});
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => {
  const { createMemoryRedis } = require('../fixtures/memory-supabase');
  return createMemoryRedis();
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: (...a) => mockQueueJob(...a) }));
jest.mock('../../bot/shared/config/feature-flags', () => ({
  isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
  isAssessmentEditingEnabled: jest.fn().mockResolvedValue(false),
  isAssessmentVersionsEnabled: jest.fn().mockResolvedValue(false),
  isFlagEnabled: jest.fn().mockResolvedValue(false),
}));

const db = require('../../bot/shared/config/supabase');
const redis = require('../../bot/shared/services/cache/railway-redis.service');
const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');

const TEXTBOOKS = [
  { id: 'ict-3-english', curriculum: 'ict', grade: 3, subject: 'english', total_pages: 120 },
  { id: 'ict-3-maths', curriculum: 'ict', grade: 3, subject: 'maths', total_pages: 90 },
  { id: 'nbf-3-english', curriculum: 'nbf_snc', grade: 3, subject: 'english', total_pages: 64 },
  { id: 'nbf-6-english', curriculum: 'nbf_snc', grade: 6, subject: 'english', total_pages: 50 },
];
const TOC = [
  { textbook_id: 'ict-3-english', chapter_number: 1, chapter_title: 'ICT English One', page_start: 1, page_end: 10 },
  { textbook_id: 'ict-3-maths', chapter_number: 1, chapter_title: 'ICT Maths One', page_start: 1, page_end: 12 },
  { textbook_id: 'nbf-3-english', chapter_number: 1, chapter_title: 'GB English One', page_start: 1, page_end: 8 },
];
const REGISTRY = [
  { region: 'sihala', organization: 'niete', display_name: 'Sihala', sort_order: 2, is_active: true, curriculum_key: null },
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 1, is_active: true, curriculum_key: 'nbf_snc' },
  { region: 'niete', organization: null, display_name: null, sort_order: null, is_active: true, curriculum_key: 'punjab_snc_2020' },
];
const USERS = [
  { id: 'gb-teacher', region: 'Gilgit-Baltistan' },
  { id: 'sector-teacher', region: 'Sihala' },
  { id: 'no-region', region: null },
];

beforeEach(() => {
  db.reset({ textbooks: TEXTBOOKS, textbook_toc: TOC, region_features: REGISTRY, users: USERS });
  redis.reset();
  mockQueueJob.mockClear();
  require('../../bot/shared/services/region-registry')._clearCache();
});

const token = (user) => `${user}:assessment-gen:1`;
const session = async (user) => redis.get(`assessment_gen:${token(user)}`);
const titles = (screen) => screen.data.chapters.map((c) => c.title);

async function openAndPick(user, grade, subject) {
  const init = await Endpoint.handleAssessmentGenInit(user, token(user));
  const coverage = await Endpoint.handleAssessmentGenDataExchange(user, 'CLASS', { grade: String(grade), subject }, token(user));
  return { init, coverage };
}

describe('the Flow', () => {
  it('a sector teacher: ICT grades and chapters, and a session with no curriculum key (as today)', async () => {
    const { init, coverage } = await openAndPick('sector-teacher', 3, 'english');
    expect(init.data.grades.map((g) => g.id)).toEqual(['3']);
    expect(coverage.screen).toBe('COVERAGE');
    expect(titles(coverage).join(' ')).toContain('ICT English One');
    expect(Object.keys(await session('sector-teacher'))).not.toContain('curriculum');
  });

  it('a teacher with no region is an ICT teacher', async () => {
    const { init, coverage } = await openAndPick('no-region', 3, 'english');
    expect(init.data.grades.map((g) => g.id)).toEqual(['3']);
    expect(titles(coverage).join(' ')).toContain('ICT English One');
    expect(Object.keys(await session('no-region'))).not.toContain('curriculum');
  });

  it("a GB teacher: GB's book where GB has one, ICT's elsewhere, and the session says nbf_snc", async () => {
    const { init, coverage } = await openAndPick('gb-teacher', 3, 'english');
    expect(init.data.grades.map((g) => g.id)).toEqual(['3', '6']);
    expect(titles(coverage).join(' ')).toContain('GB English One');
    expect(titles(coverage).join(' ')).not.toContain('ICT English One');
    expect((await session('gb-teacher')).curriculum).toBe('nbf_snc');

    const maths = await Endpoint.handleAssessmentGenDataExchange('gb-teacher', 'CLASS', { grade: '3', subject: 'maths' }, token('gb-teacher'));
    expect(titles(maths).join(' ')).toContain('ICT Maths One');
  });
});

describe('the request and the job', () => {
  const base = {
    grade: 3, subject: 'english', chapterNumbers: [1], chapterTitles: ['x'],
    questionCount: 10, contentSource: 'seen', outputFormat: 'pdf',
  };

  it('an ICT request names the ICT book and queues a job with no curriculum key', async () => {
    await Endpoint._internal.submit({ ...base, userId: 'sector-teacher' });
    expect(db.rows('assessment_requests')[0].textbook_id).toBe('ict-3-english');
    const job = mockQueueJob.mock.calls[0][2];
    expect(Object.keys(job)).not.toContain('curriculum');
  });

  it("a GB request names GB's book and tells the worker to read GB's pages", async () => {
    await Endpoint._internal.submit({ ...base, userId: 'gb-teacher', curriculum: 'nbf_snc' });
    expect(db.rows('assessment_requests')[0].textbook_id).toBe('nbf-3-english');
    expect(mockQueueJob.mock.calls[0][2].curriculum).toBe('nbf_snc');
  });
});
