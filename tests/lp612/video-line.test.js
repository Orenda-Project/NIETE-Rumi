/**
 * The video line on the page.
 *
 * A segment can carry a YouTube pick (`niete_lp612_segments.yt`), chosen offline
 * by the ranking swarm and byte-checked for a 200. When it exists, the teacher's
 * PDF prints it in the coaching corner.
 *
 * It is FURNITURE, not authored content, and that is the whole design: the URL
 * never passes through the model. `lp_doc` is `additionalProperties: false` at
 * every level precisely so nothing can smuggle a field into it, and a model that
 * is shown a URL is a model that can invent a slightly different one. So the
 * pick travels beside the document, through the render options, exactly the way
 * the coaching corner's phone number travels through the label pack.
 *
 * These tests drive `buildHtml` itself — the function that emits the line — so
 * they fail when the emitting code is absent or wrong, not merely when a wiring
 * constant is missing.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const PICK = {
  url: 'https://www.youtube.com/watch?v=pWLEUhu-60A',
  video_id: 'pWLEUhu-60A',
  title: 'Definition of Chemistry',
  channel: 'Chemistry Virus',
};

const html = (opts) => buildHtml(baseDoc(), { docDir: path.dirname(FIXTURE), ...opts }).html;

describe('the video line in the coaching corner', () => {
  test('a segment with a pick prints the short url on the page', () => {
    const out = html({ lang: 'en', video: PICK });
    expect(out).toContain('youtu.be/pWLEUhu-60A');
  });

  test('it is labelled, so the line is not a bare url floating in the corner', () => {
    const out = html({ lang: 'en', video: PICK });
    expect(out).toMatch(/Video/);
    expect(out).toContain('&#128250;'); // 📺, escaped into the HTML
  });

  test('NO pick means NO line — never a placeholder, never an empty label', () => {
    // Most segments have no pick on day one, and a "Video: —" line on 40% of
    // the corpus reads as a broken page rather than an absent extra.
    const out = html({ lang: 'en' });
    expect(out).not.toContain('youtu.be');
    expect(out).not.toContain('&#128250;');
  });

  test('a pick with no url is not a pick', () => {
    const out = html({ lang: 'en', video: { title: 'orphan', channel: 'x' } });
    expect(out).not.toContain('&#128250;');
  });

  test('on the Urdu page the url is LTR-isolated', () => {
    // The same defect the coaching corner's phone number already carries a fix
    // for: an RTL paragraph reorders a bare latin run, and the page prints a url
    // that cannot be typed. U+2066 … U+2069.
    const out = html({ lang: 'ur', video: PICK });
    expect(out).toContain('⁦youtu.be/pWLEUhu-60A⁩');
  });

  test('a url with no video_id still prints, trimmed of its protocol', () => {
    const out = html({ lang: 'en', video: { url: 'https://example.org/watch/abc' } });
    expect(out).toContain('example.org/watch/abc');
    expect(out).not.toContain('>https://example.org');
  });

  // ── the operator's ask: it has to be TAPPABLE ────────────────────────────
  //
  // "the video should be clickable from inside the lesson btw!" A printed url is
  // a url a teacher has to retype on a phone keyboard, which is the same as no
  // url at all. Headless Chromium turns an <a href> into a real PDF link
  // annotation, so the line is an anchor rather than styled text.

  test('the line is a real anchor pointing at the full url', () => {
    const out = html({ lang: 'en', video: PICK });
    expect(out).toContain('<a href="https://www.youtube.com/watch?v=pWLEUhu-60A"');
  });

  // The page carries other anchors, so these read the VIDEO paragraph rather
  // than the document's first <a> — which is how these two first went green
  // against a heading link that had nothing to do with the video.
  const videoAnchorText = (out) => {
    const para = out.match(/<p class="vid">[\s\S]*?<\/p>/);
    expect(para).toBeTruthy();
    const anchor = para[0].match(/<a href="[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    expect(anchor).toBeTruthy();
    return anchor[1];
  };

  test('the visible text stays the SHORT url — the href carries the long one', () => {
    const text = videoAnchorText(html({ lang: 'en', video: PICK }));
    expect(text).toContain('youtu.be/pWLEUhu-60A');
    expect(text).not.toContain('watch?v=');
  });

  test('on the Urdu page the anchor TEXT is still LTR-isolated', () => {
    // The isolate belongs INSIDE the link text. An RTL paragraph reorders the
    // visible run, and a shredded url is unreadable even when the tap works.
    expect(videoAnchorText(html({ lang: 'ur', video: PICK })))
      .toContain('⁦youtu.be/pWLEUhu-60A⁩');
  });

  test('a non-http url is NOT turned into a tap target', () => {
    // The picks come from our own ranker, but an anchor built from stored data
    // is an anchor someone would like to control. Only http(s) becomes a link.
    const out = html({ lang: 'en', video: { url: 'javascript:alert(1)', video_id: 'x' } });
    expect(out).not.toContain('javascript:');
  });

  test('the anchor is legible against the navy coaching box', () => {
    // White-on-navy body text with a default-blue link is unreadable in print.
    const out = html({ lang: 'en', video: PICK });
    expect(out).toMatch(/\.coach \.vid a\{[^}]*color:/);
  });
});
