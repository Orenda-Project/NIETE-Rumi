/**
 * bd-8s2xb (T10–T12) — where the photo reaches a human.
 *
 *   T10  teacher report: the hero template renders a frame's caption under "From your classroom"
 *        (chrome stays English on every language, by design). Caption TEXT — per photo, first
 *        clause, keyed by original index — is covered by bd-1mcpe-per-photo-captions.test.js.
 *   T11  coach draft (HITL): the Photo: prefix on evidence_summary survives the 600-char clip
 *   T12  the interstitial copy fits WhatsApp's caps (body ≤ 1,024 code points, buttons ≤ 20)
 */
process.env.OBSERVE_FRAMEWORK = 'fico';
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { buildScreenPrefill } = require('../../bot/shared/services/observe/observe-draft.service');
const { buildPhotoPrompt } = require('../../bot/shared/services/coaching/classroom-photo/photo-prompt.service');

const PX = 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64');
const baseVm = (lang, extra = {}) => ({
  language: lang, brand: {}, teacherName: 'Zeba', topic: 'Plurals', date: '2026-09-14',
  score: { overall: 61, marks: 27, max: 44 }, groups: [], narrative: {}, tryNext: '', uptake: null, trend: [],
  photoB64: '', classroomPhotos: [{ src: PX }], ...extra,
});

describe('bd-8s2xb — teacher report photo note (T10)', () => {
  test('the hero template renders the note as the strip caption (English chrome on every language, by design)', () => {
    const en = buildHeroReportHtml(baseVm('en', { classroomPhotos: [{ src: PX, caption: 'From your photo: the objective is on the board' }] }));
    expect(en).toContain('From your classroom');
    expect(en).toContain('class="pcap"');
    expect(en).toContain('From your photo: the objective is on the board');
    const ur = buildHeroReportHtml(baseVm('ur', { classroomPhotos: [{ src: PX, caption: 'From your photo: the title "گفتگو" is on the board' }] }));
    expect(ur).toContain('From your classroom');
    // the caption is an LTR block and must NOT be wrapLatin()'d — the embed spans reorder the runs
    expect(ur).toContain('<div class="pcap">From your photo: the title &quot;گفتگو&quot; is on the board</div>'.replace(/&quot;/g, '"'));
    expect(ur).toMatch(/\.pframe \.pcap\{[^}]*direction:ltr;unicode-bidi:isolate/);
    // no caption → no .pcap, layout unchanged
    expect(buildHeroReportHtml(baseVm('en'))).not.toContain('class="pcap"');
  });
});

describe('bd-8s2xb — coach draft keeps the Photo: prefix (T11)', () => {
  test('evidence_summary starting with Photo: is pre-filled verbatim at the head of the field', () => {
    const analysis = { domains: { high_leverage_practices: { indicators: [
      { id: 'C2', score: 2, evidence: 'long…', evidence_summary: 'Photo: an upset face and a happy face drawn on the board as the second representation. ' + 'w '.repeat(400) },
    ] } } };
    const data = buildScreenPrefill(analysis, 'high_leverage_practices');
    expect(data.e_C2.startsWith('Photo: an upset face')).toBe(true);
    expect(data.e_C2.length).toBeLessThanOrEqual(600);
  });
});

describe('bd-8s2xb — interstitial copy fits the caps (T12)', () => {
  test('en/ur bodies name what to photograph, ≤1,024 code points; buttons ≤20', () => {
    for (const lang of ['en', 'ur']) {
      const p = buildPhotoPrompt('sess-1', lang);
      expect([...p.body].length).toBeLessThanOrEqual(1024);
      expect(p.buttons).toHaveLength(2);
      for (const b of p.buttons) expect([...b.title].length).toBeLessThanOrEqual(20);
    }
    expect(buildPhotoPrompt('s', 'en').body).toMatch(/board/i);
    expect(buildPhotoPrompt('s', 'en').body).toMatch(/notebook|worksheet/i);
    expect(buildPhotoPrompt('s', 'ur').body).toMatch(/بورڈ/);
    expect(buildPhotoPrompt('s', 'ur').body).toMatch(/کاپی|ورک شیٹ/);
  });
});
