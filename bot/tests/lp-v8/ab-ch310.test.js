/**
 * bd-5o0ay.10.1 — ICT G1-5 ch3-10 lesson-plan A/B (TDD, red first).
 *
 * Group A schools get the August v8 PDF, group B the v9 render that is current. The group is
 * the school's, from niete_lp_ab_assignment, and only while ab_lp_ch310_enabled is on. No
 * voice note for test lessons in either group. Everything else (flag off, no school, other
 * chapters) is today's delivery, untouched.
 */

const mockTables = {};
const mockInserts = {};
let mockFail = {};

function mockBuilderFor(table) {
  if (mockFail[table]) {
    const err = Promise.resolve({ data: null, error: { message: 'boom' } });
    const e = { select: () => e, eq: () => e, in: () => e, order: () => e,
      maybeSingle: () => err, then: (f, r) => err.then(f, r) };
    return e;
  }
  let rows = [...(mockTables[table] || [])];
  const b = {
    select: () => b,
    eq: (col, val) => { rows = rows.filter((r) => String(r[col]) === String(val)); return b; },
    in: (col, vals) => { rows = rows.filter((r) => vals.map(String).includes(String(r[col]))); return b; },
    order: (col, { ascending = true } = {}) => {
      rows.sort((x, y) => (x[col] < y[col] ? -1 : 1) * (ascending ? 1 : -1)); return b;
    },
    limit: () => b,
    range: (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    single: () => Promise.resolve({ data: rows[0] || null, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    insert: (payload) => {
      const row = { id: `${table}-${(mockInserts[table] || []).length + 1}`, ...payload };
      (mockInserts[table] = mockInserts[table] || []).push(row);
      const ret = { select: () => ret, single: () => Promise.resolve({ data: row, error: null }),
        then: (f, r) => Promise.resolve({ data: [row], error: null }).then(f, r) };
      return ret;
    },
    update: () => b,
    then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
  };
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn((t) => mockBuilderFor(t)) }));
jest.mock('../../shared/storage/r2', () => ({
  buildR2PublicUrl: jest.fn((key) => `https://s3.example/bucket/${key}`),
  getPresignedUrl: jest.fn(async (url) => `${url}?X-Amz-Signature=x`),
}));
const mockSends = { docs: [], voice: [] };
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendDocumentByLink: jest.fn(async (phone, url, filename) => { mockSends.docs.push({ url, filename }); return { messages: [{ id: 'w' }] }; }),
  sendMessage: jest.fn(async () => true),
  sendVoicenoteFromR2Key: jest.fn(async (phone, key) => { mockSends.voice.push(key); return true; }),
}));
jest.mock('../../shared/services/lp-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const lesson = (id, seg, type = 'content') => ({
  lesson_id: id, segment_index: seg, lp_type: type, day_label: `Day ${seg}`, section: 'S',
  section_short: 'S', topic: 'T', topic_short: 'T', pages: [1], pages_label: 'p.1',
  row: { title: 'S', description: 'D', metadata: 'M' },
});
const CATALOG = {
  catalog_version: 'v8', counts: { books: 1, chapters: 2, lessons: 4 },
  books: [{ stem: 'grade_1_urdu', grade: 1, subject: 'Urdu', subject_key: 'urdu', rtl: true,
    chapters: [
      { number: 1, title: 'C1', title_short: 'C1', lessons: [lesson('grade_1_urdu_ch1_seg2', 2)] },
      { number: 3, title: 'C3', title_short: 'C3', lessons: [
        lesson('grade_1_urdu_ch3_seg4', 4), lesson('grade_1_urdu_ch3_seg4b', 4),
        lesson('grade_1_urdu_ch3_seg995', 995, 'assessment')] },
    ] }],
};

const V8Catalog = require('../../shared/services/lp-v8-catalog.service');
const Delivery = require('../../shared/services/lp-v8-delivery.service');
const AB = require('../../shared/services/lp-ab-ch310.service');
const Browse = require('../../shared/services/lp-v8-browse.service');

const asset = (lessonId, stamp, current, kind = 'lesson') => ({
  id: `${lessonId}-${kind}-${stamp}`, lesson_id: lessonId, asset_kind: kind, catalog_version: 'v8',
  r2_key: `lp-cache/v8/${lessonId}/${stamp}.pdf`, content_hash: stamp, version_stamp: stamp,
  is_current: current, created_at: stamp,
});
const AUG = 'v8-20260816T1650';
const AUG_U = 'v8u-20260816T2311';
const V9 = 'ch37_2Oct';

function setup({ flag = 'true', group = 'A', school = 'school-1' } = {}) {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  for (const k of Object.keys(mockInserts)) delete mockInserts[k];
  mockFail = {};
  mockSends.docs = []; mockSends.voice = [];
  AB.__resetForTests();
  mockTables.users = [{ id: 'u1', phone_number: '923001234567', preferred_language: 'ur', school_id: school }];
  mockTables.app_settings = flag === null ? [] : [{ key: 'ab_lp_ch310_enabled', value: flag }];
  mockTables.niete_lp_ab_assignment = group ? [{ school_id: 'school-1', ab_group: group }] : [];
  mockTables.niete_lp_assets = [
    asset('grade_1_urdu_ch3_seg4', AUG, false), asset('grade_1_urdu_ch3_seg4', V9, true),
    asset('grade_1_urdu_ch3_seg4b', V9, true),
    asset('grade_1_urdu_ch1_seg2', V9, true),
    asset('grade_1_urdu_ch3_seg995', AUG, false), asset('grade_1_urdu_ch3_seg995', V9, true),
    asset('grade_1_urdu_ch3_seg995', AUG_U, false, 'answer_key'), asset('grade_1_urdu_ch3_seg995', V9, true, 'answer_key'),
  ];
}
const sent = () => mockInserts.niete_lp_downloads.filter((r) => r.status === 'sent');
const deliver = (lessonId) => Delivery.deliverV8Lesson({ userId: 'u1', lessonId });

beforeAll(() => V8Catalog.__setCatalogForTests(CATALOG));
afterAll(() => V8Catalog.__setCatalogForTests(null));

describe('group A', () => {
  test('gets the August v8 PDF and no voice note', async () => {
    setup();
    await deliver('grade_1_urdu_ch3_seg4');
    expect(mockSends.docs[0].url).toContain(`/${AUG}.pdf`);
    expect(sent()[0].version_stamp).toBe(AUG);
    expect(mockSends.voice).toEqual([]);
  });

  test('a v9 split day-2 lesson repeats the August lesson for that day', async () => {
    setup();
    await deliver('grade_1_urdu_ch3_seg4b');
    expect(mockSends.docs[0].url).toContain(`grade_1_urdu_ch3_seg4/${AUG}.pdf`);
  });

  test('an assessment comes with the August answer key, not the v9 one', async () => {
    setup();
    await deliver('grade_1_urdu_ch3_seg995');
    expect(sent().map((r) => r.version_stamp)).toEqual([AUG, AUG_U]);
  });

  test('a lesson with no August version is never swapped for v9, and A hears nothing', async () => {
    setup();
    require('../../shared/services/whatsapp.service').sendMessage.mockClear();
    mockTables.niete_lp_assets = mockTables.niete_lp_assets.filter((a) => a.version_stamp !== AUG);
    const out = await deliver('grade_1_urdu_ch3_seg4');
    expect(out.ok).toBe(false);
    expect(mockSends.docs).toEqual([]);
    const WA = require('../../shared/services/whatsapp.service');
    const { resolveUx } = require('../../shared/config/ux-strings');
    // Silence, not "still preparing": there is no August plan coming, so nobody waits for one.
    expect(WA.sendMessage).not.toHaveBeenCalledWith('923001234567',
      resolveUx('lpV8StillPreparing', { user: { preferred_language: 'ur' } }));
  });

  test('an assessment with no August answer key gets no v9 key either', async () => {
    setup();
    mockTables.niete_lp_assets = mockTables.niete_lp_assets.filter((a) => a.version_stamp !== AUG_U);
    await deliver('grade_1_urdu_ch3_seg995');
    expect(sent().map((r) => r.version_stamp)).toEqual([AUG]);
  });

  test('chapters outside 3-10 are untouched, voice note included', async () => {
    setup();
    await deliver('grade_1_urdu_ch1_seg2');
    expect(sent()[0].version_stamp).toBe(V9);
    expect(mockSends.voice).toHaveLength(1);
  });
});

describe('group B', () => {
  test('gets the current v9 PDF and no voice note', async () => {
    setup({ group: 'B' });
    await deliver('grade_1_urdu_ch3_seg4');
    expect(sent()[0].version_stamp).toBe(V9);
    expect(mockSends.voice).toEqual([]);
  });
});

describe('outside the test: today\'s delivery', () => {
  test.each([
    ['flag off', { flag: 'false' }],
    ['flag missing', { flag: null }],
    ['teacher with no school', { school: null }],
    ['school not in the draw', { group: null }],
  ])('%s', async (_, opts) => {
    setup(opts);
    await deliver('grade_1_urdu_ch3_seg4');
    expect(sent()[0].version_stamp).toBe(V9);
    expect(mockSends.voice).toHaveLength(1);
  });

  test('an assignment read error fails closed to today\'s delivery', async () => {
    setup();
    mockFail = { niete_lp_ab_assignment: true };
    await deliver('grade_1_urdu_ch3_seg4');
    expect(sent()[0].version_stamp).toBe(V9);
  });
});

describe('the group lookup', () => {
  test('is the school\'s group, only for G1-5 ch3-8', async () => {
    setup();
    expect(await AB.groupFor('u1', { grade: 1, chapter: 3 })).toBe('A');
    expect(await AB.groupFor('u1', { grade: 1, chapter: 8 })).toBe('A');
    expect(await AB.groupFor('u1', { grade: 1, chapter: 11 })).toBe(null);
    expect(await AB.groupFor('u1', { grade: 6, chapter: 3 })).toBe(null);
  });

  test('ch9-10 are out of the test (bd-5o0ay.10.17): no August plan exists, everyone gets v9', async () => {
    setup();
    expect(await AB.groupFor('u1', { grade: 3, chapter: 9 })).toBe(null);
    expect(await AB.groupFor('u1', { grade: 3, chapter: 10 })).toBe(null);
  });

  test('August stamps are v8- and v8u- from August 2026 only', () => {
    expect(AB.isAugust(AUG)).toBe(true);
    expect(AB.isAugust(AUG_U)).toBe(true);
    expect(AB.isAugust('push_29Sep')).toBe(false);
    expect(AB.isAugust('v8-20260916T0000')).toBe(false);
  });
});

describe('the portal download follows the same group', () => {
  const pdf = (userId) => Browse.lessonPdfUrl('grade_1_urdu_ch3_seg4', 'lesson', userId);

  test('group A gets the August PDF, group B and no teacher get the current one', async () => {
    setup();
    expect((await pdf('u1')).version_stamp).toBe(AUG);
    setup({ group: 'B' });
    expect((await pdf('u1')).version_stamp).toBe(V9);
    setup();
    expect((await pdf(null)).version_stamp).toBe(V9);
  });

  test('the teacher id is carried from the portal session to the bot', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', '..', '..');
    const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
    expect(read('dashboard/routes/portal.routes.js'))
      .toMatch(/LpCatalogue\.lessonPdf\(lessonId, kind, req\.session\.portalUserId\)/);
    expect(read('dashboard/services/lp-catalogue.service.js'))
      .toMatch(/ask\('pdf', \{ lessonId, assetKind: kind, userId \}\)/);
    expect(read('bot/shared/routes/internal-api.routes.js'))
      .toMatch(/Browse\.lessonPdfUrl\(lessonId, assetKind, body\.userId \|\| null\)/);
  });
});

describe('the portal lesson list (bd-5o0ay.10.16)', () => {
  const ids = async (userId = 'u1') => (await Browse.listLessons(1, 'urdu', 3, userId)).map((l) => l.lesson_id);
  const ALL = ['grade_1_urdu_ch3_seg4', 'grade_1_urdu_ch3_seg4b', 'grade_1_urdu_ch3_seg995'];
  const dropAugust = (id) => {
    mockTables.niete_lp_assets = mockTables.niete_lp_assets.filter((a) => !(a.lesson_id === id && a.version_stamp === AUG));
  };

  test('group A sees a split day 2 lesson when day 1 has an August plan', async () => {
    setup();
    expect(await ids()).toEqual(ALL);
  });

  test('group A does not see lessons with no August version', async () => {
    setup();
    dropAugust('grade_1_urdu_ch3_seg4');
    expect(await ids()).toEqual(['grade_1_urdu_ch3_seg995']);
  });

  test('group B, flag off and no teacher see every lesson', async () => {
    setup({ group: 'B' });
    dropAugust('grade_1_urdu_ch3_seg4');
    expect(await ids()).toEqual(ALL);
    setup({ flag: 'false' });
    dropAugust('grade_1_urdu_ch3_seg4');
    expect(await ids()).toEqual(ALL);
    setup();
    dropAugust('grade_1_urdu_ch3_seg4');
    expect(await ids(null)).toEqual(ALL);
  });
});
