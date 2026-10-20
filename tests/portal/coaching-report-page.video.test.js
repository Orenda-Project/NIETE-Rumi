'use strict';
/**
 * bd-gzfdu9 (VIDREC): the recommended clip on the /cr report card (SPEC §4.5, mockups cr_en/cr_ur).
 * No recommendation → the page is byte-identical to the page before this card existed (goldens rendered on
 * origin/sandbox 24312266a8). With one → a "Watch this next" section right after "Try one thing tomorrow":
 * thumbnail, title, length · language, the why, one full-width button to /v/<token>.
 * loadReport reads video_recommendations ONLY while VIDEO_RECO_ENABLED is on (red-team H15), and a failed read
 * never fails the report.
 */
const fs = require('fs');
const path = require('path');
const input = require('./fixtures/cr-video-input');

const ENV = { ...process.env };
const SESSION = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const REC = '9c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const env = { WHATSAPP_BOT_NUMBER: '+92 322 2482222' };
const links = { card: '/cr/T', detail: '/cr/T/detail', useful: '/cr/T/useful' };
const golden = (l) => fs.readFileSync(path.join(__dirname, 'fixtures', `cr-page-golden.${l}.html`), 'utf8');

const VIDEO = {
  title: 'Asking why-questions <i>', levelLabel: 'Level 1', durationS: 134, clipLanguage: 'ur',
  reason: 'At 12:40 you asked "What is a noun?" and moved on.', thumbUrl: '/v/thumb/63.jpg', href: '/v/TOKEN',
};

let page; let view;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co' };
  page = require('../../dashboard/services/coaching-report-page');
  view = require('../../dashboard/services/coaching-report-view');
});
afterAll(() => { process.env = ENV; });

describe('the page', () => {
  test.each(['en', 'ur'])('no recommendation (%s): byte-identical to the golden', (l) => {
    expect(page.renderReportPage(view.buildReportView(input(l)), env, links)).toBe(golden(l));
    expect(page.renderReportPage(view.buildReportView({ ...input(l), video: null }), env, links)).toBe(golden(l));
  });

  test('the view carries no `video` key when there is none (consumers that deep-compare the view are unchanged)', () => {
    expect('video' in view.buildReportView(input('en'))).toBe(false);
    expect(view.buildReportView({ ...input('en'), video: VIDEO }).video).toEqual(VIDEO);
  });

  test('with a recommendation: the section sits right after the try box, escaped, with the button to the player', () => {
    const html = page.renderReportPage(view.buildReportView({ ...input('en'), video: VIDEO }), env, links);
    const tryAt = html.indexOf('<section class="try">');
    const vAt = html.indexOf('<section class="video">');
    expect(tryAt).toBeGreaterThan(-1);
    expect(vAt).toBeGreaterThan(tryAt);
    expect(html.slice(tryAt, vAt)).not.toMatch(/<section(?! class="try")/);
    const sec = html.slice(vAt, html.indexOf('</section>', vAt));
    expect(sec).toContain('🎬 Watch this next');
    expect(sec).toContain('Asking why-questions &lt;i&gt;');
    expect(sec).toContain('<img src="/v/thumb/63.jpg"');
    expect(sec).toContain('2 min · Urdu');
    expect(sec).toContain('At 12:40 you asked &quot;What is a noun?&quot;');
    expect(sec).toMatch(/<a class="btn wide" href="\/v\/TOKEN">Watch \(2 min\)<\/a>/);
    expect(sec).toContain('Level 1');
  });

  test('Urdu: Urdu words and digits', () => {
    const html = page.renderReportPage(view.buildReportView({ ...input('ur'), video: { ...VIDEO, title: 'کیوں والے سوال', levelLabel: 'لیول ۱' } }), env, links);
    const sec = html.slice(html.indexOf('<section class="video">'));
    expect(sec).toContain('🎬 اگلا یہ دیکھیں');
    expect(sec).toContain('دیکھیں (۲ منٹ)');
    expect(sec).toContain('۲ منٹ · اردو');
  });

  test('the rest of the page is unchanged around the new section', () => {
    const html = page.renderReportPage(view.buildReportView({ ...input('en'), video: VIDEO }), env, links);
    const s = html.indexOf('<section class="video">');
    const e = html.indexOf('</section>', s) + '</section>'.length;
    expect(html.slice(0, s) + html.slice(e + 1)).toBe(golden('en'));
  });
});

describe('loadReport', () => {
  const sessionRow = { id: SESSION, user_id: USER, created_at: '2026-10-19T05:30:00Z', analysis_data: {}, prioritized_action: null };
  function fakeDb({ rec = { id: REC, user_id: USER, coaching_session_id: SESSION, status: 'shown', module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229, reason_en: 'Because.', reason_ur: 'کیونکہ۔' }, throwOn } = {}) {
    const reads = [];
    const from = (table) => {
      const f = [];
      const chain = {};
      chain.select = () => chain;
      ['eq', 'order', 'limit'].forEach((m) => { chain[m] = (...a) => { f.push([m, ...a]); return chain; }; });
      chain.maybeSingle = async () => {
        reads.push([table, ...f]);
        if (throwOn === table) throw new Error('relation does not exist');
        if (table === 'coaching_sessions') return { data: sessionRow, error: null };
        if (table === 'users') return { data: { preferred_language: 'en', name: 'X' }, error: null };
        if (table === 'video_recommendations') return { data: rec, error: null };
        if (table === 'training_modules') return { data: { id: 63, title: 'Questioning', video_url: 'https://x.r2.cloudflarestorage.com/a.mp4' }, error: null };
        return { data: null, error: null };
      };
      chain.then = (res, rej) => { reads.push([table, ...f]); return Promise.resolve({ data: [], error: null }).then(res, rej); };
      return chain;
    };
    return { from, reads };
  }
  const R = () => require('../../dashboard/routes/coaching-report.routes');

  test('flag off: video_recommendations is never read and there is no video', async () => {
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    delete process.env.VIDEO_RECO_ENABLED;
    const db = fakeDb();
    const out = await R().loadReport(db, SESSION, USER);
    expect(db.reads.map((r) => r[0])).not.toContain('video_recommendations');
    expect('video' in out).toBe(false);
  });

  test('flag on: the shown row for this session and teacher, signed for surface cr', async () => {
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    process.env.VIDEO_RECO_ENABLED = 'true';
    const db = fakeDb();
    const out = await R().loadReport(db, SESSION, USER);
    const read = db.reads.find((r) => r[0] === 'video_recommendations');
    expect(read).toEqual(expect.arrayContaining([['eq', 'coaching_session_id', SESSION], ['eq', 'user_id', USER], ['eq', 'status', 'shown']]));
    expect(out.video).toMatchObject({ durationS: 134, thumbUrl: '/v/thumb/63.jpg', reason: 'Because.' });
    const { verifyVideoLink } = require('../../bot/shared/services/coaching/video-reco/link-token');
    expect(verifyVideoLink(out.video.href.slice(3))).toEqual({ ok: true, recommendationId: REC, userId: USER, surface: 'cr' });
  });

  test('flag on, the table missing (a tier without the migration): the report loads, no video, no throw', async () => {
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    process.env.VIDEO_RECO_ENABLED = 'true';
    const out = await R().loadReport(fakeDb({ throwOn: 'video_recommendations' }), SESSION, USER);
    expect(out.session.id).toBe(SESSION);
    expect(out.video).toBeUndefined();
  });

  test('flag on, no shown row: no video', async () => {
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    process.env.VIDEO_RECO_ENABLED = 'true';
    const out = await R().loadReport(fakeDb({ rec: null }), SESSION, USER);
    expect(out.video).toBeUndefined();
  });
});
