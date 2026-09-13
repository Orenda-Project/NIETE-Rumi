/**
 * bd-a8veu.4 — the video is a RESOURCE, so name it; and stop shipping a re-read as the exemplar.
 *
 * Operator, 2026-09-12, item 4 of the v9.3 PDF design review:
 *   *"videos should have enhancement mateiral for the SLo not just reading the same passage as on
 *   the textbook or solving the same exercises"*
 *
 * WHERE THE DEFECT ACTUALLY IS, and it is not here. The pick is made by an external "YouTube
 * swarm" fleet. Its output arrives as a FILE — `yt/corpus_filled/<book>_segments.json`, handed to
 * `bot/scripts/import-lp612-segments.js --yt-dir` — which is not in this repo and not anywhere on
 * this machine. This codebase's whole role is plumbing: read the file, key it by `segment_id`,
 * upsert `niete_lp612_segments.yt`, read it back, paste it into `sections[development].video`.
 * There is no scoring function, no YouTube API call and no candidate list in the repo; the one
 * filter that exists is `import-lp612-segments.js:246` — a pick counts iff it has a url. So the
 * criteria the operator is complaining about live upstream of everything this suite can reach,
 * and the reason they produce re-reads is a DECISION, not a bug: the format spec said
 * *"No video link unless the topic is one teachers flag as difficult … Most LPs carry none"*
 * (lp_format_requirements_6_12.md:174, sourced to General Science teachers), and that was
 * overridden — `lp_doc.schema.json:221`, *"every LP, all subjects, best available link"*. Force a
 * video onto a Grade 6 passage about Pakistan's forest types and the best available link IS a
 * read-through of the passage. That override is the operator's to keep or revoke (bd-a8veu.12).
 *
 * WHAT IS THIS REPO'S, and is what this file holds:
 *
 *   1. THE EXEMPLARS TEACH THE DEFECT. The gate fixture and all four author briefs ship
 *      `"why": "Play once after the I-do, so the class sees the sweep a second time."` — and "a
 *      second time" IS the re-read. That sentence is the only place in the codebase that says
 *      what a video is FOR, and it says the wrong thing. Worse, the briefs print a `video` key at
 *      all, in a worked exemplar, when the author prompt forbids the model from emitting one
 *      (`lp612-author.service.js:989-993`: *"Put NO video key in your output"*). The key is not
 *      the model's to write, so it comes out of the exemplar.
 *
 *   2. THE TEACHER CANNOT JUDGE THE PICK. The operator's own PDF prints `VIDEOyoutu.be/7E3NQRBDNXY`
 *      — eleven characters of base64. Nobody can tell a demonstration from a read-aloud by its id,
 *      so a bad pick is invisible until she has already played it in front of a class.
 *      `video-resources-slot.test.js:108` defends printing the url alone, and it was right to: the
 *      block it replaced printed title AND channel AND duration AND why, which is a paragraph on
 *      the busiest page in the document. But item 6 asks page 1 to carry *"the resources, videos
 *      and key words of this lesson"*, and an id is not a resource entry. One title, clamped to
 *      one line by CSS rather than by hoping it is short, is a line and not a paragraph — it costs
 *      exactly what the id cost and says what the thing is. The url stays: as the href, which is
 *      what a teacher taps, and the only part of it she ever used.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml } = require(path.join(VENDOR, 'lib', 'template'));
const { lint } = require(path.join(VENDOR, 'lint_lp.js'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const PICK = {
  url: 'https://www.youtube.com/watch?v=pWLEUhu-60A',
  title: 'Titration, drop by drop',
  channel: 'Chemistry Virus',
};

function withVideo(video) {
  const d = baseDoc();
  for (const s of d.sections) {
    if (s.id === 'development') { if (video) s.video = { ...video }; else delete s.video; }
    else delete s.video;
  }
  return d;
}

const render = (doc, opts = {}) => buildHtml(doc, { docDir: path.dirname(FIXTURE), ...opts }).html;
const sheet = (out) => out.slice(0, out.indexOf('</style>'));
const body = (out) => out.slice(out.indexOf('</style>'));
const vres = (out) => {
  const m = body(out).match(/<div [^>]*class="vres[^"]*"[\s\S]*?<\/div>/);
  return m && m[0];
};
/** The one CSS rule that governs the line's visible run. */
const vresLinkRule = (out) => {
  const m = sheet(out).match(/\.vres a\{([^}]*)\}/);
  return m && m[1];
};

describe('bd-a8veu.4 — the resources line names the video', () => {
  test('it prints the TITLE, so the teacher knows what she is about to play', () => {
    expect(vres(render(withVideo(PICK), { lang: 'en' }))).toContain('Titration, drop by drop');
  });

  test('the bare video id is no longer the visible text', () => {
    // `youtu.be/pWLEUhu-60A` told her nothing. It stays in the href, where it is a tap target.
    const line = vres(render(withVideo(PICK), { lang: 'en' }));
    expect(line).not.toMatch(/>[^<]*youtu\.be\//);
  });

  test('the full url is still the anchor', () => {
    expect(vres(render(withVideo(PICK), { lang: 'en' })))
      .toContain('<a href="https://www.youtube.com/watch?v=pWLEUhu-60A"');
  });

  test('a stored pick with no title still renders — it falls back to the short url', () => {
    // `parseYt` requires a title, but rows predate it and a blank line helps nobody.
    const line = vres(render(withVideo({ url: 'https://youtu.be/OMA2Mwo0aZg' }), { lang: 'en' }));
    expect(line).toContain('youtu.be/OMA2Mwo0aZg');
  });

  test('the line is held to ONE line by CSS, not by hoping the title is short', () => {
    // This is the whole reason the url-only version existed. A 90-character YouTube title on a
    // 478px column is three lines of page-1 furniture on a document with a real page cap.
    const rule = vresLinkRule(render(withVideo(PICK), { lang: 'en' }));
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    // and it must be allowed to shrink, or the flex row refuses to clamp it at all
    expect(rule).toMatch(/min-width:\s*0/);
  });

  test('the url-era word-breaking is gone — it would hyphenate the title mid-word', () => {
    expect(vresLinkRule(render(withVideo(PICK), { lang: 'en' }))).not.toMatch(/break-all/);
  });

  test('still exactly one video line on the whole document', () => {
    const out = render(withVideo(PICK), { lang: 'en' });
    expect((out.match(/&#128250;/g) || []).length).toBe(1);
    expect((body(out).match(/<a href="https:\/\/www\.youtube\.com/g) || []).length).toBe(1);
  });

  test('no pick, no line', () => {
    const out = render(withVideo(null), { lang: 'en' });
    expect(vres(out)).toBeNull();
    expect(body(out)).not.toContain('&#128250;');
  });

  test('an Urdu title on the Urdu page is not forced into latin order', () => {
    // The old isolate was U+2066 LEFT-TO-RIGHT ISOLATE, correct for a url and only for a url.
    // The visible run is now a title, which on an Urdu plan is Urdu, and LRI reverses it.
    // U+2068 FIRST STRONG ISOLATE does what LRI did for latin and the right thing for Urdu.
    const line = vres(render(withVideo({ ...PICK, title: 'میٹرکس کی ضرب' }), { lang: 'ur' }));
    expect(line).toContain('⁨');
    expect(line).not.toContain('⁦');
  });

  test('a latin title on the Urdu page is still isolated from the RTL paragraph', () => {
    const line = vres(render(withVideo(PICK), { lang: 'ur' }));
    expect(line).toMatch(/⁨[^⁩]*Titration[^⁩]*⁩/);
  });

  test('a non-http url is not turned into a tap target', () => {
    expect(render(withVideo({ url: 'javascript:alert(1)', title: 'x' }), { lang: 'en' }))
      .not.toContain('javascript:');
  });

  test('it is still a LINE and not the old paragraph — no channel, no duration, no why', () => {
    const line = vres(render(withVideo({ ...PICK, duration: '4:12', why: 'because' }), { lang: 'en' }));
    expect(line).not.toContain('Chemistry Virus');
    expect(line).not.toContain('4:12');
    expect(line).not.toContain('because');
    expect(line.length).toBeLessThan(400);
  });
});

describe('bd-a8veu.4 — the exemplars stop modelling the re-read', () => {
  const BRIEFS = [
    'brief_author_v3.md',
    'brief_author_v3_flash_sci.md',
    'brief_author_v3_flash_prose.md',
    'brief_author_v3_flash_maths.md',
  ];
  const briefSrc = (f) => fs.readFileSync(path.join(VENDOR, f), 'utf8');

  test('the gate fixture says what the video ADDS, not that it repeats the lesson', () => {
    const dev = baseDoc().sections.find((s) => s.id === 'development');
    expect(dev.video.why).toBeTruthy();
    expect(dev.video.why).not.toMatch(/a second time|again|once more|re-?read|same (passage|exercise)/i);
  });

  test('the fixture is still a clean document — the new wording stays inside BUDGET', () => {
    // The whole doc sits ~2 words under the measured page-capacity cap, and two other suites
    // require this fixture as their CLEAN_DOC. A longer sentence here reddens twelve of their
    // tests with a message that never mentions video.
    expect(lint(baseDoc()).fails).toEqual([]);
  });

  test.each(BRIEFS)('%s no longer prints a video key the model is forbidden to emit', (f) => {
    // `lp612-author.service.js:989-993` tells the model "Put NO video key in your output"; the
    // slot is filled mechanically from `segment.yt` afterwards. A worked exemplar that shows the
    // key contradicts the prompt in the same document.
    expect(briefSrc(f)).not.toMatch(/"video":\s*\{/);
  });

  test.each(BRIEFS)('%s carries no re-read exemplar anywhere', (f) => {
    expect(briefSrc(f)).not.toMatch(/sees the (row-by-column )?sweep a second time/);
  });

  test.each(BRIEFS)('%s says the video slot is not the author\'s to fill, and names the bead', (f) => {
    const src = briefSrc(f);
    const para = src.split('\n\n').find((p) => /bd-a8veu\.4/.test(p));
    expect(para).toBeTruthy();
    expect(para).toMatch(/segment\.yt|mechanically/);
    expect(para).toMatch(/no\s+[`"']*video[`"']*\s+key/i);
  });
});
