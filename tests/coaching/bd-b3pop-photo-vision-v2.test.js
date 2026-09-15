'use strict';
/**
 * bd-b3pop.15 / .17 (D34) — the coaching vision pass v2: ONE call per photo on the existing vision model returns the FICO
 * description (same consumers as today: the scoring prompt and the report caption) AND the fidelity evidence for every
 * kind of photo, and says when an upload is not a classroom photo. processClassroomPhoto (v1) is untouched.
 * FIDELITY_VISION_PROMPT_DIR=<eval10_photo_evidence/prompts> byte-checks both prompts against the Eval 10 files.
 */
const fs = require('fs');
const path = require('path');

const mockAnalyze = jest.fn();
jest.mock('../../bot/shared/services/vision.service', () => ({ analyzeWithRetry: (...a) => mockAnalyze(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const svc = require('../../bot/shared/services/coaching/classroom-photo/photo-analysis.service');

const IMG = Buffer.from('jpeg');
const READ = {
  kind: 'board', description: 'The photo shows a whiteboard with the lesson objective.', students: '',
  learning_materials: ['textbook p.52'], student_work: '', drawings: 'a place value chart', visible_text: 'Multiply\n235 x 10',
};

beforeEach(() => mockAnalyze.mockReset());

test('v2 asks the existing vision model once: high detail, temperature 0, JSON, the observer system prompt', async () => {
  mockAnalyze.mockResolvedValue({ success: true, analysis: JSON.stringify(READ) });
  await svc.analyzeClassroomPhotoV2(IMG, 'image/jpeg');
  expect(mockAnalyze).toHaveBeenCalledTimes(1);
  const [buf, mime, opts] = mockAnalyze.mock.calls[0];
  expect(buf).toBe(IMG);
  expect(mime).toBe('image/jpeg');
  expect(opts).toEqual({
    prompt: svc.VISION_PROMPT_V2, systemPrompt: svc.VISION_SYSTEM_V2, detail: 'high', temperature: 0, maxTokens: 1500,
    responseFormat: { type: 'json_object' },
  });
  const dir = process.env.FIDELITY_VISION_PROMPT_DIR;
  if (dir) {
    expect(svc.VISION_SYSTEM_V2).toBe(fs.readFileSync(path.join(dir, 'vision_system_v2.txt'), 'utf8').replace(/\n$/, ''));
    expect(svc.VISION_PROMPT_V2).toBe(fs.readFileSync(path.join(dir, 'vision_prompt_v2.txt'), 'utf8').replace(/\n$/, ''));
  }
});

test('a reading returns the kind, the FICO description and the fidelity evidence', async () => {
  mockAnalyze.mockResolvedValue({ success: true, analysis: JSON.stringify(READ) });
  expect(await svc.analyzeClassroomPhotoV2(IMG, 'image/jpeg')).toEqual({
    kind: 'board',
    description: 'The photo shows a whiteboard with the lesson objective.',
    evidence: { kind: 'board', visible_text: 'Multiply\n235 x 10', drawings: 'a place value chart', students: '', learning_materials: ['textbook p.52'], student_work: '' },
  });
});

test('an answer cut off inside a repetition loop is repaired: the description kept, the loop collapsed', async () => {
  const cut = JSON.stringify({ ...READ, visible_text: '' }).replace('"visible_text":""}', '"visible_text":"2 3 5\\n2 3 5\\n2 3 5\\n2 3 5');
  mockAnalyze.mockResolvedValue({ success: true, analysis: cut });
  const r = await svc.analyzeClassroomPhotoV2(IMG, 'image/jpeg');
  expect(r.description).toBe(READ.description);
  expect(r.evidence.visible_text).toBe('2 3 5');
});

test('an upload that is not a classroom photo says so and carries no evidence', async () => {
  mockAnalyze.mockResolvedValue({
    success: true,
    analysis: JSON.stringify({ kind: 'not_a_classroom_photo', description: 'A screenshot of a coaching report.', students: '', learning_materials: [], student_work: '', drawings: '', visible_text: 'A celebration of your teaching' }),
  });
  expect(await svc.analyzeClassroomPhotoV2(IMG, 'image/jpeg')).toEqual({ kind: 'not_a_classroom_photo', description: 'A screenshot of a coaching report.', evidence: null });
});

test("a failed call, a thrown error or an answer that is not JSON returns null (the caller falls back to today's pass)", async () => {
  mockAnalyze.mockResolvedValue({ success: false, error: 'boom' });
  expect(await svc.analyzeClassroomPhotoV2(IMG, 'image/jpeg')).toBe(null);
  mockAnalyze.mockResolvedValue({ success: true, analysis: 'I cannot help with that.' });
  expect(await svc.analyzeClassroomPhotoV2(IMG, 'image/jpeg')).toBe(null);
  mockAnalyze.mockRejectedValue(new Error('network'));
  expect(await svc.analyzeClassroomPhotoV2(IMG, 'image/jpeg')).toBe(null);
});

test("today's v1 pass is unchanged: the framework prompt, low detail, a plain string back", async () => {
  mockAnalyze.mockResolvedValue({ success: true, analysis: 'The board shows the objective.' });
  expect(await svc.processClassroomPhoto(IMG, 'image/jpeg', 'fico')).toBe('The board shows the objective.');
  expect(mockAnalyze.mock.calls[0][2]).toEqual({ prompt: svc.buildFrameworkVisionPrompt('fico'), detail: 'low' });
});
