/**
 * bd-1mcpe — one caption per framed photo, from THAT photo's own description, first clause only.
 *
 * Seen on the sandbox E2E (session 555ecc0a, 14 Sep 2026):
 *   - frame 1 read "From your photo: The whiteboard displays … with vocabulary and polite" — cut mid-clause
 *     (93% of prod per-photo descriptions have a first sentence over the 110-char cap);
 *   - frame 2 had no caption at all, so its card stretched to a blank white panel;
 *   - the descriptions are scorer-facing critique ("but lacks visible lesson plans …") that must not
 *     appear under a teacher's own photo in a celebration report.
 * Index safety: descriptions were numbered by successful-parts order and the strip skips photos that
 * fail to download, so a caption could land under the wrong picture. Both now carry the original index.
 *
 *   C1  firstClause: a long first sentence ends at the first clause boundary, with a full stop
 *   C2  the critique half after ", but" / "However" never reaches a caption
 *   C3  no clause boundary within the cap → word boundary + full stop, never mid-word, no ellipsis
 *   C4  buildPhotoCaptions maps "Classroom photo N" to index N-1, independent of block order
 *   C5  applyPhotoCaptions puts each caption under the frame whose ORIGINAL index matches, incl. a skipped photo
 *   C6  buildClassroomPhotoVm reports the original index of every framed photo
 *   C7  no description for a frame → no caption on that frame (and no descriptions → strip unchanged)
 *   C8  processAnalysis labels descriptions by ORIGINAL photo index when an earlier photo fails
 */
const persisted = [];
jest.mock('../../bot/shared/config/supabase', () => {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn((patch) => { persisted.push(patch); return builder; }),
    eq: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve({ data: global.__MCPE_SESSION, error: null })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: { users: { preferred_language: 'en' } }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => builder) };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/constants', () => ({ PEDAGOGICAL_ANALYSIS_MEDIA_ID: null }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve()), sendSticker: jest.fn(() => Promise.resolve()),
}));
const mockAnalyze = jest.fn(() => Promise.resolve({
  analysis: { executive_summary: 'ok', domains: {} },
  usage: { input_tokens: 1, output_tokens: 1, cached_tokens: 0, cost: 0 },
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({
  analyzePedagogy: (...args) => mockAnalyze(...args),
  extractReflectiveCorpus: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../bot/shared/services/coaching/coaching-session.service', () => ({
  updateStatus: jest.fn(() => Promise.resolve()), markAsFailed: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/report-generator.service', () => ({
  fetchAndCompressPriorFeedback: jest.fn(() => Promise.resolve({ exists: false })),
}));
jest.mock('../../bot/shared/services/coaching/frameworks/framework-selector', () => ({
  selectFrameworkWithReason: jest.fn(() => Promise.resolve({ framework: { name: 'fico' }, frameworkKey: 'fico', reason: 'default' })),
}));
jest.mock('../../bot/shared/config/coaching-messages', () => ({ getCoachingMessage: jest.fn(() => 'msg') }));
jest.mock('../../bot/shared/services/coaching/reflective-conversation.service', () => ({
  conductReflectiveConversation: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
  queueReport: jest.fn(() => Promise.resolve()),
}));
const mockProcessPhoto = jest.fn((buf) => Promise.resolve(`DESC-OF-${buf.toString()}`));
jest.mock('../../bot/shared/services/coaching/classroom-photo/photo-analysis.service', () => ({
  processClassroomPhoto: (...a) => mockProcessPhoto(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn((key) => key.includes('bad') ? Promise.reject(new Error('404')) : Promise.resolve(Buffer.from(key.replace('r2://', '')))),
  extractKeyFromUrl: jest.fn((u) => u),
}));

const { firstClause, buildPhotoCaptions, applyPhotoCaptions } = require('../../bot/shared/services/coaching/report-v2/photo-note');
const { buildClassroomPhotoVm } = require('../../bot/shared/services/coaching/report-v2/classroom-photo-vm');
const AnalysisProcessor = require('../../bot/shared/services/coaching/analysis-processor.service');

const LABEL = 'From your photo: ';
// The E2E session's stored descriptions, verbatim (sandbox 555ecc0a).
const D1 = 'The whiteboard displays a clear Urdu lesson plan focused on greetings and manners, with vocabulary and polite behavior steps aligned to curricular goals. However, there are no visible routine charts or daily schedules, and the classroom wall appears somewhat worn, suggesting room for improved organization and transition readiness.';
const D2 = 'The classroom shows some curricular alignment with number charts and a motivational poster, but lacks visible lesson plans or daily schedule displays. Student engagement materials and learning aids are minimal.';
const D3 = 'This classroom shows students seated in an orderly manner, but there is limited visible evidence of lesson plans, daily schedules, or engagement materials on the walls.';
const PA = (pairs) => pairs.map(([n, t]) => `Classroom photo ${n} (submitted by the teacher): ${t}`).join('\n\n');

describe('bd-1mcpe — caption text', () => {
  test('C1: a long first sentence ends at the first clause boundary, with a full stop', () => {
    expect(firstClause(D1)).toBe('The whiteboard displays a clear Urdu lesson plan focused on greetings and manners.');
  });

  test('C2: the critique half never reaches a caption', () => {
    expect(firstClause(D2)).toBe('The classroom shows some curricular alignment with number charts and a motivational poster.');
    expect(firstClause(D3)).toBe('This classroom shows students seated in an orderly manner.');
    for (const d of [D1, D2, D3]) {
      const c = firstClause(d);
      expect(c).not.toMatch(/\b(but|however|lacks|no visible|worn|limited)\b/i);
    }
  });

  test('C3: no clause boundary within the cap → word boundary + full stop, never mid-word, no ellipsis', () => {
    const long = 'The board shows ' + 'alphabetletters '.repeat(12) + 'written neatly';
    const c = firstClause(long);
    expect(c.length).toBeLessThanOrEqual(111);
    expect(c.endsWith('.')).toBe(true);
    expect(c).not.toMatch(/…/);
    expect(c.replace(/\.$/, '').split(' ').every((w) => /^(The|board|shows|alphabetletters|written|neatly)$/.test(w))).toBe(true);
  });
});

describe('bd-1mcpe — per-photo mapping', () => {
  test('C4: buildPhotoCaptions maps "Classroom photo N" to index N-1, whatever the block order', () => {
    const caps = buildPhotoCaptions({ photo_analysis: PA([[2, D2], [1, D1], [3, D3]]) });
    expect(caps[0]).toBe(LABEL + firstClause(D1));
    expect(caps[1]).toBe(LABEL + firstClause(D2));
    expect(caps[2]).toBe(LABEL + firstClause(D3));
  });

  test('C5: applyPhotoCaptions uses each frame\'s ORIGINAL index — a skipped photo never shifts captions', () => {
    const analysis = { photo_analysis: PA([[1, D1], [2, D2], [3, D3]]) };
    // photo 1 failed to download, so the strip frames photos 2 and 3
    const framed = applyPhotoCaptions([{ src: 'a', index: 1 }, { src: 'b', index: 2 }], analysis);
    expect(framed[0].caption).toBe(LABEL + firstClause(D2));
    expect(framed[1].caption).toBe(LABEL + firstClause(D3));
    // both frames captioned when both photos have descriptions
    const both = applyPhotoCaptions([{ src: 'a', index: 0 }, { src: 'b', index: 1 }], analysis);
    expect(both.map((p) => p.caption)).toEqual([LABEL + firstClause(D1), LABEL + firstClause(D2)]);
  });

  test('C6: buildClassroomPhotoVm reports the original index of every framed photo', async () => {
    const downloadFn = (key) => key.includes('bad') ? Promise.reject(new Error('404')) : Promise.resolve(Buffer.from('ok'));
    // The strip frames the first two uploads (unchanged, bd-pv2tl); a broken one is dropped, not back-filled.
    const skipped = await buildClassroomPhotoVm([{ url: 'r2://bad.jpg' }, { url: 'r2://b.jpg' }, { url: 'r2://c.jpg' }], { downloadFn });
    expect(skipped.map((p) => p.index)).toEqual([1]);
    const both = await buildClassroomPhotoVm([{ url: 'r2://a.jpg' }, { url: 'r2://b.jpg' }, { url: 'r2://c.jpg' }], { downloadFn });
    expect(both.map((p) => p.index)).toEqual([0, 1]);
  });

  test('C7: no description for a frame → no caption there; no descriptions → strip unchanged', () => {
    const partial = applyPhotoCaptions([{ src: 'a', index: 0 }, { src: 'b', index: 1 }], { photo_analysis: PA([[1, D1]]) });
    expect(partial[0].caption).toBe(LABEL + firstClause(D1));
    expect(partial[1].caption).toBeUndefined();
    const none = applyPhotoCaptions([{ src: 'a', index: 0 }], { domains: {} });
    expect(none).toEqual([{ src: 'a', index: 0 }]);
    expect(applyPhotoCaptions([], null)).toEqual([]);
  });
});

describe('bd-1mcpe — the processor numbers descriptions by original photo index', () => {
  beforeEach(() => { jest.clearAllMocks(); persisted.length = 0; delete process.env.COACHING_PHOTO_MODE; });

  test('C8: photo 1 fails to download → the stored description for photo 2 is labelled "Classroom photo 2"', async () => {
    global.__MCPE_SESSION = {
      id: 'sess-1mcpe', user_id: 'u1', observation_type: 'self_observation',
      transcript_text: 't', transcript_language: 'ur',
      classroom_photos: [{ url: 'r2://bad.jpg' }, { url: 'r2://second.jpg' }, { url: 'r2://third.jpg' }],
      users: { name: 'A', phone_number: '92300' },
    };
    await AnalysisProcessor.processAnalysis('sess-1mcpe', { from: '92300' });
    const meta = mockAnalyze.mock.calls[0][1];
    expect(meta.photoAnalysis).toContain('Classroom photo 2 (submitted by the teacher): DESC-OF-second.jpg');
    expect(meta.photoAnalysis).toContain('Classroom photo 3 (submitted by the teacher): DESC-OF-third.jpg');
    expect(meta.photoAnalysis).not.toContain('Classroom photo 1 (submitted by the teacher): DESC-OF-second.jpg');
  });
});
