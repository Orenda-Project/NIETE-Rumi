'use strict';
/**
 * Grade 1-5 A/B group A, chapter 3-10, with no August version: the teacher is deliberately sent
 * nothing (a policy, not a fault). The ask still leaves its lifecycle row — failed, NOT_ELIGIBLE —
 * so "she asked and got nothing" is countable rather than invisible; the download row names it.
 *
 * Its own file: the A/B service caches its app_settings flag per module, so this needs a fresh
 * module registry. Same harness as v8-path.test.js: real endpoint, real delivery, real writer.
 */

const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const mockDb = createMemorySupabase();
const mockRedis = createMemoryRedis();
jest.mock('../../bot/shared/config/supabase', () => mockDb);
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((k) => `https://s3.example/bucket/${k}`),
  getPresignedUrl: jest.fn(async (u) => `${u}?sig=1`),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocumentByLink: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.DOC' }] }),
  sendVoicenoteFromR2Key: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => undefined }));
jest.mock('../../bot/shared/services/nudges/lp-coaching-ask.service', () => ({ onLessonDelivered: jest.fn() }));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const V8Catalog = require('../../bot/shared/services/lp-v8-catalog.service');
const EP = require('../../bot/shared/routes/pakistan-lp-endpoint');

const LESSON = 'grade_2_maths_ch3_seg1';
const CATALOG = {
  catalog_version: 'v8',
  counts: { books: 1, chapters: 1, lessons: 1 },
  books: [{
    stem: 'grade_2_maths', grade: 2, subject: 'Maths', subject_key: 'maths', rtl: false,
    chapters: [{
      number: 3, title: 'Shapes', title_short: 'Shapes',
      lessons: [{
        lesson_id: LESSON, segment_index: 1, lp_type: 'content', day_label: 'Day 1', section: 'Start',
        section_short: 'Start', topic: 'Circles', topic_short: 'Circles', pages: [1], pages_label: 'p.1',
        row: { title: 'Start', description: 'Day 1', metadata: 'Circles · p.1' },
      }],
    }],
  }],
};
// A current (non-August) asset exists — group A must still get nothing.
const CURRENT_ASSET = {
  id: 'asset-1', lesson_id: LESSON, asset_kind: 'lesson', catalog_version: 'v8',
  r2_key: `lp-cache/v8/${LESSON}/cc.pdf`, content_hash: 'cc', version_stamp: 'v8-1', is_current: true,
};

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

test('group A with no August version: nothing sent, one FAILED lifecycle row (NOT_ELIGIBLE), the download row names it', async () => {
  process.env.LP_LIFECYCLE_PATHS = 'niete_v8_segment';
  process.env.REGION = 'niete';
  mockDb.reset({
    users: [{ id: 'user-a', phone_number: '923001110000', preferred_language: 'en', school_id: 'school-a' }],
    app_settings: [{ key: 'ab_lp_ch310_enabled', value: true }],
    niete_lp_ab_assignment: [{ school_id: 'school-a', ab_group: 'A' }],
    niete_lp_assets: [CURRENT_ASSET],
    niete_lp_downloads: [], lesson_plans: [], lesson_plan_requests: [],
  });
  await EP.handlePakistanLpDataExchange(`user-a:pakistan-lp:${Date.now()}`, 'SELECT_LESSON', { step: 'lesson', lesson: `V8-${LESSON}` });
  for (let i = 0; i < 60; i += 1) await new Promise((r) => setImmediate(r));

  expect(WhatsAppService.sendDocumentByLink).not.toHaveBeenCalled();
  const asks = mockDb.rows('lesson_plan_requests');
  expect(asks).toHaveLength(1);
  expect(asks[0]).toEqual(expect.objectContaining({
    status: 'failed', error_code: 'NOT_ELIGIBLE', source: 'niete_v8_segment', grade: 2, artifact_ref: LESSON, generated_at: null,
  }));
  expect(mockDb.rows('niete_lp_downloads')[0]).toEqual(expect.objectContaining({ status: 'failed', request_id: asks[0].id }));
  delete process.env.LP_LIFECYCLE_PATHS;
});
