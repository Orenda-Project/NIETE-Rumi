'use strict';
/**
 * bd-97daxo.16 — an LP-born quiz on a Gilgit-Baltistan lesson takes its subject from the lesson, never the model.
 *
 * catalogSubject() falls back to the served lesson id when the caller has no subject; it read only ICT's
 * grade_<n>_<subject>_ch<m>… ids, so on a GB lesson (gb_g5_science_ch3_seg9) the model's reading stood. A Science
 * lesson the model called Maths was then labelled Maths for the teacher and the children.
 *
 * Mocked at the boundary: the LLM client (completeJson), supabase, logging. The digest runs for real.
 */

jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');

const SLIDE_SCRIPT = {
  meta: { grade: 5, topic: 'Parts of a plant', language: 'en' },
  goal: 'Name the parts of a plant and say what each part does.',
  sloFull: 'Students will name the root, stem, leaf and flower and say what each one does.',
  bloom: 'understand',
  iDo: { keyFact: 'Roots take in water; leaves make food.' },
  youDo: { problems: [{ prompt: 'Which part of the plant makes food?' }] },
  wrap: { keyFacts: ['Roots take in water.', 'Leaves make food.'] },
};

/** The model misreads the lesson as Maths. */
const MODEL_JSON = {
  topic: 'Parts of a plant',
  topic_as_taught: 'Parts of a plant',
  subject: 'maths',
  grade_band: '3-5',
  language_of_instruction: 'en',
  confidence: 0.8,
  slos: [{
    id: 'S1', statement: 'Name the parts of a plant.', statement_en: 'Name the parts of a plant.',
    statement_ur: 'پودے کے حصوں کے نام بتانا۔', evidence_quote: 'Roots take in water', taught_level: 'recall',
  }],
  key_terms: [], examples_used: [], misconceptions_surfaced: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  completeJson.mockResolvedValue({ json: MODEL_JSON, model: 'test-model', costUsd: 0.001, latencyMs: 10 });
});

describe('catalog subject from a GB lesson id', () => {
  it.each([
    ['gb_g5_science_ch3_seg9', 'science'],
    ['gb_g2_english_chR4_seg902', 'english'],
    ['nbf_snc_grade_2_urdu.c07.s005', 'urdu'],
  ])('%s → %s, and the model\'s reading is kept only for the record', async (lessonId, want) => {
    const { digest } = await LpDigest.run({ slideScript: SLIDE_SCRIPT, language: 'en', grade: 5, subject: null, lessonId });
    expect(digest.subject).toBe(want);
    expect(digest.subject_read).toBe('maths');
    expect(digest.subject_conflict).toBe(true);
  });

  it('unchanged: an ICT lesson id still names its subject', async () => {
    const { digest } = await LpDigest.run({ slideScript: SLIDE_SCRIPT, language: 'en', grade: 4, subject: null, lessonId: 'grade_4_general_science_ch2_seg1' });
    expect(digest.subject).toBe('science');
  });
});
