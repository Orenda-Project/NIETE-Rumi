'use strict';
/**
 * Queue #71 — Digital Coaching "from the library" for a GB lesson.
 *
 * A GB lesson (an nbf_snc segment) is served in the app the way an ICT 6-12 lesson is (asked for, written once,
 * kept), so a coaching pick of one is { segmentId, lang } and resolves to its WRITTEN PDF. Prod, 9 Nov: the pick
 * could not resolve at all — the 6-12 resolver read only niete_lp612_renders, and the Grades 1-5 resolver only
 * knows ICT's catalogue ids — so a GB teacher's library pick ended "plan not ready / not found" even for a written
 * lesson. GB's written plans live in niete_gb_lp_renders, at GB's template version, in the book's language.
 */
const { createMemorySupabase } = require('../fixtures/memory-supabase');
const Library = require('../../bot/shared/services/coaching/portal-lesson-plan-library.service');

const GB_SEG = 'nbf_snc_grade_3_urdu.c02.s004';
const db = createMemorySupabase();
const deps = { supabase: db, templateVersion: () => 'v9.1', gbTemplateVersion: () => 'gb_k5_v10' };

beforeEach(() => {
  db.reset({
    niete_lp612_renders: [
      { segment_id: 'g9_phy.c02.p010', lang: 'en', template_version: 'v9.1', status: 'ready', r2_key: 'lp612/v9.1/en/g9_phy.c02.p010.pdf' },
    ],
    niete_gb_lp_renders: [
      { segment_id: GB_SEG, lang: 'ur', template_version: 'gb_k5_v10', status: 'ready', r2_key: `gb-lp/gb_k5_v10/ur/${GB_SEG}.pdf` },
      { segment_id: 'nbf_snc_grade_3_urdu.c02.s005', lang: 'ur', template_version: 'gb_k5_v10', status: 'authoring', r2_key: null },
    ],
  });
});

test("a written GB lesson resolves to GB's own PDF, whatever language the app browsed in", async () => {
  expect(await Library.readyRender({ segmentId: GB_SEG, lang: 'en' }, deps)).toEqual({ r2Key: `gb-lp/gb_k5_v10/ur/${GB_SEG}.pdf` });
});

test('a GB lesson still being written is not ready', async () => {
  expect(await Library.readyRender({ segmentId: 'nbf_snc_grade_3_urdu.c02.s005', lang: 'en' }, deps)).toBeNull();
});

test('an ICT 6-12 lesson resolves exactly as before', async () => {
  expect(await Library.readyRender({ segmentId: 'g9_phy.c02.p010', lang: 'en' }, deps)).toEqual({ r2Key: 'lp612/v9.1/en/g9_phy.c02.p010.pdf' });
  expect(await Library.readyRender({ segmentId: 'g9_phy.c02.p010', lang: 'ur' }, deps)).toBeNull();
});
