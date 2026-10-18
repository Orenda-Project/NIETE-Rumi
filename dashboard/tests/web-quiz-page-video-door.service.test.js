/**
 * The lesson page (M5) for a child who came from the child home's Videos door (?via=videos) with app_settings
 * web_quiz_videos_v3 on (boot videos_v3): the big play on the video is the one primary, "Go to the questions" waits
 * in the secondary style until the video has ended, and the heading drops "(optional)". Any other arrival, or the
 * switch off, draws today's page byte for byte (golden captured from the page before this change).
 */
const { page } = require('./wq-page-harness');
const GOLDEN = require('./web-quiz-page-video-golden.json');

const VID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function draw({ lang, poster, lib, search, on }) {
  const video = { url: 'https://r2.example/v.mp4', ...(poster ? { poster: 'https://r2.example/p.jpg' } : {}), ...(lib ? { vid: VID, bytes: 12345678 } : {}) };
  const p = page({ lang, video, search, lib, bootExtra: on ? { videos_v3: true } : {} });
  if (lib) p.wq.S.st = 'st1';
  p.wq.video();
  return p;
}
const count = (h, rx) => (h.match(rx) || []).length;
const CASES = [];
for (const lang of ['en', 'ur']) for (const poster of [false, true]) for (const lib of [false, true]) CASES.push({ lang, poster, lib });
const key = (c, search) => [c.lang, c.poster ? 'poster' : 'cover', c.lib ? 'lib' : 'nolib', search || 'none'].join('|');

describe('from the Videos door with the switch on: play leads', () => {
  test.each(CASES)('one primary and it is the play control; the questions button is secondary (%o)', (c) => {
    const h = draw({ ...c, search: '?k=kk&via=videos', on: true }).html();
    expect(count(h, /data-primary/g)).toBe(1);
    expect(h).toMatch(/<button class="wq-vcover[^"]*" type="button" data-primary aria-label="[^"]*">/);
    expect(h).toContain('class="wq-vplay"');
    const skip = h.match(/<button [^>]*id="wq-skip"[^>]*>/)[0];
    expect(skip).not.toContain('data-primary');
    expect(skip).not.toMatch(/\bwq-go\b/);
    expect(skip).toContain('wq-btn wq-soft');
  });

  test('the heading has no "(optional)": English and Urdu', () => {
    const en = draw({ lang: 'en', search: '?via=videos', on: true }).html();
    expect(en).toContain('<h2>Watch the lesson</h2>');
    expect(en).not.toMatch(/optional/i);
    const ur = draw({ lang: 'ur', search: '?via=videos', on: true }).html();
    expect(ur).toContain('<h2>سبق دیکھیں</h2>');
    expect(ur).not.toContain('اختیاری');
  });

  test('the download button stays exactly as it is', () => {
    for (const lang of ['en', 'ur']) {
      const h = draw({ lang, lib: true, search: '?k=kk&via=videos', on: true }).html();
      const old = GOLDEN[key({ lang, poster: false, lib: true }, '?k=kk')];
      const dl = old.slice(old.indexOf('<a class="wq-btn wq-soft wql-dlbig"'), old.indexOf('</section>'));
      expect(dl.length).toBeGreaterThan(20);
      expect(h).toContain(dl);
    }
  });

  test('once the video has ended, "Go to the questions" leads again (the play is no longer primary)', () => {
    const p = draw({ lang: 'en', search: '?via=videos', on: true });
    const skip = p.els['#wq-skip'];
    const cover = p.els['.wq-vcover'];
    p.els['video'].fire('ended');
    expect(skip.className).toBe('wq-btn wq-go');
    expect(skip.getAttribute('data-primary')).toBe('');
    expect(cover.getAttribute('data-primary')).toBeUndefined();
    expect(p.wq.S.vdone).toBe(1);
  });
});

describe('GOLDEN: any other arrival is today\'s page byte for byte', () => {
  test.each(CASES)('no via, a class link, or via with the switch off (%o)', (c) => {
    for (const search of ['', '?k=kk', '?k=kk&via=videos']) {
      expect(draw({ ...c, search, on: false }).html()).toBe(GOLDEN[key(c, search)]);
    }
  });
  test.each(CASES)('switch on but not from the Videos door (%o)', (c) => {
    for (const search of ['', '?k=kk']) expect(draw({ ...c, search, on: true }).html()).toBe(GOLDEN[key(c, search)]);
    expect(draw({ ...c, search: '?k=kk&via=hub', on: true }).html()).toBe(GOLDEN[key(c, '?k=kk')]);
  });
  test('the golden is today\'s page: the old heading and the green questions button', () => {
    expect(GOLDEN['en|cover|nolib|none']).toContain('<h2>Watch the lesson (optional)</h2>');
    expect(GOLDEN['ur|cover|nolib|none']).toContain('<h2>سبق دیکھیں (اختیاری)</h2>');
    expect(GOLDEN['en|cover|nolib|none']).toContain('<button class="wq-btn wq-go" id="wq-skip">Go to the questions</button>');
    expect(Object.keys(GOLDEN)).toHaveLength(24);
  });
});
