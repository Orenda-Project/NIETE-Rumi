'use strict';
/**
 * bd-gzfdu9 (VIDREC) SPEC §4.9: the report IMAGE carries the clip — one block right under "Try one thing tomorrow" on
 * the hero (794) and slim (480) templates: a 16:9 thumbnail with a play badge, "▶ Watch next: {title}" and
 * "{n} min · tap ▶ Watch in the next message". Without a strip the HTML is byte-identical to today (sha256 of the
 * base templates, pinned before the change). stripFor() races the engine for ≤ 20 s and reads the flag at call time.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const { heroVm, slimCard } = require('./fixtures-strip');
const GOLDEN = require('./fixtures-strip.golden.json');
const { buildHeroReportHtml } = require('../../../bot/shared/services/coaching/report-v2/hero-report.template');
const { buildSlimCardHtml } = require('../../../bot/shared/services/coaching/report-v2/slim-card.template');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const shown = (s) => String(s).replace(/[‎‏⁦-⁩]/g, '');

const thumb = path.join(os.tmpdir(), `vr-strip-${process.pid}.jpg`);
beforeAll(() => fs.writeFileSync(thumb, Buffer.from([0xff, 0xd8, 0xff, 0xd9])));
afterAll(() => fs.rmSync(thumb, { force: true }));
const STRIP = { thumbPath: thumb, title: 'Asking why-questions <b>', durationS: 134 };

describe('no strip → byte-identical', () => {
  test.each(['en', 'ur'])('hero %s', (l) => {
    expect(sha(buildHeroReportHtml(heroVm(l)))).toBe(GOLDEN[`hero_${l}`]);
    expect(sha(buildHeroReportHtml({ ...heroVm(l), videoStrip: null }))).toBe(GOLDEN[`hero_${l}`]);
  });
  test.each(['en', 'ur'])('slim %s', (l) => {
    expect(sha(buildSlimCardHtml(slimCard(l)))).toBe(GOLDEN[`slim_${l}`]);
    expect(sha(buildSlimCardHtml({ ...slimCard(l), videoStrip: null }))).toBe(GOLDEN[`slim_${l}`]);
  });
});

describe('with a strip', () => {
  test.each([['hero', (v) => buildHeroReportHtml({ ...heroVm('en'), videoStrip: v }), 'class="try"'],
    ['slim', (v) => buildSlimCardHtml({ ...slimCard('en'), videoStrip: v }), 'class="try"']])('%s: right under the try box; title, hint, thumbnail inline', (_n, render, tryMark) => {
    const html = render(STRIP);
    const tryAt = html.indexOf(tryMark);
    const at = html.indexOf('class="vstrip"');
    expect(tryAt).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(tryAt);
    const block = html.slice(at, html.indexOf('</div></div></div>', at));
    expect(shown(block)).toContain('▶ Watch next: Asking why-questions &lt;b&gt;');
    expect(shown(block)).toContain('2 min · tap ▶ Watch in the next message');
    expect(block).toContain('data:image/jpeg;base64,');
    expect(block).not.toMatch(/https?:/);
  });

  test('the block can never widen the image (min-width:0; the title wraps to two lines, never a one-line overflow)', () => {
    const html = buildSlimCardHtml({ ...slimCard('en'), videoStrip: STRIP });
    expect(html).toMatch(/\.vstrip\{[^}]*min-width:0/);
    expect(html).toMatch(/\.vstrip \.vt1\{[^}]*-webkit-line-clamp:2/);
    expect(html).not.toMatch(/\.vstrip \.vt1\{[^}]*nowrap/);
  });

  test('Urdu: the Urdu lines, Urdu digits', () => {
    const html = buildSlimCardHtml({ ...slimCard('ur'), videoStrip: { ...STRIP, title: 'کیوں والے سوال' } });
    const block = shown(html.slice(html.indexOf('class="vstrip"')));
    expect(block).toContain('▶ اگلا دیکھیں: کیوں والے سوال');
    expect(block).toContain('۲ منٹ · اگلے پیغام میں ▶ دیکھیں دبائیں');
  });

  test('no thumbnail file → the block still renders (a plain tile)', () => {
    const html = buildHeroReportHtml({ ...heroVm('en'), videoStrip: { ...STRIP, thumbPath: '/nope.jpg' } });
    expect(html).toContain('class="vstrip"');
    expect(html.slice(html.indexOf('class="vstrip"'))).not.toContain('data:image/jpeg');
  });
});

describe('stripFor: the engine raced for ≤ 20 s, the flag read at call time', () => {
  const S = require('../../../bot/shared/services/coaching/video-reco/strip');
  const ROW = { id: 'r', coaching_session_id: 's', status: 'shown', module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229 };
  const catalog = { segment: () => ({ module: { module_id: 63, title: 'Questioning', cpd_level: 1, thumb: 'video-thumbs/63.jpg' }, segment: { title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال' } }) };
  const deps = (over = {}) => ({ enabled: () => true, catalog, store: { readForSession: jest.fn(async () => ROW) }, ...over });

  test('flag off → null, nothing read', async () => {
    const d = deps({ enabled: () => false });
    expect(await S.stripFor({ coachingSessionId: 's', language: 'en', deps: d })).toBeNull();
    expect(d.store.readForSession).not.toHaveBeenCalled();
  });
  test('the engine\'s promise resolves shown → the strip (title in the teacher\'s language, length, thumbnail; no level)', async () => {
    const out = await S.stripFor({ coachingSessionId: 's', language: 'ur', row: Promise.resolve(ROW), deps: deps() });
    expect(out).toMatchObject({ title: 'کیوں والے سوال', durationS: 134 });
    expect(out.levelLabel).toBeUndefined();
    expect(out.thumbPath).toMatch(/bot\/assets\/video-thumbs\/63\.jpg$/);
  });
  test.each([['shadow'], ['none'], ['error']])('status %s → null', async (status) => {
    expect(await S.stripFor({ coachingSessionId: 's', language: 'en', row: Promise.resolve({ ...ROW, status }), deps: deps() })).toBeNull();
  });
  test('slower than the cap → null (the image goes as today; the message still follows)', async () => {
    const never = new Promise(() => {});
    const t0 = Date.now();
    expect(await S.stripFor({ coachingSessionId: 's', language: 'en', row: never, capMs: 50, deps: deps() })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test('the default cap is 20 s', () => { expect(S.CAP_MS).toBe(20000); });
  test('no row handed over → read by session (merge-order safety); a throw → null', async () => {
    const d = deps();
    expect(await S.stripFor({ coachingSessionId: 's', language: 'en', deps: d })).not.toBeNull();
    expect(d.store.readForSession).toHaveBeenCalledWith('s');
    d.store.readForSession.mockRejectedValue(new Error('db'));
    expect(await S.stripFor({ coachingSessionId: 's', language: 'en', deps: d })).toBeNull();
  });
  test('without the engine\'s modules on disk: off, null', async () => {
    delete process.env.VIDEO_RECO_ENABLED;
    expect(await S.stripFor({ coachingSessionId: 's', language: 'en' })).toBeNull();
  });
});
