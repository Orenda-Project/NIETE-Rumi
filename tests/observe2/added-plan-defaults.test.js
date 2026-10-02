/**
 * The DEFAULT collaborators of the added-plan reader and the photo-evidence reader: the other tests
 * inject theirs, so these are the only ones that prove the lazy require() paths reach the modules
 * /observe uses (the lesson-plan extraction worker, the lesson-plan classifier, the v2 photo reader).
 * The modules are replaced by path, so a wrong path fails here instead of in production.
 */
const mockWorker = {
  detectFileType: jest.fn(() => 'jpg'),
  extractText: jest.fn((buf) => Promise.resolve({ text: `read ${String(buf)}`, parser: 'vision:image' })),
  parseWithGPT4oMini: jest.fn(() => Promise.resolve({ is_lesson_plan: false })),
};
jest.mock('../../bot/workers/lesson-plan-extraction.worker', () => mockWorker);
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn((key) => Promise.resolve(Buffer.from(key.split('/').pop()))),
  uploadBuffer: jest.fn(() => Promise.resolve('https://r2.example/x')),
}));
jest.mock('../../bot/shared/services/coaching/classroom-photo/photo-analysis.service', () => ({
  analyzeClassroomPhotoV2: jest.fn(() => Promise.resolve({ ok: true, kind: 'board', exclude: null, evidence: { kind: 'board', visible_text: 'x' } })),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const { readAddedPlan, looksLikeLessonPlan } = require('../../bot/shared/services/observe/observe2/added-plan');
const { analyzeClassroomPhotoV2 } = require('../../bot/shared/services/coaching/classroom-photo/photo-analysis.service');

test('reading an added plan with no injected collaborators goes through the extraction worker /observe uses', async () => {
  const out = await readAddedPlan({ kind: 'photos', count: 2, keys: ['observe2/f/plan-1', 'observe2/f/plan-2'] });
  expect(mockWorker.detectFileType).toHaveBeenCalledTimes(2);
  expect(mockWorker.extractText.mock.calls.map((c) => [String(c[0]), c[1]])).toEqual([['plan-1', 'jpg'], ['plan-2', 'jpg']]);
  expect(out).toMatchObject({ kind: 'photos', files: 2, read: 2, text: 'read plan-1\n\nread plan-2' });
});

test('the lesson-plan check uses the worker\'s structuring call and /observe\'s classifier', async () => {
  const verdict = await looksLikeLessonPlan('x'.repeat(60));
  expect(mockWorker.parseWithGPT4oMini).toHaveBeenCalledTimes(1);
  expect(verdict).toBe(false);
});

test('the photo-evidence reader defaults to /observe\'s v2 photo reader', async () => {
  process.env.COACHING_PHOTO_VISION = 'v2';
  process.env.LP_FIDELITY_PHOTO = 'on';
  try {
    const Moments = require('../../bot/shared/services/observe/observe2/moments');
    const ev = await Moments.__photoEvidence({ id: 'f', photos: ['observe2/f/photo-1.jpg'] });
    expect(analyzeClassroomPhotoV2).toHaveBeenCalledTimes(1);
    expect(ev).toEqual([{ n: 1, kind: 'board', visible_text: 'x' }]);
  } finally {
    delete process.env.COACHING_PHOTO_VISION;
    delete process.env.LP_FIDELITY_PHOTO;
  }
});
