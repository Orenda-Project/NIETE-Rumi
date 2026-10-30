/**
 * assessment_topics is keyed by curriculum too (V1.8.6, bd-97daxo.4).
 *
 * Chapter 3 of GB's Grade 3 English book is not chapter 3 of ICT's. A topic list read without the
 * curriculum would hand an ICT teacher GB's topics (or the reverse) the day GB's topics load.
 */

jest.mock('../../../bot/shared/config/supabase', () => {
  const { createMemorySupabase } = require('../../fixtures/memory-supabase');
  return createMemorySupabase({});
});
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const db = require('../../../bot/shared/config/supabase');
const { listChapterTopics } = require('../../../bot/shared/services/assessment/topics/topics.repo');

const topic = (id, curriculum, sort) => ({
  topic_id: id, curriculum, grade: 3, subject: 'english', chapter_number: 3, chapter_title: 'Ch 3',
  name: id, heading: null, heading_order: 1, sort_order: sort, pages: [1], slo_codes: [], slo_descriptions: [],
  days: [1], is_current: true, matrix_version: 'v1',
});

beforeEach(() => db.reset({
  assessment_topics: [topic('ict-a', 'ict', 1), topic('ict-b', 'ict', 2), topic('nbf_snc_a', 'nbf_snc', 1)],
}));

it("an ICT read (the default) returns ICT's topics only — exactly today's list", async () => {
  expect((await listChapterTopics(3, 'english', 3)).map((t) => t.topicId)).toEqual(['ict-a', 'ict-b']);
  expect((await listChapterTopics(3, 'english', 3, { curriculum: 'ict' })).map((t) => t.topicId)).toEqual(['ict-a', 'ict-b']);
});

it("a GB read returns GB's topics only", async () => {
  expect((await listChapterTopics(3, 'english', 3, { curriculum: 'nbf_snc' })).map((t) => t.topicId)).toEqual(['nbf_snc_a']);
});
