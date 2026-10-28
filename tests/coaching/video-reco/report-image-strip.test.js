'use strict';
/**
 * bd-gzfdu9 (VIDREC) SPEC §4.9: the report IMAGE carries the clip — one block right under "Try one thing tomorrow" on
 * the hero (794) and slim (480) templates: a 16:9 thumbnail with a play badge, "▶ Watch next: {title}" and
 * "{n} min · tap ▶ Watch in the next message". Without a strip the HTML is byte-identical to the template's own render
 * with no VIDREC input (both rendered live in the test, COS 20261027T073937 §2). stripFor() races the engine for ≤ stripWaitMs() (R7m: shadow 0, card 1.5 s, llm 5 s) and reads the flag at call time.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const { heroVm, slimCard } = require('./fixtures-strip');
const { buildHeroReportHtml } = require('../../../bot/shared/services/coaching/report-v2/hero-report.template');
const { buildSlimCardHtml } = require('../../../bot/shared/services/coaching/report-v2/slim-card.template');
const shown = (s) => String(s).replace(/[‎‏⁦-⁩]/g, '');

const thumb = path.join(os.tmpdir(), `vr-strip-${process.pid}.jpg`);
beforeAll(() => fs.writeFileSync(thumb, Buffer.from([0xff, 0xd8, 0xff, 0xd9])));
afterAll(() => fs.rmSync(thumb, { force: true }));
const STRIP = { thumbPath: thumb, title: 'Asking why-questions <b>', durationS: 134, where: 'next' }; // R7p: the next-message hint

// COS 20261027T073937 §2: these were sha256 goldens pinned on 24312266a8, so #3731 (another team, bd-1r3k2h: the hero's
// .pnote + partialNote) failed them through no fault of VIDREC's. Each case now renders the same input both ways in this
// run, so a template change moves both renders together, and only a VIDREC byte in a no-strip render can fail it.
const TEMPLATES = {
  hero: ['../../../bot/shared/services/coaching/report-v2/hero-report.template', 'buildHeroReportHtml', heroVm],
  slim: ['../../../bot/shared/services/coaching/report-v2/slim-card.template', 'buildSlimCardHtml', slimCard],
};
const CASES = [['hero', 'en'], ['hero', 'ur'], ['slim', 'en'], ['slim', 'ur']];
const SENTINEL = '\u0000VIDREC-STRIP\u0000';

describe('no strip → byte-identical (live renders)', () => {
  test.each(CASES)('%s %s: the VIDREC path with no strip = the render with no VIDREC input, and carries no VIDREC byte', (k, l) => {
    const [mod, fn, vm] = TEMPLATES[k];
    const render = require(mod)[fn];
    const base = render(vm(l)); // engine absent / flag off: the services pass no videoStrip key
    expect(render({ ...vm(l), videoStrip: null })).toBe(base); // stripFor() found nothing
    expect(render({ ...vm(l), videoStrip: undefined })).toBe(base);
    expect(base).not.toMatch(/vstrip|video-reco|Watch next|اگلا دیکھیں|data:image\/jpeg/);
  });

  test.each(CASES)('%s %s: a strip adds its own block and not one byte elsewhere', (k, l) => {
    const [mod, fn, vm] = TEMPLATES[k];
    jest.isolateModules(() => {
      jest.doMock('../../../bot/shared/services/coaching/video-reco/strip', () => ({ stripHtml: () => SENTINEL }));
      const render = require(mod)[fn];
      const withStrip = render({ ...vm(l), videoStrip: STRIP });
      expect(withStrip.split(SENTINEL)).toHaveLength(2);
      expect(withStrip.replace(SENTINEL, '')).toBe(render(vm(l)));
    });
    jest.dontMock('../../../bot/shared/services/coaching/video-reco/strip');
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

describe('stripFor: the engine raced for ≤ the mode\'s cap, the flag read at call time', () => {
  const S = require('../../../bot/shared/services/coaching/video-reco/strip');
  const ROW = { id: 'r', coaching_session_id: 's', status: 'shown', module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229 };
  const catalog = { segment: () => ({ module: { module_id: 63, title: 'Questioning', cpd_level: 1, thumb: 'video-thumbs/63.jpg' }, segment: { title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال' } }) };
  const deps = (over = {}) => ({ enabled: () => true, waMessage: () => true, onTeacherApp: async () => false, windowOpen: async () => true, catalog, store: { readForSession: jest.fn(async () => ROW) }, ...over });

  test('flag off → null, nothing read', async () => {
    const d = deps({ enabled: () => false });
    expect(await S.stripFor({ coachingSessionId: 's', phone: '920000000000', language: 'en', deps: d })).toBeNull();
    expect(d.store.readForSession).not.toHaveBeenCalled();
  });
  test('the engine\'s promise resolves shown → the strip (title in the teacher\'s language, length, thumbnail; no level)', async () => {
    const out = await S.stripFor({ coachingSessionId: 's', phone: '920000000000', language: 'ur', row: Promise.resolve(ROW), deps: deps() });
    expect(out).toMatchObject({ title: 'کیوں والے سوال', durationS: 134, where: 'next' }); // R7p: off the app, window open (bd-9dbhh0.1: message on)
    expect(out.levelLabel).toBeUndefined();
    expect(out.thumbPath).toMatch(/bot\/assets\/video-thumbs\/63\.jpg$/);
  });
  test.each([['shadow'], ['none'], ['error']])('status %s → null', async (status) => {
    expect(await S.stripFor({ coachingSessionId: 's', phone: '920000000000', language: 'en', row: Promise.resolve({ ...ROW, status }), deps: deps() })).toBeNull();
  });
  test('slower than the cap → null (the image goes as today; the message still follows)', async () => {
    const never = new Promise(() => {});
    const t0 = Date.now();
    expect(await S.stripFor({ coachingSessionId: 's', phone: '920000000000', language: 'en', row: never, capMs: 50, deps: deps() })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test('the default caps (R7m, COS 165956): llm 5 s, card 1.5 s', () => { expect(S.CAP_MS).toBe(5000); expect(S.CARD_CAP_MS).toBe(1500); });
  test('no row handed over → read by session (merge-order safety); a throw → null', async () => {
    const d = deps();
    expect(await S.stripFor({ coachingSessionId: 's', phone: '920000000000', language: 'en', deps: d })).not.toBeNull();
    expect(d.store.readForSession).toHaveBeenCalledWith('s');
    d.store.readForSession.mockRejectedValue(new Error('db'));
    expect(await S.stripFor({ coachingSessionId: 's', phone: '920000000000', language: 'en', deps: d })).toBeNull();
  });
  test('without the engine\'s modules on disk: off, null', async () => {
    delete process.env.VIDEO_RECO_ENABLED;
    expect(await S.stripFor({ coachingSessionId: 's', phone: '920000000000', language: 'en' })).toBeNull();
  });
});
