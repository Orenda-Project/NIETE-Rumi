/**
 * Where the video link lives on the page.
 *
 * OPERATOR, after his first staging pull: *"YT link didnt appear in my lesson? Isnt it supposed
 * to? Somewhere at the top perhaps? In resources?"*
 *
 * His particular lesson genuinely had no pick (`yt: null` — the whole grade_8_mathematics book is
 * 0/100 until the swarm reaches it), so nothing was hidden from him. But the question stands for
 * the 1,168 segments that DO have one: the link was printed inside the Development section,
 * partway down page 2 or 3, wrapped around the video's own title. A teacher scanning her plan
 * before class does not find it there.
 *
 * So it MOVES to a resources line at the top of page 1, directly under the outcome box.
 *
 * It is a MOVE, not an addition. The same data (`sections[<development>].video`, written
 * deterministically by the author service from `segment.yt`) is rendered in exactly one place —
 * yesterday's lesson was that a second copy of the same link on the same document is a defect,
 * not a feature, and it cost a page on the part that was already over its cap.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const PICK = {
  url: 'https://www.youtube.com/watch?v=pWLEUhu-60A',
  title: 'Definition of Chemistry',
  channel: 'Chemistry Virus',
};

/** The fixture already carries a development video; these helpers set or clear it. */
function withVideo(video) {
  const d = baseDoc();
  for (const s of d.sections) {
    if (s.id === 'development') { if (video) s.video = { ...video }; else delete s.video; }
    else delete s.video;
  }
  return d;
}

const html = (doc, opts = {}) => buildHtml(doc, { docDir: path.dirname(FIXTURE), ...opts }).html;

/** `atom()` wraps every block as `<div data-atom class="<mine> sp-N">`, so the class is present
 *  but never as an exact `class="vres"` match. Assert on the class TOKEN. */
const TV = /&#128250;|\u{1F4FA}/u;
const vresBlock = (out) => {
  const m = out.match(/<div [^>]*class="vres[^"]*"[\s\S]*?<\/div>/);
  return m && m[0];
};
/** Index of the first section band — everything before it is page-1 masthead furniture. */
const firstBandAt = (out) => out.search(/<div [^>]*class="bar[ "]/);

describe('the video sits in a resources line at the top', () => {
  test('the link is in the page-1 furniture, ABOVE the first section band', () => {
    const out = html(withVideo(PICK), { lang: 'en' });
    const at = out.search(TV);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(firstBandAt(out));
  });

  test('it renders as a resources line, not inside Development', () => {
    const out = html(withVideo(PICK), { lang: 'en' });
    expect(vresBlock(out)).toBeTruthy();
    // The old mid-lesson block must be gone: one link, one place.
    expect(out).not.toContain('class="blk vid"');
  });

  test('the whole document carries the video link EXACTLY ONCE', () => {
    // The duplicate-video defect, asserted rather than remembered. Counted by the LINE (its
    // marker), not by the video id — the id legitimately appears twice inside one line, in the
    // href and again in the visible short url.
    const out = html(withVideo(PICK), { lang: 'en' });
    expect((out.match(/&#128250;/g) || []).length).toBe(1);
    expect((out.match(/<a href="https:\/\/www\.youtube\.com/g) || []).length).toBe(1);
  });

  test('it is a real anchor on the full url', () => {
    const out = html(withVideo(PICK), { lang: 'en' });
    expect(out).toContain('<a href="https://www.youtube.com/watch?v=pWLEUhu-60A"');
  });

  test('it is labelled in the language of the page', () => {
    expect(html(withVideo(PICK), { lang: 'en' })).toMatch(/Video/);
    expect(html(withVideo(PICK), { lang: 'ur' })).toMatch(/ویڈیو/);
  });

  test('NO pick means NO line and no empty label', () => {
    const out = html(withVideo(null), { lang: 'en' });
    expect(vresBlock(out)).toBeNull();
    expect(out).not.toContain('youtu');
    expect(out).not.toContain('&#128250;');
  });

  test('a non-http url is not turned into a tap target', () => {
    const out = html(withVideo({ url: 'javascript:alert(1)', title: 'x' }), { lang: 'en' });
    expect(out).not.toContain('javascript:');
  });

  test('on the Urdu page the url is LTR-isolated inside the link text', () => {
    const out = html(withVideo(PICK), { lang: 'ur' });
    const res = vresBlock(out);
    expect(res).toBeTruthy();
    expect(res).toMatch(/⁦[^⁩]*youtu\.be[^⁩]*⁩/);
  });

  test('the line is COMPACT — the url, not the video title and channel', () => {
    // It is furniture on the busiest page in the document. The old block printed the full
    // title, channel, duration and a "why" line; at the top that is a paragraph, not a line.
    const out = html(withVideo(PICK), { lang: 'en' });
    const res = vresBlock(out);
    expect(res).not.toContain('Chemistry Virus');
    expect(res.length).toBeLessThan(400);
  });
});
